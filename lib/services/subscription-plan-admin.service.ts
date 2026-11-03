import { Prisma } from "@prisma/client";
import { prisma } from "@/server/lib/prisma";
import {
  createProductPromoError,
  ProductPromoErrorCode,
} from "@/lib/errors/product-promo-errors";

export type SubscriptionPlanData = {
  name: string;
  tier_code: string;
  description?: string;
  price_monthly?: number;
  price_yearly?: number;
  features?: string[];
  place_before_plan_id?: number | null;
  max_virtual_cards?: number | null;
  max_physical_cards?: number | null;
  max_themes?: number;
  max_associates?: number | null;
  can_create_company?: boolean;
  can_upload_gallery?: boolean;
  can_manage_inquiries?: boolean;
  can_real_time_analytics?: boolean;
  trial_days?: number;
  is_trial?: boolean;
};

export type SubscriptionPlanUpdateData = Partial<SubscriptionPlanData> & {
  is_active?: boolean;
};

function parseFeatures(input: string | null | undefined): string[] {
  if (!input) return [];
  try {
    const parsed = JSON.parse(input) as unknown;
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function toPlanResponse(plan: {
  id: bigint;
  name: string;
  description: string | null;
  tier_code: string;
  price_monthly: Prisma.Decimal | null;
  price_yearly: Prisma.Decimal | null;
  features: string | null;
  display_order: number;
  is_active: boolean;
  is_trial: boolean;
  trial_days: number;
  max_virtual_cards: number | null;
  max_physical_cards: number | null;
  max_themes: number;
  max_associates: number | null;
  can_create_company: boolean;
  can_upload_gallery: boolean;
  can_manage_inquiries: boolean;
  can_real_time_analytics: boolean;
  created_at: Date;
  updated_at: Date | null;
}) {
  return {
    id: plan.id.toString(),
    name: plan.name,
    description: plan.description,
    tier_code: plan.tier_code,
    price_monthly: plan.price_monthly ? Number(plan.price_monthly) : 0,
    price_yearly: plan.price_yearly ? Number(plan.price_yearly) : 0,
    features: parseFeatures(plan.features),
    display_order: plan.display_order,
    is_active: plan.is_active,
    is_trial: plan.is_trial,
    trial_days: plan.trial_days,
    max_virtual_cards: plan.max_virtual_cards,
    max_physical_cards: plan.max_physical_cards,
    max_themes: plan.max_themes,
    max_associates: plan.max_associates,
    can_create_company: plan.can_create_company,
    can_upload_gallery: plan.can_upload_gallery,
    can_manage_inquiries: plan.can_manage_inquiries,
    can_real_time_analytics: plan.can_real_time_analytics,
    created_at: plan.created_at,
    updated_at: plan.updated_at,
  };
}

export class SubscriptionPlanAdminService {
  constructor(private readonly requestId: string) {}

  async listPlans(includeInactive = true) {
    const plans = await prisma.subscriptionPlan.findMany({
      where: includeInactive ? {} : { is_active: true },
      orderBy: [{ display_order: "asc" }, { price_monthly: "asc" }],
    });
    return plans.map(toPlanResponse);
  }

  async getPlanById(planId: number) {
    const plan = await prisma.subscriptionPlan.findUnique({
      where: { id: BigInt(planId) },
    });
    if (!plan) {
      throw createProductPromoError(
        ProductPromoErrorCode.PRODUCT_NOT_FOUND,
        "Subscription plan not found",
        404,
        this.requestId,
        { planId }
      );
    }
    return toPlanResponse(plan);
  }

  private async resolveDisplayOrder(placeBeforePlanId?: number | null): Promise<number> {
    if (!placeBeforePlanId) {
      const max = await prisma.subscriptionPlan.aggregate({ _max: { display_order: true } });
      return (max._max.display_order ?? -1) + 1;
    }

    const target = await prisma.subscriptionPlan.findUnique({
      where: { id: BigInt(placeBeforePlanId) },
      select: { display_order: true },
    });
    if (!target) {
      const max = await prisma.subscriptionPlan.aggregate({ _max: { display_order: true } });
      return (max._max.display_order ?? -1) + 1;
    }

    const insertAt = target.display_order;
    await prisma.subscriptionPlan.updateMany({
      where: { display_order: { gte: insertAt } },
      data: { display_order: { increment: 1 } },
    });
    return insertAt;
  }

  async createPlan(data: SubscriptionPlanData) {
    if (!data.name?.trim() || data.name.trim().length < 2) {
      throw createProductPromoError(
        ProductPromoErrorCode.PRODUCT_CREATION_FAILED,
        "Plan name must be at least 2 characters",
        400,
        this.requestId
      );
    }
    if (!data.tier_code?.trim()) {
      throw createProductPromoError(
        ProductPromoErrorCode.PRODUCT_CREATION_FAILED,
        "Tier code is required",
        400,
        this.requestId
      );
    }

    const existing = await prisma.subscriptionPlan.findFirst({
      where: {
        OR: [{ name: data.name.trim() }, { tier_code: data.tier_code.trim() }],
      },
    });
    if (existing) {
      throw createProductPromoError(
        ProductPromoErrorCode.PRODUCT_NAME_EXISTS,
        "A plan with this name or tier code already exists",
        409,
        this.requestId
      );
    }

    const displayOrder = await this.resolveDisplayOrder(data.place_before_plan_id);

    const plan = await prisma.subscriptionPlan.create({
      data: {
        name: data.name.trim(),
        tier_code: data.tier_code.trim(),
        description: data.description?.trim() || null,
        price_monthly:
          data.price_monthly !== undefined ? new Prisma.Decimal(data.price_monthly) : null,
        price_yearly:
          data.price_yearly !== undefined ? new Prisma.Decimal(data.price_yearly) : null,
        features: JSON.stringify(data.features ?? []),
        display_order: displayOrder,
        max_virtual_cards: data.max_virtual_cards ?? null,
        max_physical_cards: data.max_physical_cards ?? null,
        max_themes: data.max_themes ?? 5,
        max_associates: data.max_associates ?? null,
        can_create_company: data.can_create_company ?? false,
        can_upload_gallery: data.can_upload_gallery ?? false,
        can_manage_inquiries: data.can_manage_inquiries ?? false,
        can_real_time_analytics: data.can_real_time_analytics ?? false,
        trial_days: data.trial_days ?? 0,
        is_trial: data.is_trial ?? false,
        is_active: true,
      },
    });

    return toPlanResponse(plan);
  }

  async updatePlan(planId: number, data: SubscriptionPlanUpdateData) {
    const existing = await prisma.subscriptionPlan.findUnique({
      where: { id: BigInt(planId) },
    });
    if (!existing) {
      throw createProductPromoError(
        ProductPromoErrorCode.PRODUCT_NOT_FOUND,
        "Subscription plan not found",
        404,
        this.requestId,
        { planId }
      );
    }

    if (data.name && data.name.trim() !== existing.name) {
      const dup = await prisma.subscriptionPlan.findFirst({
        where: { name: data.name.trim(), NOT: { id: existing.id } },
      });
      if (dup) {
        throw createProductPromoError(
          ProductPromoErrorCode.PRODUCT_NAME_EXISTS,
          "A plan with this name already exists",
          409,
          this.requestId
        );
      }
    }

    let displayOrder = existing.display_order;
    if (data.place_before_plan_id !== undefined && data.place_before_plan_id !== null) {
      displayOrder = await this.resolveDisplayOrder(data.place_before_plan_id);
    }

    const plan = await prisma.subscriptionPlan.update({
      where: { id: existing.id },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.tier_code !== undefined ? { tier_code: data.tier_code.trim() } : {}),
        ...(data.description !== undefined ? { description: data.description?.trim() || null } : {}),
        ...(data.price_monthly !== undefined
          ? { price_monthly: new Prisma.Decimal(data.price_monthly) }
          : {}),
        ...(data.price_yearly !== undefined
          ? { price_yearly: new Prisma.Decimal(data.price_yearly) }
          : {}),
        ...(data.features !== undefined ? { features: JSON.stringify(data.features) } : {}),
        ...(data.place_before_plan_id !== undefined ? { display_order: displayOrder } : {}),
        ...(data.max_virtual_cards !== undefined ? { max_virtual_cards: data.max_virtual_cards } : {}),
        ...(data.max_physical_cards !== undefined ? { max_physical_cards: data.max_physical_cards } : {}),
        ...(data.max_themes !== undefined ? { max_themes: data.max_themes } : {}),
        ...(data.max_associates !== undefined ? { max_associates: data.max_associates } : {}),
        ...(data.can_create_company !== undefined ? { can_create_company: data.can_create_company } : {}),
        ...(data.can_upload_gallery !== undefined ? { can_upload_gallery: data.can_upload_gallery } : {}),
        ...(data.can_manage_inquiries !== undefined ? { can_manage_inquiries: data.can_manage_inquiries } : {}),
        ...(data.can_real_time_analytics !== undefined
          ? { can_real_time_analytics: data.can_real_time_analytics }
          : {}),
        ...(data.trial_days !== undefined ? { trial_days: data.trial_days } : {}),
        ...(data.is_trial !== undefined ? { is_trial: data.is_trial } : {}),
        ...(data.is_active !== undefined ? { is_active: data.is_active } : {}),
        updated_at: new Date(),
      },
    });

    return toPlanResponse(plan);
  }

  async deletePlan(planId: number) {
    const existing = await prisma.subscriptionPlan.findUnique({
      where: { id: BigInt(planId) },
    });
    if (!existing) {
      throw createProductPromoError(
        ProductPromoErrorCode.PRODUCT_NOT_FOUND,
        "Subscription plan not found",
        404,
        this.requestId,
        { planId }
      );
    }

    const activeSubscriptions = await prisma.bizcardSubscription.count({
      where: {
        plan_id: existing.id,
        status: { in: ["active", "pending"] },
      },
    });

    if (activeSubscriptions > 0 && existing.is_active) {
      await prisma.subscriptionPlan.update({
        where: { id: existing.id },
        data: { is_active: false, updated_at: new Date() },
      });
      return { softDeleted: true, planId: planId.toString() };
    }

    await prisma.subscriptionPlan.update({
      where: { id: existing.id },
      data: { is_active: false, updated_at: new Date() },
    });

    return { softDeleted: true, planId: planId.toString() };
  }
}
