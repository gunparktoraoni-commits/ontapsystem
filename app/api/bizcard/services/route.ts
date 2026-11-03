import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { resolveRequestSession, resolveEffectiveUserId, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { validateBizcardServiceCreateInput } from "@/server/lib/validators";
import { uploadToR2 } from "@/server/lib/r2";
import { isOwnR2Url } from "@/server/lib/r2-storage";
import { validateUploadedFile } from "@/server/lib/media";

// Allow up to 60 s execution for Cloudinary upload latency
export const maxDuration = 60;

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

async function requireSession(request: NextRequest) {
  const result = await resolveRequestSession(request);
  if (!result.session) {
    return { ok: false as const, response: NextResponse.json({ error: "Authentication required.", requiresAuth: true }, { status: 401 }) };
  }

  return {
    ok: true as const,
    session: result.session,
    userId: BigInt(resolveEffectiveUserId(result)),
  };
}

function parsePositiveInt(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return fallback;
  return n;
}

function parseSortField(raw: string | null): "created_at" | "name" | "updated_at" {
  if (raw === "name" || raw === "updated_at") return raw;
  return "created_at";
}

function parseSortOrder(raw: string | null): "asc" | "desc" {
  if (raw === "asc") return "asc";
  return "desc";
}

function getDisplayOrderFromMetadata(metadata: string | null): number {
  if (!metadata) return 0;
  try {
    const parsed = JSON.parse(metadata) as { display_order?: unknown };
    const n = Number(parsed.display_order ?? 0);
    return Number.isInteger(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);

  try {
    const rateCheck = checkRateLimit("bizcard-services-list", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please slow down." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
      );
    }

    const auth = await requireSession(request);
    if (!auth.ok) return auth.response;

    const userId = auth.userId;
    const query = request.nextUrl.searchParams;

    const dashboardMode = query.get("dashboard") === "true";
    const page = parsePositiveInt(query.get("page"), 1);
    const limit = Math.min(parsePositiveInt(query.get("limit"), 20), 100);
    const skip = (page - 1) * limit;
    const sort = parseSortField(query.get("sort"));
    const order = parseSortOrder(query.get("order"));
    const status = (query.get("status") ?? "").trim().toLowerCase();

    const where = {
      user_id: userId,
      ...(status ? { status } : {}),
    } as const;

    const [total, services, usageCount] = await Promise.all([
      prisma.service.count({ where }),
      prisma.service.findMany({
        where,
        orderBy: { [sort]: order },
        skip,
        take: limit,
        select: {
          service_id: true,
          name: true,
          description: true,
          tagline: true,
          price: true,
          currency_code: true,
          is_price_negotiable: true,
          featured: true,
          status: true,
          service_url: true,
          featured_image: true,
          display_order: true,
          is_visible: true,
          created_at: true,
          updated_at: true,
        },
      }),
      prisma.employeeCard.count({ where: { assigned_user_id: userId, activation_status: "active" } }),
    ]);

    const serviceIds = services.map((svc) => svc.service_id);

    const [serviceMediaRows, legacyGalleryRows] = serviceIds.length > 0
      ? await Promise.all([
          prisma.serviceMedia.findMany({
            where: { service_id: { in: serviceIds } },
            select: {
              id: true,
              service_id: true,
              file_url: true,
              file_name: true,
              mime_type: true,
              size: true,
              display_order: true,
              created_at: true,
            },
            orderBy: [{ display_order: "asc" }, { created_at: "asc" }],
          }),
          prisma.media.findMany({
            where: {
              user_id: userId,
              related_type: "service_gallery",
              related_id: { in: serviceIds },
            },
            select: {
              media_id: true,
              related_id: true,
              file_url: true,
              file_name: true,
              mime_type: true,
              size: true,
              metadata: true,
              created_at: true,
            },
            orderBy: { created_at: "asc" },
          }),
        ])
      : [[], []];

    const galleryMap = new Map<string, Array<{
      id: bigint;
      file_url: string;
      file_name: string;
      mime_type: string | null;
      size: bigint | null;
      display_order: number;
      created_at: Date;
    }>>();

    for (const row of serviceMediaRows) {
      const key = row.service_id.toString();
      const items = galleryMap.get(key) ?? [];
      items.push({
        id: row.id,
        file_url: row.file_url,
        file_name: row.file_name,
        mime_type: row.mime_type,
        size: row.size,
        display_order: row.display_order,
        created_at: row.created_at,
      });
      galleryMap.set(key, items);
    }

    for (const row of legacyGalleryRows) {
      if (row.related_id === null) continue;
      const key = row.related_id.toString();
      const existing = galleryMap.get(key) ?? [];
      const legacyOrder = getDisplayOrderFromMetadata(row.metadata);
      const alreadyPresent = existing.some((m) => m.file_url === row.file_url);
      if (alreadyPresent) continue;
      existing.push({
        id: row.media_id,
        file_url: row.file_url,
        file_name: row.file_name,
        mime_type: row.mime_type,
        size: row.size,
        display_order: legacyOrder,
        created_at: row.created_at,
      });
      galleryMap.set(key, existing);
    }

    const rows = services.map((svc) => ({
      id: svc.service_id,
      name: svc.name,
      description: svc.description,
      tagline: svc.tagline,
      price: svc.price,
      currency: svc.currency_code,
      serviceUrl: svc.service_url,
      featuredImage: svc.featured_image ?? null,
      isPriceNegotiable: svc.is_price_negotiable,
      featured: svc.featured,
      status: svc.status,
      isVisible: svc.is_visible,
      displayOrder: svc.display_order,
      media: (galleryMap.get(svc.service_id.toString()) ?? [])
        .sort((a, b) => a.display_order - b.display_order || a.created_at.getTime() - b.created_at.getTime())
        .map((media) => ({
          id: media.id,
          url: media.file_url,
          fileName: media.file_name,
          mimeType: media.mime_type,
          bytes: media.size,
          displayOrder: media.display_order,
        })),
      usageCount,
      createdAt: svc.created_at,
      updatedAt: svc.updated_at,
    }));

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return NextResponse.json(
      serialize({
        success: true,
        dashboard: dashboardMode,
        data: rows,
        meta: {
          total,
          page,
          limit,
          totalPages,
          sort,
          order,
          status: status || null,
        },
      }),
      { status: 200 }
    );
  } catch (err) {
    console.error("[bizcard/services GET] Unhandled error:", err);
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);

  try {
    const rateCheck = checkRateLimit("bizcard-services-create", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many create attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
      );
    }

    const auth = await requireSession(request);
    if (!auth.ok) return auth.response;

    const userId = auth.userId;
    const userIdStr = String(auth.userId);

    // ── Parse body (multipart or JSON) ─────────────────────────
    let body: Record<string, unknown>;
    let featuredImageUrl: string | null = null;

    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      // ── Multipart mode: file upload + form text fields ────────
      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        return NextResponse.json({ error: "Invalid multipart/form-data body." }, { status: 400 });
      }

      // Build the body object from text form fields for the validator
      body = {
        name: form.get("name"),
        description: form.get("description"),
        tagline: form.get("tagline"),
        price: form.get("price"),
        currency: form.get("currency"),
        serviceUrl: form.get("serviceUrl") ?? form.get("service_url"),
        featured: form.get("featured") === "true",
        isVisible: form.get("isVisible") !== "false",
        isPriceNegotiable: form.get("isPriceNegotiable") === "true",
        status: form.get("status") ?? "active",
        media: (() => {
          try { return JSON.parse((form.get("media") as string) ?? "[]"); } catch { return []; }
        })(),
      };

      // Upload featured image if included
      const imageFile = form.get("featured_image");
      if (imageFile instanceof File && imageFile.size > 0) {
        const mimeType = imageFile.type.toLowerCase().trim();
        if (!mimeType.startsWith("image/")) {
          return NextResponse.json(
            { error: "featured_image must be an image file (jpg, jpeg, png, webp)." },
            { status: 400 }
          );
        }
        const fileValidation = validateUploadedFile(mimeType, imageFile.size, "image");
        if (!fileValidation.valid) {
          const httpStatus = fileValidation.code === "FILE_TOO_LARGE" ? 413 : 400;
          return NextResponse.json({ error: fileValidation.error, code: fileValidation.code }, { status: httpStatus });
        }
        const buffer = Buffer.from(await imageFile.arrayBuffer());
        try {
          const result = await uploadToR2(
            buffer,
            mimeType,
            "service",
            userIdStr,
            `feat_${userIdStr}_${Date.now()}`
          );
          featuredImageUrl = result.url;
        } catch (uploadErr) {
          console.error("[bizcard/services POST] R2 upload failed:", uploadErr);
          return NextResponse.json(
            { error: "Featured image upload failed. Please try again." },
            { status: 500 }
          );
        }
      }
    } else {
      // ── JSON mode: accept optional pre-uploaded R2 URL ─
      try {
        body = await request.json();
      } catch {
        return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
      }

      const rawUrl = body.featuredImageUrl ?? body.featured_image_url;
      if (rawUrl !== null && rawUrl !== undefined) {
        if (typeof rawUrl !== "string" || !isOwnR2Url(rawUrl)) {
          return NextResponse.json(
            { error: "featuredImageUrl must be a valid R2 media URL." },
            { status: 422 }
          );
        }
        if (rawUrl.length > 512) {
          return NextResponse.json({ error: "featuredImageUrl must not exceed 512 characters." }, { status: 422 });
        }
        featuredImageUrl = rawUrl;
      }
    }

    const validation = validateBizcardServiceCreateInput(body);
    if (!validation.valid) {
      return NextResponse.json({ error: "Validation failed.", details: validation.errors }, { status: 422 });
    }

    const data = validation.data;

    const duplicate = await prisma.service.findFirst({
      where: {
        user_id: userId,
        name: data.name,
      },
      select: { service_id: true },
    });

    if (duplicate) {
      return NextResponse.json(
        { error: "A service with this name already exists for your profile.", code: "DUPLICATE_SERVICE_NAME" },
        { status: 409 }
      );
    }

    const created = await prisma.$transaction(async (tx) => {
      const createdService = await tx.service.create({
        data: {
          user_id: userId,
          name: data.name,
          description: data.description,
          tagline: data.tagline,
          price: data.price,
          currency_code: data.currency,
          is_price_negotiable: data.isPriceNegotiable,
          featured: data.featured,
          status: data.status,
          service_url: data.serviceUrl,
          is_visible: data.isVisible,
          ...(featuredImageUrl !== null && { featured_image: featuredImageUrl }),
        },
      });

      if (data.media.length > 0) {
        await tx.serviceMedia.createMany({
          data: data.media.map((media, index) => ({
            user_id: userId,
            service_id: createdService.service_id,
            file_name: media.fileName ?? `service-media-${index + 1}`,
            file_url: media.url,
            mime_type: media.mimeType,
            size: media.bytes !== null ? BigInt(media.bytes) : null,
            storage_provider: "r2",
            display_order: media.displayOrder ?? index,
          })),
        });
      }

      const serviceMediaList = await tx.serviceMedia.findMany({
        where: {
          service_id: createdService.service_id,
        },
        select: {
          id: true,
          file_url: true,
          file_name: true,
          mime_type: true,
          size: true,
          display_order: true,
          created_at: true,
        },
        orderBy: [{ display_order: "asc" }, { created_at: "asc" }],
      });

      return { createdService, serviceMediaList };
    });

    return NextResponse.json(
      serialize({
        success: true,
        data: {
          id: created.createdService.service_id,
          name: created.createdService.name,
          description: created.createdService.description,
          tagline: created.createdService.tagline,
          price: created.createdService.price,
          currency: created.createdService.currency_code,
          isPriceNegotiable: created.createdService.is_price_negotiable,
          featured: created.createdService.featured,
          status: created.createdService.status,
          serviceUrl: created.createdService.service_url,
          featuredImage: created.createdService.featured_image ?? null,
          displayOrder: created.createdService.display_order,
          isVisible: created.createdService.is_visible,
          media: created.serviceMediaList
            .map((media) => ({
              id: media.id,
              url: media.file_url,
              fileName: media.file_name,
              mimeType: media.mime_type,
              bytes: media.size,
              displayOrder: media.display_order,
              createdAt: media.created_at,
            }))
            .sort((a, b) => a.displayOrder - b.displayOrder || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
            .map(({ createdAt: _createdAt, ...rest }) => rest),
          createdAt: created.createdService.created_at,
          updatedAt: created.createdService.updated_at,
        },
      }),
      { status: 201 }
    );
  } catch (err) {
    console.error("[bizcard/services POST] Unhandled error:", err);
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}
