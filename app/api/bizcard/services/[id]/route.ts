import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { resolveRequestSession, resolveEffectiveUserId, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { validateBizcardServiceUpdateInput } from "@/server/lib/validators";
import { uploadToR2, deleteFromR2 } from "@/server/lib/r2";
import { isOwnR2Url } from "@/server/lib/r2-storage";
import { validateUploadedFile } from "@/server/lib/media";

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

function parseServiceId(raw: string): bigint | null {
  if (!/^\d{1,20}$/.test(raw)) return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
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

async function hasActiveBizcard(userId: bigint): Promise<boolean> {
  const count = await prisma.employeeCard.count({
    where: { assigned_user_id: userId, activation_status: "active" },
  });
  return count > 0;
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ip = getClientIp(request);

  try {
    const rateCheck = checkRateLimit("bizcard-services-update", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many update attempts. Please slow down." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
      );
    }

    const auth = await requireSession(request);
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const serviceId = parseServiceId(id);
    if (!serviceId) return NextResponse.json({ error: "Invalid service ID." }, { status: 400 });

    const userId = auth.userId;
    const userIdStr = String(auth.userId);

    // ── Parse body (multipart or JSON) ─────────────────────────
    let body: Record<string, unknown>;
    // undefined = no image sent; null = explicitly remove
    let newFeaturedImageUrl: string | null | undefined = undefined;

    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        return NextResponse.json({ error: "Invalid multipart/form-data body." }, { status: 400 });
      }

      // Build patch body from form text fields (only include present keys)
      body = {};
      if (form.has("name")) body.name = form.get("name");
      if (form.has("description")) body.description = form.get("description");
      if (form.has("tagline")) body.tagline = form.get("tagline");
      if (form.has("price")) body.price = form.get("price");
      if (form.has("currency")) body.currency = form.get("currency");
      if (form.has("serviceUrl")) body.serviceUrl = form.get("serviceUrl");
      if (form.has("service_url")) body.service_url = form.get("service_url");
      if (form.has("featured")) body.featured = form.get("featured") === "true";
      if (form.has("isVisible")) body.isVisible = form.get("isVisible") !== "false";
      if (form.has("isPriceNegotiable")) body.isPriceNegotiable = form.get("isPriceNegotiable") === "true";
      if (form.has("status")) body.status = form.get("status");
      if (form.has("media")) {
        try { body.media = JSON.parse((form.get("media") as string) ?? "[]"); } catch { body.media = []; }
      }

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
            `feat_${serviceId.toString()}`
          );
          newFeaturedImageUrl = result.url;
        } catch (uploadErr) {
          console.error("[bizcard/services PUT] R2 upload failed:", uploadErr);
          return NextResponse.json(
            { error: "Featured image upload failed. Please try again." },
            { status: 500 }
          );
        }
      } else if (form.get("featured_image") === null && form.has("remove_featured_image") && form.get("remove_featured_image") === "true") {
        // Explicit removal
        newFeaturedImageUrl = null;
      }
    } else {
      try {
        body = await request.json();
      } catch {
        return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
      }

      // Accept optional featured image URL update in JSON mode
      if ("featuredImageUrl" in body || "featured_image_url" in body) {
        const rawUrl = body.featuredImageUrl ?? body.featured_image_url;
        if (rawUrl === null || rawUrl === "") {
          newFeaturedImageUrl = null; // explicit removal
        } else if (typeof rawUrl !== "string" || !isOwnR2Url(rawUrl)) {
          return NextResponse.json(
            { error: "featuredImageUrl must be a valid R2 media URL." },
            { status: 422 }
          );
        } else if (rawUrl.length > 512) {
          return NextResponse.json({ error: "featuredImageUrl must not exceed 512 characters." }, { status: 422 });
        } else {
          newFeaturedImageUrl = rawUrl;
        }
      }
    }

    const validation = validateBizcardServiceUpdateInput(body);
    if (!validation.valid) {
      return NextResponse.json({ error: "Validation failed.", details: validation.errors }, { status: 422 });
    }

    const existing = await prisma.service.findFirst({
      where: { service_id: serviceId, user_id: userId },
      select: { service_id: true, name: true },
    });

    if (!existing) {
      return NextResponse.json({ error: "Service not found." }, { status: 404 });
    }

    const patch = validation.data;

    if (patch.name) {
      const duplicate = await prisma.service.findFirst({
        where: {
          user_id: userId,
          name: patch.name,
          service_id: { not: serviceId },
        },
        select: { service_id: true },
      });
      if (duplicate) {
        return NextResponse.json(
          { error: "A service with this name already exists for your profile.", code: "DUPLICATE_SERVICE_NAME" },
          { status: 409 }
        );
      }
    }

    const activeCard = await hasActiveBizcard(userId);
    const turningOffVisibility = patch.isVisible === false;
    const archiving = patch.status === "archived";
    if (activeCard && (turningOffVisibility || archiving)) {
      return NextResponse.json(
        { error: "Cannot archive/hide this service while an active BizCard is linked to your profile." },
        { status: 409 }
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.service.update({
        where: { service_id: serviceId },
        data: {
          ...(patch.name !== undefined && { name: patch.name }),
          ...(patch.description !== undefined && { description: patch.description }),
          ...(patch.tagline !== undefined && { tagline: patch.tagline }),
          ...(patch.price !== undefined && { price: patch.price }),
          ...(patch.currency !== undefined && { currency_code: patch.currency }),
          ...(patch.serviceUrl !== undefined && { service_url: patch.serviceUrl }),
          ...(patch.featured !== undefined && { featured: patch.featured }),
          ...(patch.isVisible !== undefined && { is_visible: patch.isVisible }),
          ...(patch.isPriceNegotiable !== undefined && { is_price_negotiable: patch.isPriceNegotiable }),
          ...(patch.status !== undefined && { status: patch.status }),
          ...(newFeaturedImageUrl !== undefined && { featured_image: newFeaturedImageUrl }),
          updated_at: new Date(),
        },
      });

      if (patch.media !== undefined) {
        await tx.serviceMedia.deleteMany({
          where: {
            service_id: serviceId,
          },
        });

        if (patch.media.length > 0) {
          await tx.serviceMedia.createMany({
            data: patch.media.map((media, index) => ({
              user_id: userId,
              service_id: serviceId,
              file_name: media.fileName ?? `service-media-${index + 1}`,
              file_url: media.url,
              mime_type: media.mimeType,
              size: media.bytes !== null ? BigInt(media.bytes) : null,
              storage_provider: "r2",
              display_order: media.displayOrder ?? index,
            })),
          });
        }
      }

      const service = await tx.service.findUniqueOrThrow({
        where: { service_id: serviceId },
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
      });

      const serviceMediaList = await tx.serviceMedia.findMany({
        where: {
          service_id: serviceId,
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

      return { service, serviceMediaList };
    });

    return NextResponse.json(
      serialize({
        success: true,
        data: {
          id: updated.service.service_id,
          name: updated.service.name,
          description: updated.service.description,
          tagline: updated.service.tagline,
          price: updated.service.price,
          currency: updated.service.currency_code,
          isPriceNegotiable: updated.service.is_price_negotiable,
          featured: updated.service.featured,
          status: updated.service.status,
          serviceUrl: updated.service.service_url,
          featuredImage: updated.service.featured_image ?? null,
          displayOrder: updated.service.display_order,
          isVisible: updated.service.is_visible,
          media: updated.serviceMediaList
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
          createdAt: updated.service.created_at,
          updatedAt: updated.service.updated_at,
        },
      }),
      { status: 200 }
    );
  } catch (err) {
    console.error("[bizcard/services/[id] PUT] Unhandled error:", err);
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ip = getClientIp(request);

  try {
    const rateCheck = checkRateLimit("bizcard-services-delete", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many delete attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
      );
    }

    const auth = await requireSession(request);
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const serviceId = parseServiceId(id);
    if (!serviceId) return NextResponse.json({ error: "Invalid service ID." }, { status: 400 });

    const userId = auth.userId;

    const existing = await prisma.service.findFirst({
      where: { service_id: serviceId, user_id: userId },
      select: { service_id: true },
    });

    if (!existing) {
      return NextResponse.json({ error: "Service not found." }, { status: 404 });
    }

    const activeCard = await hasActiveBizcard(userId);
    if (activeCard) {
      return NextResponse.json(
        { error: "Cannot delete service while an active BizCard is linked to your profile." },
        { status: 409 }
      );
    }

    // Fetch service media before deleting to get Cloudinary URLs
    const mediaToDelete = await prisma.serviceMedia.findMany({
      where: { service_id: serviceId },
      select: { file_url: true },
    });

    await prisma.$transaction(async (tx) => {
      // Delete media from database
      await tx.serviceMedia.deleteMany({
        where: {
          service_id: serviceId,
        },
      });

      // Delete service from database
      await tx.service.delete({ where: { service_id: serviceId } });
    });

    // Delete media files from Cloudinary (non-blocking, after DB deletion succeeds)
    if (mediaToDelete.length > 0) {
      mediaToDelete.forEach((media) => {
        if (media.file_url) {
          try {
            // Extract public_id from Cloudinary URL
            // Format: https://res.cloudinary.com/cloud_name/image/upload/v123/folder/public_id
            const urlParts = media.file_url.split('/');
            const fileName = urlParts[urlParts.length - 1]; // Get last part: public_id
            if (fileName && fileName.trim()) {
              // Fire-and-forget deletion from R2
              deleteFromR2(fileName).catch((err) => {
                console.error(`[bizcard/services DELETE] Failed to delete R2 asset ${fileName}:`, err);
              });
            }
          } catch (err) {
            console.error(`[bizcard/services DELETE] Error parsing Cloudinary URL ${media.file_url}:`, err);
          }
        }
      });
    }

    return NextResponse.json(serialize({ success: true, deleted: true, serviceId }), { status: 200 });
  } catch (err) {
    console.error("[bizcard/services/[id] DELETE] Unhandled error:", err);
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}
