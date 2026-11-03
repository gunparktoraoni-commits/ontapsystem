import { prisma } from "@/server/lib/prisma";
import {
  getOrGenerateAffiliateCode,
  recordShopOrderAffiliateAttribution,
  resolveCommissionRate,
  type ShopAffiliateMeta,
} from "@/server/lib/affiliate";
import { SupportMessagingService } from "@/lib/services/support-messaging.service";

function parseAffiliateMeta(
  raw: unknown,
): ShopAffiliateMeta | Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (obj.affiliate_user_id == null && obj.affiliateUserId == null) return null;
  return obj;
}

export async function getActiveStaffAssignment(clientUserId: bigint) {
  return prisma.staffClientAssignment.findFirst({
    where: {
      client_user_id: clientUserId,
      is_active: true,
    },
    select: {
      assignment_id: true,
      staff_id: true,
      assigned_at: true,
    },
    orderBy: { assigned_at: "desc" },
  });
}

/**
 * Soft-assign a client to a staff user (used after first staff referral purchase).
 * Does not steal clients already assigned to a different staff member.
 */
export async function ensureStaffClientAssignment(params: {
  staffUserId: bigint;
  clientUserId: bigint;
  notes?: string;
  syncSupport?: boolean;
}): Promise<{
  assigned: boolean;
  staffId: bigint;
  created: boolean;
  alreadyAssignedToOther: boolean;
}> {
  const staffUserId = params.staffUserId;
  const clientUserId = params.clientUserId;
  if (staffUserId === clientUserId) {
    return {
      assigned: false,
      staffId: staffUserId,
      created: false,
      alreadyAssignedToOther: false,
    };
  }

  const staff = await prisma.user.findUnique({
    where: { user_id: staffUserId },
    select: {
      user_id: true,
      role: true,
      is_active: true,
      staffProfile: { select: { is_active: true } },
    },
  });
  if (
    !staff ||
    staff.role !== "staff" ||
    !staff.is_active ||
    !staff.staffProfile?.is_active
  ) {
    return {
      assigned: false,
      staffId: staffUserId,
      created: false,
      alreadyAssignedToOther: false,
    };
  }

  const existing = await prisma.staffClientAssignment.findFirst({
    where: { client_user_id: clientUserId, is_active: true },
    select: { assignment_id: true, staff_id: true },
  });

  if (existing) {
    if (existing.staff_id === staffUserId) {
      return {
        assigned: true,
        staffId: staffUserId,
        created: false,
        alreadyAssignedToOther: false,
      };
    }
    return {
      assigned: true,
      staffId: existing.staff_id,
      created: false,
      alreadyAssignedToOther: true,
    };
  }

  await prisma.staffClientAssignment.upsert({
    where: {
      staff_id_client_user_id: {
        staff_id: staffUserId,
        client_user_id: clientUserId,
      },
    },
    create: {
      staff_id: staffUserId,
      client_user_id: clientUserId,
      is_active: true,
      is_primary: true,
      assigned_at: new Date(),
      notes:
        params.notes ??
        "Auto-assigned from staff referral link on first purchase",
    },
    update: {
      is_active: true,
      is_primary: true,
      assigned_at: new Date(),
      notes:
        params.notes ??
        "Auto-assigned from staff referral link on first purchase",
    },
  });

  if (params.syncSupport !== false) {
    try {
      await new SupportMessagingService().synchronizeClientAssignment(
        clientUserId,
        staffUserId,
        staffUserId,
      );
    } catch (error) {
      console.warn("[staff-commission] support sync skipped", error);
    }
  }

  return {
    assigned: true,
    staffId: staffUserId,
    created: true,
    alreadyAssignedToOther: false,
  };
}

