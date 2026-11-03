import { NextRequest, NextResponse } from "next/server";
import { withDashboardSuperAdmin } from "@/lib/auth/superadmin-middleware";
import {
  featureFlagsAvailable,
  findControlDef,
  getPortalPageControls,
} from "@/lib/services/dev/page-controls.service";
import { prisma } from "@/server/lib/prisma";
import { logAuditEvent, getClientIp, getUserAgent } from "@/server/lib/auth";
import {
  createSuperadminNotification,
  getSuperadminUserIds,
} from "@/lib/services/superadmin-notifications.service";

export const PATCH = withDashboardSuperAdmin(
  async (request: NextRequest, context) => {
    try {
      const { flagKey } = await (
        context as unknown as { params: Promise<{ flagKey: string }> }
      ).params;
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      const enabled = Boolean(body.enabled);
      const note = typeof body.note === "string" ? body.note.trim() : "";
      const actorEmail = context.user.email;
      const actorId = context.user.userId;

      if (!(await featureFlagsAvailable())) {
        return NextResponse.json(
          {
            success: false,
            error: "DevFeatureFlag table is not available yet. Run the Prisma migration first.",
          },
          { status: 409 },
        );
      }

      const def = findControlDef(flagKey);
      const current = (await getPortalPageControls()).find((item) => item.key === flagKey);
      if (!def || !current) {
        return NextResponse.json(
          { success: false, error: "Unknown portal page control." },
          { status: 404 },
        );
      }

      await prisma.$executeRawUnsafe(
        `
          INSERT INTO DevFeatureFlag (
            flag_key,
            label,
            description,
            scope,
            enabled,
            note,
            updated_by,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
          ON DUPLICATE KEY UPDATE
            label = VALUES(label),
            description = VALUES(description),
            scope = VALUES(scope),
            enabled = VALUES(enabled),
            note = VALUES(note),
            updated_by = VALUES(updated_by),
            updated_at = NOW()
        `,
        current.key,
        current.label,
        current.description,
        current.portal,
        enabled ? 1 : 0,
        note || null,
        actorId,
      );

      await logAuditEvent(
        "DEV_PORTAL_PAGE_CONTROL_UPDATED",
        Number(actorId),
        getClientIp(request),
        getUserAgent(request),
        {
          flagKey,
          portal: current.portal,
          href: current.href,
          enabled,
          previousEnabled: current.enabled,
          note,
          actorEmail,
        },
      );

      const saIds = await getSuperadminUserIds();
      await Promise.all(
        saIds.map((saId) =>
          createSuperadminNotification({
            superadminUserId: saId,
            eventType: "sa_dev_control_changed",
            title: enabled
              ? `Page restored: ${current.label}`
              : `Page under maintenance: ${current.label}`,
            message: `${actorEmail} turned ${current.label} (${current.portal} portal) ${
              enabled ? "ON" : "OFF"
            }.`,
            actionUrl: "/dev/controls",
            actionText: "Open Controls",
            priority: enabled ? "medium" : "high",
            metadata: {
              flagKey,
              portal: current.portal,
              enabled,
              actorEmail,
            },
          }),
        ),
      );

      return NextResponse.json({
        success: true,
        data: {
          key: current.key,
          enabled,
          label: current.label,
          portal: current.portal,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update control.";
      return NextResponse.json({ success: false, error: message }, { status: 400 });
    }
  },
);
