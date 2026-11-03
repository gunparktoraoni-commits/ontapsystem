import { prisma } from "@/server/lib/prisma";
import { buildVCardPublicUrl } from "@/server/lib/qr";
import { SerialIdService } from "@/lib/services/serialIdService";
import {
  buildClaimCreateSeparatePath,
  buildClaimLoginPath,
  buildClaimMergePath,
  buildClaimSignupPath,
} from "@/lib/bizcard/claim-urls";

function buildPortfolioUrlFromAlias(customUri: string | null): string | null {
  if (!customUri) return null;
  return buildVCardPublicUrl(customUri) ?? buildPortfolioSerialUrl(customUri);
}

function normalizeNonSerialPortfolioUrl(
  serialId: string,
  portfolioUrl: string | null | undefined
): string | null {
  const trimmed = typeof portfolioUrl === "string" ? portfolioUrl.trim() : "";
  if (!trimmed) return null;
  try {
    const path = new URL(
      trimmed,
      getAppBase() || "https://local.invalid"
    ).pathname.replace(/^\/+|\/+$/g, "");
    if (path.toUpperCase() === serialId.trim().toUpperCase()) return null;
  } catch {
    if (trimmed.toUpperCase().endsWith(`/${serialId.trim().toUpperCase()}`)) return null;
  }
  return trimmed;
}

export type ScanNextAction = "show_portfolio" | "signup" | "merge_choice" | "manual_register";

export type VirtualCardSummary = {
  id: string;
  name: string;
  title: string | null;
  fullName: string;
  createdAt: string;
};

export type PhysicalCardScanResult = {
  serialId: string;
  status: "linked" | "blank" | "not_found" | "deactivated";
  isPlaceholder: boolean;
  nextAction: ScanNextAction;
  portfolioUrl: string | null;
  customUri: string | null;
  redirectUrl: string | null;
  virtualCards: VirtualCardSummary[];
};

function getAppBase(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_BASE_URL ??
    process.env.FRONTEND_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "")
  ).replace(/\/$/, "");
}

export function buildPortfolioSerialUrl(serialId: string): string {
  const base = getAppBase();
  const normalized = serialId.trim().toUpperCase();
  if (!base) return `/${encodeURIComponent(normalized)}`;
  return `${base}/${encodeURIComponent(normalized)}`;
}

export function buildSignupUrl(serialId: string): string {
  const base = getAppBase();
  const path = buildClaimSignupPath(serialId);
  return base ? `${base}${path}` : path;
}

/** Login with serial preserved so post-auth scan routing can classify merge vs create. */
export function buildLoginUrl(serialId: string): string {
  const base = getAppBase();
  const path = buildClaimLoginPath(serialId);
  return base ? `${base}${path}` : path;
}

/** Pre-registration welcome page shown after scanning a blank physical BizCard QR. */
export function buildOnboardingUrl(serialId: string): string {
  const base = getAppBase();
  const path = `/user/onboarding?ref=${encodeURIComponent(serialId.trim().toUpperCase())}`;
  return base ? `${base}${path}` : path;
}

export function buildManualRegisterUrl(serialId: string): string {
  const base = getAppBase();
  const path = buildClaimCreateSeparatePath(serialId);
  return base ? `${base}${path}` : path;
}

export function buildMergeChoiceUrl(serialId: string, virtualId?: string): string {
  const base = getAppBase();
  const path = buildClaimMergePath(serialId, virtualId);
  return base ? `${base}${path}` : path;
}

export function buildMergeSuccessUrl(serialId: string, portfolioAlias: string): string {
  const base = getAppBase();
  const serial = encodeURIComponent(serialId.trim().toUpperCase());
  const alias = encodeURIComponent(portfolioAlias.trim());
  const path = `/scan/${serial}/merge/success?alias=${alias}`;
  return base ? `${base}${path}` : path;
}

export function isPlaceholderBizcard(row: {
  is_blank?: boolean;
  first_name?: string;
  last_name?: string;
  email?: string;
  bizcard_name?: string;
}): boolean {
  if (row.is_blank) return true;
  const email = (row.email ?? "").toLowerCase();
  const name = (row.bizcard_name ?? "").toLowerCase();
  if (email.startsWith("blank+") && email.endsWith("@temp.ontap.ph")) return true;
  if (name.startsWith("blank card")) return true;
  if (row.first_name === "Blank" && row.last_name === "Card") return true;
  if (row.first_name === "Unassigned" && row.last_name === "Physical Card") return true;
  return false;
}

