import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { checkRateLimit } from "@/server/lib/rate-limit";
import {
  resolveRequestSession,
  resolveEffectiveUserId,
  getClientIp,
  getUserAgent,
  isValidEmail,
  logAuditEvent,
  createEmailOtp,
} from "@/server/lib/auth";
import { sendEmailVerificationOtp } from "@/server/lib/email";
import { getCached, CACHE_TTL, generateCacheKey, invalidateCacheBatch } from "@/lib/cache";
import { withPerformanceTracking } from "@/middleware/performance";
import { toServableMediaSrc } from "@/app/lib/portfolioDisplay";

function serialize(obj: unknown): unknown {
  return JSON.parse(JSON.stringify(obj, (_, value) => (typeof value === "bigint" ? value.toString() : value)));
}

function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (v.length < 2 || v.length > 50) return null;
  if (!/^[A-Za-z][A-Za-z\-\' ]*[A-Za-z]$/.test(v)) return null;
  return v;
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (!isValidEmail(v)) return null;
  return v;
}

function normalizeOptionalEmail(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  return normalizeEmail(value);
}

function normalizeOptionalPhone(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") return null;
  let v = value.trim().replace(/[\s()-]/g, "");
  // Accept common PH mobile forms and normalize to E.164
  if (/^09\d{9}$/.test(v)) v = `+63${v.slice(1)}`;
  else if (/^639\d{9}$/.test(v)) v = `+${v}`;
  else if (/^\+639\d{9}$/.test(v)) {
    // already valid PH mobile
  }
  if (!/^\+?[1-9]\d{7,14}$/.test(v)) return null;
  return v.startsWith("+") ? v : `+${v}`;
}

function normalizeOptionalText(
  value: unknown,
  maxLen: number,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") return null;
  const v = value.trim().replace(/\s{2,}/g, " ");
  if (!v) return null;
  if (v.length > maxLen) return null;
  return v;
}

function normalizeOptionalAbout(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") return null;
  const v = value.replace(/\r\n/g, "\n").trim();
  if (!v) return null;
  if (v.length > 2000) return null;
  return v;
}

function resolveProfileMediaUrl(
  raw: string | null | undefined,
  request: NextRequest,
): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;

  const servable = toServableMediaSrc(value);
  if (servable.startsWith("/")) {
    const origin =
      process.env.R2_PUBLIC_URL?.trim().replace(/\/$/, "") ||
      process.env.FRONTEND_URL?.trim().replace(/\/$/, "") ||
      process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "") ||
      request.nextUrl.origin;
    return `${origin}${servable}`;
  }

  return servable;
}

async function requireSession(request: NextRequest) {
  const resolved = await resolveRequestSession(request);
  if (!resolved.session) {
    return {
      ok: false as const,
      response: NextResponse.json({ success: false, error: "Authentication required.", requiresAuth: true }, { status: 401 }),
    };
  }

  return {
    ok: true as const,
    session: resolved.session,
    refreshed: resolved.refreshed,
    impersonation: resolved.impersonation,
    companyActing: resolved.companyActing,
    requiresReverification: resolved.requiresReverification,
  };
}

