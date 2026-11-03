import { NextRequest, NextResponse } from "next/server";
import {
  getDisabledPortalPages,
  getPortalPageControls,
} from "@/lib/services/dev/page-controls.service";
import type { PortalPageScope } from "@/lib/portal/page-controls";
import { pathsBlockedByControl } from "@/lib/portal/page-controls";

/**
 * Public (session optional) read of which portal pages are under maintenance.
 * Used by user / admin / staff layouts to gate navigation and show a modal.
 */
export async function GET(request: NextRequest) {
  try {
    const portalParam = request.nextUrl.searchParams.get("portal");
    const portal =
      portalParam === "user" || portalParam === "admin" || portalParam === "staff"
        ? (portalParam as PortalPageScope)
        : undefined;

    const disabled = await getDisabledPortalPages(portal);
    const all = portal
      ? (await getPortalPageControls()).filter((page) => page.portal === portal)
      : await getPortalPageControls();

    return NextResponse.json(
      {
        success: true,
        data: {
          portal: portal ?? null,
          pages: all.map((page) => ({
            key: page.key,
            portal: page.portal,
            label: page.label,
            href: page.href,
            description: page.description,
            enabled: page.enabled,
            matchPrefixes: page.matchPrefixes ?? [],
            blockedPaths: pathsBlockedByControl(page),
          })),
          disabled: disabled.map((page) => ({
            key: page.key,
            portal: page.portal,
            label: page.label,
            href: page.href,
            description: page.description,
            matchPrefixes: page.matchPrefixes ?? [],
            blockedPaths: pathsBlockedByControl(page),
          })),
        },
      },
      {
        headers: {
          "Cache-Control": "private, max-age=15",
        },
      },
    );
  } catch (error) {
    console.error("[portal/page-access] failed", error);
    return NextResponse.json(
      { success: false, error: "Failed to load page access." },
      { status: 500 },
    );
  }
}