export async function findVirtualCardsForMerge(userId: bigint): Promise<VirtualCardSummary[]> {
  const rows = await prisma.bizcard.findMany({
    where: {
      user_id: userId,
      bizcard_type: "virtual",
      serial_id: null,
      is_merged: false,
      deactivated_flag: false,
    },
    select: {
      bizcard_id: true,
      bizcard_name: true,
      professional_title: true,
      first_name: true,
      last_name: true,
      created_at: true,
    },
    orderBy: { created_at: "desc" },
  });

  return rows.map((card) => ({
    id: card.bizcard_id.toString(),
    name: card.bizcard_name,
    title: card.professional_title,
    fullName: `${card.first_name} ${card.last_name}`.trim(),
    createdAt: card.created_at.toISOString(),
  }));
}

export async function resolvePhysicalCardScan(
  rawSerialId: string,
  sessionUserId?: bigint | null
): Promise<PhysicalCardScanResult> {
  const serialService = SerialIdService.getInstance();
  const serialId = serialService.normalizeSerialId(rawSerialId) ?? rawSerialId.trim().toUpperCase();

  const emptyResult = (status: PhysicalCardScanResult["status"]): PhysicalCardScanResult => ({
    serialId,
    status,
    isPlaceholder: false,
    nextAction: "signup",
    portfolioUrl: null,
    customUri: null,
    redirectUrl: status === "not_found" ? null : buildSignupUrl(serialId),
    virtualCards: [],
  });

  if (!serialService.validateSerialId(serialId)) {
    return emptyResult("not_found");
  }

  const bizcard = await prisma.bizcard.findFirst({
    where: {
      serial_id: serialId,
      deactivated_flag: false,
    },
    select: {
      bizcard_id: true,
      serial_id: true,
      url_alias: true,
      portfolio_url: true,
      is_blank: true,
      is_merged: true,
      user_id: true,
      first_name: true,
      last_name: true,
      email: true,
      bizcard_name: true,
      bizcard_type: true,
      user: {
        select: {
          is_active: true,
          custom_uri: true,
        },
      },
    },
  });

  if (!bizcard) {
    const employeeCard = await prisma.employeeCard.findUnique({
      where: { serial_id: serialId },
      select: {
        assigned_user_id: true,
        activation_status: true,
      },
    });

    if (!employeeCard) {
      return emptyResult("not_found");
    }

    if (employeeCard.activation_status === "inactive" || employeeCard.activation_status === "revoked") {
      return emptyResult("deactivated");
    }

    if (!employeeCard.assigned_user_id) {
      return resolveBlankCard(serialId, true, sessionUserId);
    }

    const linked = await prisma.bizcard.findFirst({
      where: {
        user_id: employeeCard.assigned_user_id,
        deactivated_flag: false,
      },
      orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
      select: {
        url_alias: true,
        portfolio_url: true,
        user: { select: { is_active: true, custom_uri: true } },
      },
    });

    if (!linked?.user?.is_active) {
      return emptyResult("deactivated");
    }

    const customUri = linked.url_alias ?? linked.user?.custom_uri ?? null;
    const portfolioUrl =
      buildPortfolioUrlFromAlias(customUri) ??
      normalizeNonSerialPortfolioUrl(serialId, linked.portfolio_url);

    return {
      serialId,
      status: "linked",
      isPlaceholder: false,
      nextAction: "show_portfolio",
      portfolioUrl,
      customUri,
      redirectUrl: portfolioUrl,
      virtualCards: [],
    };
  }

  const isBlank =
    !bizcard.user_id &&
    !bizcard.is_merged &&
    (bizcard.is_blank || isPlaceholderBizcard(bizcard) || bizcard.bizcard_type === "physical");

  if (isBlank) {
    return resolveBlankCard(serialId, isPlaceholderBizcard(bizcard), sessionUserId);
  }

  if (!bizcard.user?.is_active) {
    return emptyResult("deactivated");
  }

  const customUri = bizcard.url_alias ?? bizcard.user?.custom_uri ?? null;
  const portfolioUrl =
    buildPortfolioUrlFromAlias(customUri) ??
    normalizeNonSerialPortfolioUrl(serialId, bizcard.portfolio_url);

  return {
    serialId,
    status: "linked",
    isPlaceholder: false,
    nextAction: "show_portfolio",
    portfolioUrl,
    customUri,
    redirectUrl: portfolioUrl,
    virtualCards: [],
  };
}

export type SerialCanonicalResolution =
  | { outcome: "redirect"; alias: string }
  | { outcome: "render_in_place" }
  | { outcome: "defer" }
  | { outcome: "not_found" };