export async function GET(request: NextRequest) {
  return withPerformanceTracking(request, async () => {
    const ip = getClientIp(request);
    const rl = checkRateLimit("general", ip);
    if (!rl.allowed) {
      return NextResponse.json({ success: false, error: "Too many requests." }, { status: 429 });
    }

    const auth = await requireSession(request);
    
    // If not authenticated (e.g., during signup flow), return empty profile
    // instead of 401. This allows the layout to safely fetch during signup.
    if (!auth.ok) {
      return NextResponse.json({
        success: true,
        data: {
          user_id: null,
          first_name: null,
          last_name: null,
          middle_name: null,
          email: null,
          alternative_email: null,
          phone_number: null,
          job_position: null,
          about: null,
          location: null,
          profile_image: null,
          cover_image: null,
          bizcard_count: 0,
          email_verified: false,
          phone_verified: false,
          member_since: null,
          last_login: null,
        },
      });
    }

    const effectiveUserId = resolveEffectiveUserId(auth);
    const cacheKey = generateCacheKey("user", effectiveUserId, "profile");

    const { data, cached } = await getCached(
      cacheKey,
      async () => {
        const userId = BigInt(effectiveUserId);

        const [user, credential, lastSession, bizcardCount] = await Promise.all([
          prisma.user.findUnique({
            where: { user_id: userId },
            select: {
              user_id: true,
              first_name: true,
              last_name: true,
              middle_name: true,
              email: true,
              alt_email: true,
              contact: true,
              job_position: true,
              about: true,
              location: true,
              profile_url: true,
              cover_url: true,
              created_at: true,
            },
          }),
          prisma.credential.findUnique({
            where: { user_id: userId },
            select: {
              email_verified: true,
            },
          }),
          prisma.session.findFirst({
            where: { user_id: userId },
            orderBy: { created_at: "desc" },
            select: { created_at: true },
          }),
          prisma.bizcard.count({
            where: {
              user_id: userId,
              deleted_at: null,
              deactivated_flag: false,
            },
          }),
        ]);

        if (!user) return null;

        return {
          user_id: user.user_id,
          first_name: user.first_name,
          last_name: user.last_name,
          middle_name: user.middle_name,
          email: user.email,
          alternative_email: user.alt_email,
          phone_number: user.contact,
          job_position: user.job_position,
          about: user.about,
          location: user.location,
          profile_image: resolveProfileMediaUrl(user.profile_url, request),
          cover_image: resolveProfileMediaUrl(user.cover_url, request),
          bizcard_count: bizcardCount,
          email_verified: credential?.email_verified ?? false,
          phone_verified: false,
          member_since: user.created_at,
          last_login: lastSession?.created_at ?? null,
        };
      },
      CACHE_TTL.USER_SESSION
    );

    if (!data) {
      return NextResponse.json({ success: false, error: "User not found." }, { status: 404 });
    }

    const response = NextResponse.json({ success: true, data: serialize(data) });
    response.headers.set("X-Cache", cached ? "HIT" : "MISS");
    return response;
  });
}

