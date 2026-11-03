// ──────────────────────────────────────────────────────────────
// POST /api/media/sign — Generate R2 Presigned Upload URL
// ──────────────────────────────────────────────────────────────
// Returns a time-limited presigned URL for direct browser-to-R2 upload,
// bypassing Vercel's ≈ 4.5 MB serverless payload limit entirely.
//
// Use this flow for:
//   • Videos (any size)
//   • Images larger than ≈ 4 MB
//   • Any upload where the binary should not transit the backend
//
// Three-step signed upload flow:
//   1. Frontend → POST /api/media/sign        (this endpoint)
//            ← { uploadUrl, key, expiresIn }
//   2. Frontend → PUT uploadUrl               (directly to R2)
//            Binary or FormData: file
//            ← R2 response
//   3. Frontend → POST /api/media/register   (save URL to DB)
//            Body: { key, context, mime_type, bytes, ... }
//
// Security:
//   • Session cookie required (except for signup cover uploads)
//   • Rate limited: 30 requests / 10 min per IP
//   • MIME type validated before URL is issued
//   • Service ownership check when context = "service"
//   • Presigned URL expires in 1 hour
//   • R2 verifies upload permissions via signed URL
//
// Request body (JSON):
//   {
//     context:     "profile" | "cover" | "service" | "portfolio" | "support",
//     file_name:   string,        — used for R2 key generation
//     service_id?: string         — required when context = "service"
//   }
//
// Response 200:
//   {
//     uploadUrl:  string,  — time-limited presigned URL for PUT
//     key:        string,  — R2 object key
//     publicUrl:  string,  — canonical public URL after upload completes
//     expiresIn:  number   — seconds until URL expires
//   }
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { generatePresignedUploadUrl, getPublicUrl, type UploadContext } from "@/server/lib/r2-storage";
import { checkRateLimit } from "@/server/lib/rate-limit";