function classifyCanonicalAlias(
  serialId: string,
  urlAlias: string | null | undefined,
  customUri: string | null | undefined
): SerialCanonicalResolution {
  const canonical = (urlAlias ?? customUri ?? "").trim();
  if (!canonical) return { outcome: "render_in_place" };
  if (canonical.toUpperCase() === serialId.trim().toUpperCase()) {
    return { outcome: "render_in_place" };
  }
  return { outcome: "redirect", alias: canonical };
}

/**
 * Server-side serial → canonical alias resolution for the public portfolio page.
 * Prefer redirect when a distinct alias exists; render in place for legacy rows
 * where url_alias equals the serial; defer blank/claim/deactivated flows to the client.
 */
export async function resolveSerialCanonicalAlias(
  rawSerialId: string
): Promise<SerialCanonicalResolution> {
  const serialService = SerialIdService.getInstance();
  const serialId =
    serialService.normalizeSerialId(rawSerialId) ?? rawSerialId.trim().toUpperCase();

  if (!serialService.validateSerialId(serialId)) {
    return { outcome: "defer" };
  }

  const bizcard = await prisma.bizcard.findFirst({
    where: {
      serial_id: serialId,
      deactivated_flag: false,
    },
    select: {
      bizcard_id: true,
      serial_id: true,
      url_alias: true,
      is_blank: true,
      is_merged: true,
      user_id: true,
      first_name: true,
      last_name: true,
      email: true,
      bizcard_name: true,
      bizcard_type: true,
      user: {
        select: {
          is_active: true,
          custom_uri: true,
        },
      },
    },
  });

  if (bizcard) {
    const isBlank =
      !bizcard.user_id &&
      !bizcard.is_merged &&
      (bizcard.is_blank || isPlaceholderBizcard(bizcard) || bizcard.bizcard_type === "physical");

    if (isBlank) {
      return { outcome: "defer" };
    }

    if (!bizcard.user?.is_active) {
      return { outcome: "defer" };
    }

    return classifyCanonicalAlias(serialId, bizcard.url_alias, bizcard.user?.custom_uri);
  }

  const employeeCard = await prisma.employeeCard.findUnique({
    where: { serial_id: serialId },
    select: {
      assigned_user_id: true,
      activation_status: true,
    },
  });

  if (employeeCard) {
    if (
      employeeCard.activation_status === "inactive" ||
      employeeCard.activation_status === "revoked"
    ) {
      return { outcome: "defer" };
    }

    if (!employeeCard.assigned_user_id) {
      return { outcome: "defer" };
    }

    const linked = await prisma.bizcard.findFirst({
      where: {
        user_id: employeeCard.assigned_user_id,
        deactivated_flag: false,
      },
      orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
      select: {
        url_alias: true,
        user: { select: { is_active: true, custom_uri: true } },
      },
    });

    if (!linked?.user?.is_active) {
      return { outcome: "defer" };
    }

    return classifyCanonicalAlias(serialId, linked.url_alias, linked.user?.custom_uri);
  }

  // Before 404, confirm the slug is not a genuine custom alias.
  const aliasSlug = serialId.toLowerCase();
  const aliasMatch = await prisma.bizcard.findFirst({
    where: {
      is_blank: false,
      deactivated_flag: false,
      OR: [{ url_alias: aliasSlug }, { user: { custom_uri: aliasSlug } }],
    },
    select: { bizcard_id: true },
  });

  if (aliasMatch) {
    return { outcome: "defer" };
  }

  return { outcome: "not_found" };
}

async function resolveBlankCard(
  serialId: string,
  isPlaceholder: boolean,
  sessionUserId?: bigint | null
): Promise<PhysicalCardScanResult> {
  const portfolioUrl = buildPortfolioSerialUrl(serialId);

  if (!sessionUserId) {
    return {
      serialId,
      status: "blank",
      isPlaceholder,
      nextAction: "signup",
      portfolioUrl,
      customUri: null,
      redirectUrl: buildSignupUrl(serialId),
      virtualCards: [],
    };
  }

  const virtualCards = await findVirtualCardsForMerge(sessionUserId);
  if (virtualCards.length > 0) {
    return {
      serialId,
      status: "blank",
      isPlaceholder,
      nextAction: "merge_choice",
      portfolioUrl,
      customUri: null,
      redirectUrl: buildMergeChoiceUrl(serialId, virtualCards[0]?.id),
      virtualCards,
    };
  }

  // No mergeable virtual card exists, so register this physical card separately.
  return {
    serialId,
    status: "blank",
    isPlaceholder,
    nextAction: "manual_register",
    portfolioUrl,
    customUri: null,
    redirectUrl: buildManualRegisterUrl(serialId),
    virtualCards: [],
  };
}