export async function PUT(request: NextRequest) {
  return withPerformanceTracking(request, async () => {
    const ip = getClientIp(request);
    const ua = getUserAgent(request);
    const rl = checkRateLimit("general", ip);
    if (!rl.allowed) {
      return NextResponse.json({ success: false, error: "Too many requests." }, { status: 429 });
    }

  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const hasFirstName = Object.prototype.hasOwnProperty.call(body, "first_name");
  const hasLastName = Object.prototype.hasOwnProperty.call(body, "last_name");
  const hasEmail = Object.prototype.hasOwnProperty.call(body, "email");
  const hasAltEmail = Object.prototype.hasOwnProperty.call(body, "alternative_email");
  const hasPhone = Object.prototype.hasOwnProperty.call(body, "phone_number");
  const hasJobPosition =
    Object.prototype.hasOwnProperty.call(body, "job_position") ||
    Object.prototype.hasOwnProperty.call(body, "title");
  const hasLocation = Object.prototype.hasOwnProperty.call(body, "location");
  const hasAbout = Object.prototype.hasOwnProperty.call(body, "about");
  const hasMiddleName = Object.prototype.hasOwnProperty.call(body, "middle_name");

  const hasAnyUpdatableField =
    hasFirstName ||
    hasLastName ||
    hasEmail ||
    hasAltEmail ||
    hasPhone ||
    hasJobPosition ||
    hasLocation ||
    hasAbout ||
    hasMiddleName;

  if (!hasAnyUpdatableField) {
    return NextResponse.json(
      {
        success: false,
        error: "At least one profile field is required.",
        code: "USER_PROFILE_VALIDATION_FAILED",
        tag: "[PROFILE_API]",
      },
      { status: 422 },
    );
  }

  // Partial updates: omitted first_name / last_name / email keep existing DB values.
  const firstName = hasFirstName ? normalizeName(body.first_name) : undefined;
  const lastName = hasLastName ? normalizeName(body.last_name) : undefined;
  const email = hasEmail ? normalizeEmail(body.email) : undefined;
  const altEmail = normalizeOptionalEmail(body.alternative_email);
  const phone = normalizeOptionalPhone(body.phone_number);
  const jobPosition = normalizeOptionalText(
    body.job_position ?? body.title,
    100,
  );
  const location = normalizeOptionalText(body.location, 255);
  const about = normalizeOptionalAbout(body.about);
  const middleName = normalizeOptionalText(body.middle_name, 50);

  if (hasFirstName && !firstName) {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid first_name.",
        code: "USER_PROFILE_VALIDATION_FAILED",
        tag: "[PROFILE_API]",
      },
      { status: 422 },
    );
  }
  if (hasLastName && !lastName) {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid last_name.",
        code: "USER_PROFILE_VALIDATION_FAILED",
        tag: "[PROFILE_API]",
      },
      { status: 422 },
    );
  }
  if (hasEmail && !email) {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid email.",
        code: "USER_PROFILE_VALIDATION_FAILED",
        tag: "[PROFILE_API]",
      },
      { status: 422 },
    );
  }
  if (altEmail === null && body.alternative_email !== null && body.alternative_email !== "" && body.alternative_email !== undefined) {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid alternative_email.",
        code: "USER_PROFILE_VALIDATION_FAILED",
        tag: "[PROFILE_API]",
      },
      { status: 422 },
    );
  }
  if (phone === null && body.phone_number !== null && body.phone_number !== "" && body.phone_number !== undefined) {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid phone_number. Use E.164 or PH mobile format (09XXXXXXXXX).",
        code: "USER_PROFILE_VALIDATION_FAILED",
        tag: "[PROFILE_API]",
      },
      { status: 422 },
    );
  }
  if (
    (jobPosition === null && body.job_position !== undefined && body.job_position !== null && body.job_position !== "") ||
    (jobPosition === null && body.title !== undefined && body.title !== null && body.title !== "")
  ) {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid job_position (max 100 characters).",
        code: "USER_PROFILE_VALIDATION_FAILED",
        tag: "[PROFILE_API]",
      },
      { status: 422 },
    );
  }
  if (location === null && body.location !== undefined && body.location !== null && body.location !== "") {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid location (max 255 characters).",
        code: "USER_PROFILE_VALIDATION_FAILED",
        tag: "[PROFILE_API]",
      },
      { status: 422 },
    );
  }
  if (about === null && body.about !== undefined && body.about !== null && body.about !== "") {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid about (max 2000 characters).",
        code: "USER_PROFILE_VALIDATION_FAILED",
        tag: "[PROFILE_API]",
      },
      { status: 422 },
    );
  }
  if (middleName === null && body.middle_name !== undefined && body.middle_name !== null && body.middle_name !== "") {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid middle_name (max 50 characters).",
        code: "USER_PROFILE_VALIDATION_FAILED",
        tag: "[PROFILE_API]",
      },
      { status: 422 },
    );
  }

  const effectiveUserId = resolveEffectiveUserId(auth);
  const userId = BigInt(effectiveUserId);

  const existing = await prisma.user.findUnique({
    where: { user_id: userId },
    select: {
      first_name: true,
      last_name: true,
      middle_name: true,
      email: true,
      alt_email: true,
      contact: true,
      job_position: true,
      about: true,
      location: true,
    },
  });

  if (!existing) {
    return NextResponse.json(
      {
        success: false,
        error: "User not found.",
        code: "USER_PROFILE_NOT_FOUND",
        tag: "[PROFILE_API]",
      },
      { status: 404 },
    );
  }

  const nextFirstName: string = firstName ?? existing.first_name;
  const nextLastName: string = lastName ?? existing.last_name;
  const nextEmail: string = email ?? existing.email;
  const nextMiddleName =
    middleName === undefined ? existing.middle_name : middleName;
  const nextJobPosition =
    jobPosition === undefined ? existing.job_position : jobPosition;
  const nextAbout = about === undefined ? existing.about : about;
  const nextLocation = location === undefined ? existing.location : location;
  const nextAltEmail = altEmail === undefined ? existing.alt_email : altEmail;
  const nextPhone = phone === undefined ? existing.contact : phone;

  if (nextAltEmail && nextAltEmail === nextEmail) {
    return NextResponse.json(
      {
        success: false,
        error: "Alternative email must be different from primary email.",
        code: "USER_PROFILE_VALIDATION_FAILED",
        tag: "[PROFILE_API]",
      },
      { status: 422 },
    );
  }

  if (hasEmail) {
    const duplicate = await prisma.user.findFirst({
      where: { email: nextEmail, user_id: { not: userId } },
      select: { user_id: true },
    });

    if (duplicate) {
      return NextResponse.json(
        {
          success: false,
          error: "Email is already in use.",
          code: "USER_PROFILE_EMAIL_CONFLICT",
          tag: "[PROFILE_API]",
        },
        { status: 409 },
      );
    }
  }

  const changedFields: string[] = [];
  if (existing.first_name !== nextFirstName) changedFields.push("first_name");
  if (existing.last_name !== nextLastName) changedFields.push("last_name");
  if ((existing.middle_name ?? null) !== (nextMiddleName ?? null)) {
    changedFields.push("middle_name");
  }
  if (existing.email !== nextEmail) changedFields.push("email");
  if ((existing.alt_email ?? null) !== (nextAltEmail ?? null)) {
    changedFields.push("alternative_email");
  }
  if ((existing.contact ?? null) !== (nextPhone ?? null)) {
    changedFields.push("phone_number");
  }
  if ((existing.job_position ?? null) !== (nextJobPosition ?? null)) {
    changedFields.push("job_position");
  }
  if ((existing.about ?? null) !== (nextAbout ?? null)) changedFields.push("about");
  if ((existing.location ?? null) !== (nextLocation ?? null)) changedFields.push("location");

  const emailChanged = existing.email !== nextEmail;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { user_id: userId },
        data: {
          first_name: nextFirstName,
          last_name: nextLastName,
          middle_name: nextMiddleName ?? null,
          email: nextEmail,
          alt_email: nextAltEmail ?? null,
          contact: nextPhone ?? null,
          job_position: nextJobPosition ?? null,
          about: nextAbout ?? null,
          location: nextLocation ?? null,
          updated_at: new Date(),
        },
      });

      if (emailChanged) {
        await tx.credential.update({
          where: { user_id: userId },
          data: {
            email_verified: false,
            email_verified_at: null,
            updated_at: new Date(),
          },
        });
      }
    });
  } catch (error) {
    console.error("[PROFILE_API] USER_PROFILE_UPDATE_FAILED", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to update user profile.",
        code: "USER_PROFILE_UPDATE_FAILED",
        tag: "[PROFILE_API]",
      },
      { status: 500 },
    );
  }

  if (emailChanged) {
    try {
      const otp = await createEmailOtp(Number(userId));
      await sendEmailVerificationOtp(nextEmail, nextFirstName, otp, 10);
    } catch (error) {
      console.error("[user/profile PUT] Failed to send email verification OTP:", error);
    }
  }

  await logAuditEvent("USER_PROFILE_UPDATED", Number(userId), ip, ua, {
    updated_fields: changedFields,
    email_changed: emailChanged,
  });

    void invalidateCacheBatch([generateCacheKey("user", effectiveUserId, "profile")]);

    return NextResponse.json({
      success: true,
      message: "Profile updated successfully",
      data: {
        updated_fields: changedFields,
        verification_needed: emailChanged ? ["email"] : [],
        next_steps: emailChanged ? { email: "Verification email sent to new address" } : {},
      },
    });
  });
}
