import { NextRequest, NextResponse } from "next/server";
import { withSuperAdmin, type SuperAdminContext } from "@/lib/auth/superadmin-middleware";
import { prisma } from "@/server/lib/prisma";
import {
  createPetTagsPortalSwitchToken,
  isPortalSwitchConfigured,
} from "@/server/lib/portal-sso";

/**
 * POST /api/superadmin/portal-switch/pet-tags
 * Issues a one-time SSO handoff URL into the SmartPet SUPERADMIN portal.
 */
const postHandler = withSuperAdmin(
  async (_req: NextRequest, context: SuperAdminContext) => {
    if (!isPortalSwitchConfigured()) {
      return NextResponse.json(
        {
          error:
            "Portal switch is not configured. Set PET_TAGS_APP_URL and CROSS_PORTAL_SSO_SECRET.",
        },
        { status: 503 },
      );
    }

    const role = context.user.role?.toLowerCase();
    if (role !== "super_admin" && role !== "dev") {
      return NextResponse.json(
        { error: "Only superadmins can switch portals." },
        { status: 403 },
      );
    }

    const dbUser = await prisma.user.findUnique({
      where: { user_id: context.user.userId },
      select: {
        email: true,
        first_name: true,
        last_name: true,
        role: true,
      },
    });

    if (!dbUser?.email) {
      return NextResponse.json(
        { error: "Superadmin account email is required for portal switch." },
        { status: 400 },
      );
    }

    const fullName = [dbUser.first_name, dbUser.last_name]
      .filter(Boolean)
      .join(" ")
      .trim();

    try {
      const handoff = createPetTagsPortalSwitchToken({
        email: dbUser.email,
        fullName: fullName || context.user.email,
      });

      return NextResponse.json({
        redirectUrl: handoff.redirectUrl,
        expiresAt: handoff.expiresAt,
      });
    } catch (error) {
      console.error("[portal-switch] Failed to create handoff:", error);
      return NextResponse.json(
        { error: "Unable to start portal switch right now." },
        { status: 500 },
      );
    }
  },
);

export const POST = postHandler;