async function buildStaffAffiliateMeta(
  staffUserId: bigint,
  orderTotal: number,
  source: string,
): Promise<ShopAffiliateMeta | null> {
  const staff = await prisma.user.findUnique({
    where: { user_id: staffUserId },
    select: {
      user_id: true,
      role: true,
      is_active: true,
      commission_rate: true,
      affiliate_code: true,
      is_affiliate_restricted: true,
      staffProfile: { select: { is_active: true } },
      affiliateSettings: { select: { commission_rate: true } },
    },
  });
  if (
    !staff ||
    staff.role !== "staff" ||
    !staff.is_active ||
    !staff.staffProfile?.is_active ||
    staff.is_affiliate_restricted
  ) {
    return null;
  }

  const code =
    staff.affiliate_code ||
    (await getOrGenerateAffiliateCode(staff.user_id));
  const rate = resolveCommissionRate(
    staff.commission_rate != null ? Number(staff.commission_rate) : null,
    staff.affiliateSettings?.commission_rate != null
      ? Number(staff.affiliateSettings.commission_rate)
      : null,
  );

  return {
    affiliate_user_id: staff.user_id.toString(),
    affiliate_code: code,
    commission_rate: rate,
    discount_percent: 0,
    discount_amount: 0,
    attribution_source: source,
    order_total: orderTotal,
  };
}

/**
 * Resolve who earns commission for a paid shop order and record it.
 *
 * Rules:
 * 1. If the buyer used a staff referral on (typically first) purchase, auto-assign
 *    that client to the staff (when not already assigned elsewhere).
 * 2. If the buyer is assigned to staff, that staff earns commission on this order
 *    and every subsequent order.
 * 3. Otherwise fall back to explicit affiliate meta on the order (non-staff affiliates).
 */
export async function attributePaidShopOrderCommission(params: {
  shopOrderId: bigint | number;
  buyerUserId: bigint | number;
  orderTotal: number;
  affiliateMetaFromOrder?: unknown;
}): Promise<{
  attributed: boolean;
  source: "staff_assignment" | "affiliate_referral" | "none";
  beneficiaryUserId: string | null;
}> {
  const buyerUserId = BigInt(params.buyerUserId);
  const shopOrderId = BigInt(params.shopOrderId);
  const orderTotal = Number(params.orderTotal) || 0;
  const orderMeta = parseAffiliateMeta(params.affiliateMetaFromOrder);

  // Auto-assign when this order carries a staff referral and client is free.
  if (orderMeta) {
    const referrerId = BigInt(
      String(
        (orderMeta as Record<string, unknown>).affiliate_user_id ??
          (orderMeta as Record<string, unknown>).affiliateUserId,
      ),
    );
    if (referrerId !== buyerUserId) {
      const referrer = await prisma.user.findUnique({
        where: { user_id: referrerId },
        select: {
          user_id: true,
          role: true,
          is_active: true,
          staffProfile: { select: { is_active: true } },
        },
      });
      if (
        referrer?.role === "staff" &&
        referrer.is_active &&
        referrer.staffProfile?.is_active
      ) {
        await ensureStaffClientAssignment({
          staffUserId: referrer.user_id,
          clientUserId: buyerUserId,
          notes: `Auto-assigned from staff referral on shop order ${shopOrderId.toString()}`,
        });
      }
    }
  }

  const assignment = await getActiveStaffAssignment(buyerUserId);
  if (assignment) {
    const staffMeta = await buildStaffAffiliateMeta(
      assignment.staff_id,
      orderTotal,
      "staff_assignment",
    );
    if (staffMeta) {
      await recordShopOrderAffiliateAttribution({
        shopOrderId,
        referredUserId: buyerUserId,
        affiliateMeta: staffMeta,
        orderTotal,
      });
      return {
        attributed: true,
        source: "staff_assignment",
        beneficiaryUserId: staffMeta.affiliate_user_id,
      };
    }
  }

  if (orderMeta) {
    const enriched = {
      ...orderMeta,
      attribution_source:
        (orderMeta as Record<string, unknown>).attribution_source ??
        "affiliate_referral",
      order_total: orderTotal,
    };
    await recordShopOrderAffiliateAttribution({
      shopOrderId,
      referredUserId: buyerUserId,
      affiliateMeta: enriched,
      orderTotal,
    });
    return {
      attributed: true,
      source: "affiliate_referral",
      beneficiaryUserId: String(
        (orderMeta as Record<string, unknown>).affiliate_user_id ??
          (orderMeta as Record<string, unknown>).affiliateUserId ??
          "",
      ),
    };
  }

  return { attributed: false, source: "none", beneficiaryUserId: null };
}
