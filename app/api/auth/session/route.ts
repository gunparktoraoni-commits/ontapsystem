// ──────────────────────────────────────────────────────────────
// GET /api/auth/session — Session Validation Endpoint
// ──────────────────────────────────────────────────────────────
// Returns the current user's session data if authenticated.
// The session is validated server-side against the DB (not just JWT decode).
// This means revoked sessions return 401 immediately.
// ──────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { resolveRequestSession } from "@/server/lib/auth";
import { prisma } from "@/server/lib/prisma";
import { resolveUserPortalRole } from "@/server/lib/company";
import { withPerformanceTracking } from "@/middleware/performance";
import { isForcedPlaceholderEmail } from "@/lib/auth/placeholder-email";

/**
 * Handle CORS preflight requests
 * Browser sends OPTIONS before GET for cross-origin requests
 */
export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-CSRF-Token, Authorization",
      "Access-Control-Max-Age": "86400",
    },
  });
}

export async function GET(request: NextRequest) {
  return withPerformanceTracking(request, async () => {
    try {
      const auth = await resolveRequestSession(request, { tryRefresh: true });
      const session = auth.session;

      if (!session) {
        return NextResponse.json({ authenticated: false, user: null }, { status: 200 });
      }

      const effectiveUserId = auth.impersonation?.targetUserId ?? session.userId;

      const user = await prisma.user.findUnique({
        where: { user_id: BigInt(effectiveUserId) },
        select: {
          user_id: true,
          email: true,
          first_name: true,
          last_name: true,
          role: true,
          custom_uri: true,
          profile_url: true,
          deactivated_flag: true,
          credentials: {
            select: { must_change_password: true },
          },
        },
      });

      if (!user || user.deactivated_flag) {
        return NextResponse.json({ authenticated: false, user: null }, { status: 200 });
      }

      const portalRole = await resolveUserPortalRole(user.user_id);
      const isImpersonating = Boolean(auth.impersonation);

      return NextResponse.json(
        {
          authenticated: true,
          user: {
            userId: Number(user.user_id),
            email: user.email,
            firstName: user.first_name,
            lastName: user.last_name,
            role: portalRole,
            appRole: session.role,
            customUri: user.custom_uri,
            profileUrl: user.profile_url,
            // Never force the SA into password/email change while impersonating.
            requiresPasswordChange:
              !isImpersonating && user.credentials?.must_change_password === true,
            requiresEmailChange:
              !isImpersonating && isForcedPlaceholderEmail(user.email),
          },
          impersonation: auth.impersonation
            ? {
                active: true,
                target_user_id: auth.impersonation.targetUserId,
                expires_at: auth.impersonation.expiresAt.toISOString(),
                reason: auth.impersonation.reason,
              }
            : { active: false },
          expiresAt: session.expiresAt.toISOString(),
          rememberMe: session.rememberMe,
        },
        { status: 200 }
      );
    } catch (error) {
      console.error("Session error:", error);
      return NextResponse.json({ error: "Internal server error." }, { status: 500 });
    }
  });
}