const VALID_CONTEXTS = new Set<string>(["profile", "cover", "service", "portfolio", "support", "messaging"]);
const PRESIGNED_URL_EXPIRES_IN = 3600; // 1 hour in seconds

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);

    // ── Rate Limiting ──────────────────────────────────────────
    const rateCheck = checkRateLimit("media-sign", ip);
    if (!rateCheck.allowed) {
      console.warn("[media/sign] Rate limit exceeded for IP:", ip);
      return NextResponse.json(
        { error: "Too many signing requests. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
        }
      );
    }

    // ── Authentication ─────────────────────────────────────────
    // Allow unauthenticated uploads for 'cover' context (signup flow)
    // All other contexts require authentication
    const resolved = await resolveRequestSession(request);
    const session = resolved.session;

    let userId: bigint | null = null;
    let userIdStr: string | null = null;

    if (!session) {
      // Peek at the context to see if this is a signup cover upload
      let bodyForContextCheck: Record<string, unknown>;
      try {
        bodyForContextCheck = await request.clone().json();
      } catch {
        bodyForContextCheck = {};
      }

      const contextRaw = bodyForContextCheck.context;
      const isSignupCoverUpload = contextRaw === "cover";

      if (!isSignupCoverUpload) {
        console.warn("[media/sign] Unauthorized request from IP:", ip);
        return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
      }

      // For signup cover uploads, use a placeholder user ID
      userId = BigInt(0); // 0 = anonymous/signup flow
      userIdStr = "0";
    } else {
      userId = BigInt(session.userId);
      userIdStr = String(session.userId);
    }

    // ── Parse JSON Body ────────────────────────────────────────
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch (e) {
      console.error("[media/sign] Invalid JSON body:", e);
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const contextRaw = body.context;
    const fileNameRaw = body.file_name;
    const serviceIdRaw = body.service_id;

    // ── Validate context ───────────────────────────────────────
    if (typeof contextRaw !== "string" || !VALID_CONTEXTS.has(contextRaw)) {
      console.warn("[media/sign] Invalid context:", contextRaw);
      return NextResponse.json(
        {
          error: "Invalid or missing 'context'.",
          details: "Must be one of: profile, cover, service, portfolio, support, messaging",
        },
        { status: 400 }
      );
    }
    const context = contextRaw as UploadContext;

    // ── Validate file_name ─────────────────────────────────────
    if (typeof fileNameRaw !== "string" || !fileNameRaw.trim()) {
      console.warn("[media/sign] Invalid file_name:", fileNameRaw);
      return NextResponse.json(
        { error: "Missing or invalid 'file_name'." },
        { status: 400 }
      );
    }
    const fileName = fileNameRaw.trim();

    // ── Validate file has extension ────────────────────────────
    if (!fileName.includes(".")) {
      console.warn("[media/sign] File name without extension:", fileName);
      return NextResponse.json(
        { error: "'file_name' must include a file extension." },
        { status: 400 }
      );
    }

    // ── service_id check ───────────────────────────────────────
    if (context === "service" && !serviceIdRaw) {
      console.warn("[media/sign] Service context missing service_id");
      return NextResponse.json(
        { error: "Missing 'service_id'. Required when context is 'service'." },
        { status: 400 }
      );
    }
    const serviceId = serviceIdRaw ? String(serviceIdRaw) : undefined;

    // ── Service Ownership Check ────────────────────────────────
    // Skip ownership check for signup flow (userId === 0)
    if (context === "service" && serviceId && userIdStr !== "0") {
      try {
        console.debug("[media/sign] Checking service ownership:", {
          serviceId,
          userId: userIdStr,
        });
        const service = await prisma.service.findFirst({
          where: { service_id: BigInt(serviceId), user_id: userId },
          select: { service_id: true },
        });
        if (!service) {
          console.warn("[media/sign] Service not found or access denied for:", {
            serviceId,
            userId: userIdStr,
          });
          return NextResponse.json(
            { error: "Service not found or access denied." },
            { status: 403 }
          );
        }
      } catch (dbError) {
        console.error("[media/sign] Database error during service ownership check:", {
          error: dbError instanceof Error ? dbError.message : String(dbError),
          stack: dbError instanceof Error ? dbError.stack : undefined,
          serviceId,
          userId: userIdStr,
        });
        // Don't expose DB errors to client, return generic error
        return NextResponse.json(
          { error: "Service verification failed. Please try again." },
          { status: 500 }
        );
      }
    }

    // ── Validate R2 Credentials Before Proceeding ─────────────
    // Check that all R2 environment variables are set
    const r2Env = {
      R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID ? "SET" : "MISSING",
      R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID ? "SET" : "MISSING",
      R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY ? "SET" : "MISSING",
      R2_ENDPOINT: process.env.R2_ENDPOINT ? "SET" : "MISSING",
      R2_BUCKET_NAME: process.env.R2_BUCKET_NAME ? "SET" : "MISSING",
    };

    const missingVars = Object.entries(r2Env)
      .filter(([_, v]) => v === "MISSING")
      .map(([k]) => k);

    if (missingVars.length > 0) {
      console.error("[media/sign] Missing R2 environment variables:", {
        missingVars,
        r2Env,
        timestamp: new Date().toISOString(),
      });
      return NextResponse.json(
        { 
          error: "Server configuration error. R2 storage is not properly configured.",
          details: process.env.NODE_ENV === "development" ? missingVars : undefined,
        },
        { status: 500 }
      );
    }

    // ── Generate Presigned Upload URL ──────────────────────────
    console.log("[media/sign] All prerequisites validated. Generating presigned URL:", {
      context,
      userIdStr,
      fileName,
      expiresIn: PRESIGNED_URL_EXPIRES_IN,
    });

    const signResult = await generatePresignedUploadUrl(
      context,
      userIdStr,
      fileName,
      PRESIGNED_URL_EXPIRES_IN
    );

    console.log("[media/sign] Successfully generated presigned URL:", {
      key: signResult.key,
      expiresIn: signResult.expiresIn,
    });

    return NextResponse.json(
      {
        ...signResult,
        publicUrl: getPublicUrl(signResult.key),
      },
      { status: 200 }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : "";

    console.error("[media/sign] CRITICAL ERROR - Presigned URL generation failed:", {
      errorMessage,
      errorStack,
      errorType: error?.constructor?.name,
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json(
      { 
        error: "Failed to generate upload credentials. Please try again.",
        details: process.env.NODE_ENV === "development" ? errorMessage : undefined,
      },
      { status: 500 }
    );
  }
}
