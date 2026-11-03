import { Prisma } from "@prisma/client";
import { prisma } from "@/server/lib/prisma";
import { toJsonString } from "@/server/lib/json-field";
import {
  createProductPromoError,
  ProductPromoErrorCode,
} from "@/lib/errors/product-promo-errors";

export type PromoType =
  | "discount"
  | "buy_one_get_one"
  | "free_shipping"
  | "fixed_amount"
  | "percentage"
  | "free_merch";

export type TargetGroup =
  | "newly_registered"
  | "new_users"
  | "bulk_orders"
  | "frequent_buyers"
  | "first_time_buyers"
  | "all_users"
  | "subscription_basic"
  | "subscription_standard"
  | "subscription_premium"
  | "free_trial_users"
  | "company_admins";

export type PromoTag = "discount_promo" | "bogo" | "seasonal" | "clearance" | "welcome";

export interface PromoData {
  promo_name: string;
  description?: string;
  promo_type: PromoType;
  promo_img?: string;
  redirect_path?: string;
  discount_value?: number;
  discount_percentage?: number;
  start_date: Date;
  end_date: Date;
  target_groups: TargetGroup[];
  tags: PromoTag[];
  applicable_products?: number[];
  minimum_order_amount?: number;
  maximum_discount_amount?: number;
  usage_limit?: number;
  per_user_limit?: number;
}

export interface PromoUpdateData extends Partial<PromoData> {}

const PROMO_TYPES = new Set<PromoType>([
  "discount",
  "buy_one_get_one",
  "free_shipping",
  "fixed_amount",
  "percentage",
  "free_merch",
]);

const TARGET_GROUPS = new Set<TargetGroup>([
  "newly_registered",
  "new_users",
  "bulk_orders",
  "frequent_buyers",
  "first_time_buyers",
  "all_users",
  "subscription_basic",
  "subscription_standard",
  "subscription_premium",
  "free_trial_users",
  "company_admins",
]);

const PROMO_TAGS = new Set<PromoTag>(["discount_promo", "bogo", "seasonal", "clearance", "welcome"]);

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

type PromoWithComputed = {
  promo_id: number;
  promo_name: string;
  description: string | null;
  promo_type: string;
  promo_img: string | null;
  redirect_path: string | null;
  discount_value: number | null;
  discount_percentage: number | null;
  start_date: Date;
  end_date: Date;
  target_groups: TargetGroup[];
  tags: PromoTag[];
  applicable_products: number[] | null;
  minimum_order_amount: number | null;
  maximum_discount_amount: number | null;
  usage_limit: number | null;
  usage_count: number;
  per_user_limit: number;
  is_active: boolean;
  status: "active" | "scheduled" | "expired" | "inactive";
  days_remaining: number;
  created_at: Date;
  updated_at: Date | null;
};



function toPage(input: number | undefined): number {
  if (!input || !Number.isInteger(input)) return 1;
  return Math.max(1, input);
}

function toLimit(input: number | undefined): number {
  if (!input || !Number.isInteger(input)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, input));
}

function parseJsonArray<T>(input: unknown): T[] {
  if (!Array.isArray(input)) return [];
  return input as T[];
}

function roundTo2(value: number): number {
  return Math.round(value * 100) / 100;
}

function computePromoValue(data: { promo_type: PromoType; discount_value?: number; discount_percentage?: number }) {
  if (data.promo_type === "percentage") {
    return data.discount_percentage ?? 0;
  }

  if (data.promo_type === "fixed_amount" || data.promo_type === "discount") {
    return data.discount_value ?? 0;
  }

  return 0;
}

function normalizePromoType(type: string): PromoType {
  if (!PROMO_TYPES.has(type as PromoType)) {
    throw new Error("INVALID_PROMO_TYPE");
  }
  return type as PromoType;
}

function validatePromoData(requestId: string, data: PromoData | PromoUpdateData, partial = false): void {
  if (!partial || data.promo_name !== undefined) {
    if (!data.promo_name || data.promo_name.trim().length < 2) {
      throw createProductPromoError(
        ProductPromoErrorCode.PROMO_CREATION_FAILED,
        "Promo name must be at least 2 characters",
        400,
        requestId
      );
    }
  }


  
  if (!partial || data.promo_type !== undefined) {
    if (!data.promo_type || !PROMO_TYPES.has(data.promo_type)) {
      throw createProductPromoError(
        ProductPromoErrorCode.INVALID_PROMO_TYPE,
        "Invalid promo type",
        400,
        requestId,
        { promo_type: data.promo_type }
      );
    }
  }

  if (!partial || data.target_groups !== undefined) {
    if (!data.target_groups || data.target_groups.length === 0) {
      throw createProductPromoError(
        ProductPromoErrorCode.INVALID_TARGET_GROUP,
        "target_groups must contain at least one value",
        400,
        requestId
      );
    }

    for (const group of data.target_groups) {
      if (!TARGET_GROUPS.has(group)) {
        throw createProductPromoError(
          ProductPromoErrorCode.INVALID_TARGET_GROUP,
          "Invalid target group",
          400,
          requestId,
          { target_group: group }
        );
      }
    }
  }

  if (!partial || data.tags !== undefined) {
    if (!data.tags || data.tags.length === 0) {
      throw createProductPromoError(
        ProductPromoErrorCode.TARGET_GROUP_NOT_FOUND,
        "tags must contain at least one value",
        400,
        requestId
      );
    }

    for (const tag of data.tags) {
      if (!PROMO_TAGS.has(tag)) {
        throw createProductPromoError(
          ProductPromoErrorCode.TARGET_GROUP_NOT_FOUND,
          "Invalid promo tag",
          400,
          requestId,
          { tag }
        );
      }
    }
  }

  const hasDates = data.start_date !== undefined || data.end_date !== undefined;
  if (!partial || hasDates) {
    if (!data.start_date || !data.end_date) {
      throw createProductPromoError(
        ProductPromoErrorCode.INVALID_PROMO_DATES,
        "start_date and end_date are required",
        400,
        requestId
      );
    }

    if (data.start_date >= data.end_date) {
      throw createProductPromoError(
        ProductPromoErrorCode.START_DATE_AFTER_END_DATE,
        "start_date must be before end_date",
        400,
        requestId,
        {
          start_date: data.start_date.toISOString(),
          end_date: data.end_date.toISOString(),
        }
      );
    }
  }

  if ((!partial || data.promo_type !== undefined || data.discount_percentage !== undefined) &&
      data.promo_type === "percentage") {
    if (
      typeof data.discount_percentage !== "number" ||
      !Number.isInteger(data.discount_percentage) ||
      data.discount_percentage <= 0 ||
      data.discount_percentage > 100
    ) {
      throw createProductPromoError(
        ProductPromoErrorCode.INVALID_DISCOUNT_VALUE,
        "discount_percentage must be an integer between 1 and 100",
        400,
        requestId,
        { discount_percentage: data.discount_percentage }
      );
    }
  }

  if ((!partial || data.promo_type !== undefined || data.discount_value !== undefined) &&
      (data.promo_type === "fixed_amount" || data.promo_type === "discount")) {
    if (
      typeof data.discount_value !== "number" ||
      !Number.isFinite(data.discount_value) ||
      data.discount_value <= 0
    ) {
      throw createProductPromoError(
        ProductPromoErrorCode.INVALID_DISCOUNT_VALUE,
        "discount_value must be greater than 0",
        400,
        requestId,
        { discount_value: data.discount_value }
      );
    }
  }
}

function toPromoResponse(row: Prisma.PromotionGetPayload<Record<string, never>>): PromoWithComputed {
  const now = Date.now();
  const starts = row.starts_at.getTime();
  const ends = row.expires_at.getTime();

  const status: PromoWithComputed["status"] = !row.is_active
    ? "inactive"
    : ends < now
    ? "expired"
    : starts > now
    ? "scheduled"
    : "active";

  return {
    promo_id: Number(row.id),
    promo_name: row.promo_name,
    description: row.description,
    promo_type: row.promo_type,
    promo_img: row.promo_img,
    redirect_path: row.redirect_path,
    discount_value: row.discount_value ? Number(row.discount_value) : null,
    discount_percentage: row.discount_percentage,
    start_date: row.starts_at,
    end_date: row.expires_at,
    target_groups: parseJsonArray<TargetGroup>(row.target_groups),
    tags: parseJsonArray<PromoTag>(row.tags),
    applicable_products: row.applicable_products
      ? parseJsonArray<number>(row.applicable_products).map((v) => Number(v))
      : null,
    minimum_order_amount: row.minimum_order_amount ? Number(row.minimum_order_amount) : null,
    maximum_discount_amount: row.maximum_discount_amount ? Number(row.maximum_discount_amount) : null,
    usage_limit: row.usage_limit,
    usage_count: row.usage_count,
    per_user_limit: row.per_user_limit,
    is_active: row.is_active,
    status,
    days_remaining: Math.max(0, Math.ceil((ends - now) / (1000 * 60 * 60 * 24))),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class PromoService {
  constructor(private readonly requestId: string) {}

  async getAllPromos(filters: {
    page?: number;
    limit?: number;
    is_active?: boolean;
    promo_type?: PromoType;
    search?: string;
    sort_by?: string;
    sort_dir?: "asc" | "desc";
  }): Promise<{ promos: PromoWithComputed[]; pagination: Record<string, unknown> }> {
    const page = toPage(filters.page);
    const limit = toLimit(filters.limit);
    const skip = (page - 1) * limit;

    const allowedSort = new Set(["promo_name", "starts_at", "expires_at", "created_at"]);
    const sortBy = allowedSort.has(filters.sort_by ?? "") ? filters.sort_by! : "created_at";
    const sortDir = filters.sort_dir === "asc" ? "asc" : "desc";

    const where: Prisma.PromotionWhereInput = {
      ...(filters.is_active !== undefined ? { is_active: filters.is_active } : {}),
      ...(filters.promo_type ? { promo_type: filters.promo_type } : {}),
      ...(filters.search
        ? {
            OR: [
              { promo_name: { contains: filters.search } },
              { description: { contains: filters.search } },
              { code: { contains: filters.search } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.promotion.findMany({
        where,
        orderBy: { [sortBy]: sortDir },
        skip,
        take: limit,
      }),
      prisma.promotion.count({ where }),
    ]);

    return {
      promos: rows.map(toPromoResponse),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async getPromoById(promoId: number) {
    const row = await prisma.promotion.findUnique({ where: { id: BigInt(promoId) } });
    if (!row) {
      throw createProductPromoError(
        ProductPromoErrorCode.PROMO_NOT_FOUND,
        "Promo not found",
        404,
        this.requestId,
        { promoId }
      );
    }

    return toPromoResponse(row);
  }

  async createPromo(promoData: PromoData, createdBy: string) {
    validatePromoData(this.requestId, promoData, false);

    const existing = await prisma.promotion.findFirst({
      where: { promo_name: { equals: promoData.promo_name.trim() } },
      select: { id: true },
    });

    if (existing) {
      throw createProductPromoError(
        ProductPromoErrorCode.PROMO_NAME_EXISTS,
        "Promo name already exists",
        409,
        this.requestId,
        { promo_name: promoData.promo_name }
      );
    }

    const createdById = /^\d+$/.test(createdBy) ? BigInt(createdBy) : null;

    const created = await prisma.promotion.create({
      data: {
        promo_name: promoData.promo_name.trim(),
        description: promoData.description ?? null,
        promo_type: promoData.promo_type,
        promo_img: promoData.promo_img ?? null,
        redirect_path: promoData.redirect_path ? promoData.redirect_path.trim() : null,
        promo_value: new Prisma.Decimal(computePromoValue(promoData)),
        discount_value:
          promoData.discount_value !== undefined
            ? new Prisma.Decimal(promoData.discount_value)
            : null,
        discount_percentage: promoData.discount_percentage ?? null,
        starts_at: promoData.start_date,
        expires_at: promoData.end_date,
        target_groups: toJsonString(promoData.target_groups),
        tags: toJsonString(promoData.tags),
        applicable_products:
          promoData.applicable_products !== undefined
            ? toJsonString(promoData.applicable_products)
            : undefined,
        minimum_order_amount:
          promoData.minimum_order_amount !== undefined
            ? new Prisma.Decimal(promoData.minimum_order_amount)
            : null,
        maximum_discount_amount:
          promoData.maximum_discount_amount !== undefined
            ? new Prisma.Decimal(promoData.maximum_discount_amount)
            : null,
        min_purchase_amount:
          promoData.minimum_order_amount !== undefined
            ? new Prisma.Decimal(promoData.minimum_order_amount)
            : null,
        max_discount_amount:
          promoData.maximum_discount_amount !== undefined
            ? new Prisma.Decimal(promoData.maximum_discount_amount)
            : null,
        usage_limit: promoData.usage_limit ?? null,
        per_user_limit: promoData.per_user_limit ?? 1,
        is_active: true,
        created_by: createdById,
      },
    });

    await this.writeAudit(createdBy, "promo.create", {
      promoId: created.id.toString(),
      promoName: created.promo_name,
    });

    return toPromoResponse(created);
  }

  async updatePromo(promoId: number, promoData: PromoUpdateData, updatedBy: string) {
    validatePromoData(this.requestId, promoData, true);

    const current = await prisma.promotion.findUnique({ where: { id: BigInt(promoId) } });
    if (!current) {
      throw createProductPromoError(
        ProductPromoErrorCode.PROMO_NOT_FOUND,
        "Promo not found",
        404,
        this.requestId,
        { promoId }
      );
    }

    if (promoData.promo_name && promoData.promo_name.trim() !== current.promo_name) {
      const dup = await prisma.promotion.findFirst({
        where: {
          promo_name: { equals: promoData.promo_name.trim() },
          NOT: { id: current.id },
        },
        select: { id: true },
      });
      if (dup) {
        throw createProductPromoError(
          ProductPromoErrorCode.PROMO_NAME_EXISTS,
          "Promo name already exists",
          409,
          this.requestId,
          { promo_name: promoData.promo_name }
        );
      }
    }

    const nextType = promoData.promo_type ?? normalizePromoType(current.promo_type);
    const nextDiscountValue =
      promoData.discount_value ?? (current.discount_value ? Number(current.discount_value) : undefined);
    const nextDiscountPercentage = promoData.discount_percentage ?? current.discount_percentage ?? undefined;

    const updated = await prisma.promotion.update({
      where: { id: current.id },
      data: {
        ...(promoData.promo_name !== undefined ? { promo_name: promoData.promo_name.trim() } : {}),
        ...(promoData.description !== undefined ? { description: promoData.description } : {}),
        ...(promoData.promo_type !== undefined ? { promo_type: promoData.promo_type } : {}),
        ...(promoData.promo_img !== undefined ? { promo_img: promoData.promo_img } : {}),
        ...(promoData.redirect_path !== undefined
          ? { redirect_path: promoData.redirect_path ? promoData.redirect_path.trim() : null }
          : {}),
        ...(promoData.start_date !== undefined ? { starts_at: promoData.start_date } : {}),
        ...(promoData.end_date !== undefined ? { expires_at: promoData.end_date } : {}),
        ...(promoData.target_groups !== undefined ? { target_groups: toJsonString(promoData.target_groups) } : {}),
        ...(promoData.tags !== undefined ? { tags: toJsonString(promoData.tags) } : {}),
        ...(promoData.applicable_products !== undefined
          ? { applicable_products: toJsonString(promoData.applicable_products) }
          : {}),
        ...(promoData.minimum_order_amount !== undefined
          ? {
              minimum_order_amount: new Prisma.Decimal(promoData.minimum_order_amount),
              min_purchase_amount: new Prisma.Decimal(promoData.minimum_order_amount),
            }
          : {}),
        ...(promoData.maximum_discount_amount !== undefined
          ? {
              maximum_discount_amount: new Prisma.Decimal(promoData.maximum_discount_amount),
              max_discount_amount: new Prisma.Decimal(promoData.maximum_discount_amount),
            }
          : {}),
        ...(promoData.usage_limit !== undefined ? { usage_limit: promoData.usage_limit } : {}),
        ...(promoData.per_user_limit !== undefined ? { per_user_limit: promoData.per_user_limit } : {}),
        ...(promoData.discount_value !== undefined
          ? { discount_value: new Prisma.Decimal(promoData.discount_value) }
          : {}),
        ...(promoData.discount_percentage !== undefined
          ? { discount_percentage: promoData.discount_percentage }
          : {}),
        promo_value: new Prisma.Decimal(
          computePromoValue({
            promo_type: nextType,
            discount_value: nextDiscountValue,
            discount_percentage: nextDiscountPercentage,
          })
        ),
        updated_at: new Date(),
      },
    });

    await this.writeAudit(updatedBy, "promo.update", {
      promoId: updated.id.toString(),
      fields: Object.keys(promoData),
    });

    return toPromoResponse(updated);
  }

  async deletePromo(promoId: number, actorUserId: string) {
    const current = await prisma.promotion.findUnique({ where: { id: BigInt(promoId) } });
    if (!current) {
      throw createProductPromoError(
        ProductPromoErrorCode.PROMO_NOT_FOUND,
        "Promo not found",
        404,
        this.requestId,
        { promoId }
      );
    }

    await prisma.promotion.delete({ where: { id: current.id } });

    await this.writeAudit(actorUserId, "promo.delete", {
      promoId: current.id.toString(),
    });

    return {
      promo_id: Number(current.id),
      message: "Promo deleted successfully",
    };
  }

  async togglePromoStatus(promoId: number, isActive: boolean, actorUserId: string) {
    const updated = await prisma.promotion.update({
      where: { id: BigInt(promoId) },
      data: { is_active: isActive, updated_at: new Date() },
    }).catch(() => null);

    if (!updated) {
      throw createProductPromoError(
        ProductPromoErrorCode.PROMO_NOT_FOUND,
        "Promo not found",
        404,
        this.requestId,
        { promoId }
      );
    }

    await this.writeAudit(actorUserId, "promo.toggle", {
      promoId: updated.id.toString(),
      is_active: isActive,
    });

    return {
      promo_id: Number(updated.id),
      is_active: updated.is_active,
      message: isActive ? "Promo activated successfully" : "Promo deactivated successfully",
    };
  }

  async isUserEligible(promoId: number, userId: string): Promise<{ eligible: boolean; reason?: string }> {
    const promo = await prisma.promotion.findUnique({ where: { id: BigInt(promoId) } });
    if (!promo) {
      return { eligible: false, reason: "Promo not found" };
    }

    const now = new Date();
    if (!promo.is_active) return { eligible: false, reason: "Promo is inactive" };
    if (promo.starts_at > now) return { eligible: false, reason: "Promo has not started yet" };
    if (promo.expires_at <= now) return { eligible: false, reason: "Promo has expired" };

    if (promo.usage_limit !== null && promo.usage_count >= promo.usage_limit) {
      return { eligible: false, reason: "Promo usage limit reached" };
    }

    const userIdBig = BigInt(userId);
    const userUsage = await prisma.promoUsage.count({
      where: { promo_id: promo.id, user_id: userIdBig },
    });

    if (promo.per_user_limit > 0 && userUsage >= promo.per_user_limit) {
      return { eligible: false, reason: "Per-user usage limit reached" };
    }

    const userGroups = await this.resolveUserTargetGroups(userIdBig);
    const requiredGroups = parseJsonArray<TargetGroup>(promo.target_groups);

    if (requiredGroups.length > 0 && !requiredGroups.includes("all_users")) {
      const hasIntersection = requiredGroups.some((group) => userGroups.has(group));
      if (!hasIntersection) {
        return { eligible: false, reason: "User does not match promo target groups" };
      }
    }

    return { eligible: true };
  }

  async getEligiblePromos(userId: string, subtotal = 0): Promise<PromoWithComputed[]> {
    const userIdBig = BigInt(userId);
    const now = new Date();

    const promos = await prisma.promotion.findMany({
      where: {
        is_active: true,
        starts_at: { lte: now },
        expires_at: { gt: now },
      },
      orderBy: { created_at: "desc" },
    });

    const groups = await this.resolveUserTargetGroups(userIdBig);
    const eligible: PromoWithComputed[] = [];

    for (const promo of promos) {
      const requiredGroups = parseJsonArray<TargetGroup>(promo.target_groups);
      if (requiredGroups.length > 0 && !requiredGroups.includes("all_users")) {
        if (!requiredGroups.some((group) => groups.has(group))) continue;
      }

      const minimum = promo.minimum_order_amount ?? promo.min_purchase_amount;
      if (minimum && subtotal < Number(minimum)) continue;

      if (promo.usage_limit !== null && promo.usage_count >= promo.usage_limit) continue;

      const used = await prisma.promoUsage.count({
        where: { promo_id: promo.id, user_id: userIdBig },
      });
      if (promo.per_user_limit > 0 && used >= promo.per_user_limit) continue;

      eligible.push(toPromoResponse(promo));
    }

    return eligible;
  }

  async applyPromo(
    promoId: number,
    userId: string,
    orderId: string,
    subtotal: number
  ): Promise<{ success: boolean; discount_amount: number; message: string }> {
    const eligibility = await this.isUserEligible(promoId, userId);
    if (!eligibility.eligible) {
      return {
        success: false,
        discount_amount: 0,
        message: eligibility.reason ?? "Promo not eligible",
      };
    }

    const promo = await prisma.promotion.findUnique({ where: { id: BigInt(promoId) } });
    if (!promo) {
      return { success: false, discount_amount: 0, message: "Promo not found" };
    }

    const minimum = promo.minimum_order_amount ?? promo.min_purchase_amount;
    if (minimum && subtotal < Number(minimum)) {
      return {
        success: false,
        discount_amount: 0,
        message: `Minimum order amount is ${Number(minimum).toFixed(2)}`,
      };
    }

    let discount = 0;
    if (promo.promo_type === "percentage") {
      const pct = promo.discount_percentage ?? Number(promo.promo_value ?? 0);
      discount = (subtotal * pct) / 100;
    } else if (promo.promo_type === "fixed_amount" || promo.promo_type === "discount") {
      discount = promo.discount_value ? Number(promo.discount_value) : Number(promo.promo_value ?? 0);
    }

    const maxDiscount = promo.maximum_discount_amount ?? promo.max_discount_amount;
    if (maxDiscount) discount = Math.min(discount, Number(maxDiscount));
    discount = Math.min(discount, subtotal);
    discount = roundTo2(discount);

    const userIdBig = BigInt(userId);
    await prisma.$transaction(async (tx) => {
      await tx.promotion.update({
        where: { id: promo.id },
        data: { usage_count: { increment: 1 } },
      });

      await tx.promoUsage.create({
        data: {
          promo_id: promo.id,
          user_id: userIdBig,
          order_id: orderId,
          discount_amount: new Prisma.Decimal(discount),
        },
      });
    });

    return {
      success: true,
      discount_amount: discount,
      message: "Promo applied successfully",
    };
  }

  async getPromoStats(promoId: number): Promise<{
    total_usage: number;
    unique_users: number;
    total_discount_given: number;
    average_discount: number;
    usage_by_user: Array<{ user_id: string; usage_count: number; total_discount: number }>;
  }> {
    const promoIdBig = BigInt(promoId);

    const [totalUsage, aggregate, grouped] = await Promise.all([
      prisma.promoUsage.count({ where: { promo_id: promoIdBig } }),
      prisma.promoUsage.aggregate({
        where: { promo_id: promoIdBig },
        _sum: { discount_amount: true },
        _avg: { discount_amount: true },
      }),
      prisma.promoUsage.groupBy({
        by: ["user_id"],
        where: { promo_id: promoIdBig },
        _count: { user_id: true },
        _sum: { discount_amount: true },
      }),
    ]);

    return {
      total_usage: totalUsage,
      unique_users: grouped.length,
      total_discount_given: Number(aggregate._sum.discount_amount ?? 0),
      average_discount: Number(aggregate._avg.discount_amount ?? 0),
      usage_by_user: grouped.map((item) => ({
        user_id: item.user_id.toString(),
        usage_count: item._count.user_id,
        total_discount: Number(item._sum.discount_amount ?? 0),
      })),
    };
  }

  async getPromoUsage(
    promoId: number,
    page = 1,
    limit = 20
  ): Promise<{
    usages: Array<{
      usage_id: string;
      user_id: string;
      user_name: string;
      user_email: string;
      order_id: string | null;
      discount_amount: number;
      used_at: Date;
    }>;
    pagination: { page: number; limit: number; total: number; pages: number };
    summary: { total_usage: number; total_discount: number; unique_users: number };
  }> {
    const promoIdBig = BigInt(promoId);
    const safePage = Math.max(1, page);
    const safeLimit = Math.max(1, Math.min(100, limit));
    const skip = (safePage - 1) * safeLimit;

    const [rows, total, stats] = await Promise.all([
      prisma.promoUsage.findMany({
        where: { promo_id: promoIdBig },
        include: {
          user: {
            select: {
              first_name: true,
              last_name: true,
              email: true,
            },
          },
        },
        orderBy: { used_at: "desc" },
        skip,
        take: safeLimit,
      }),
      prisma.promoUsage.count({ where: { promo_id: promoIdBig } }),
      this.getPromoStats(promoId),
    ]);

    return {
      usages: rows.map((row) => ({
        usage_id: row.usage_id.toString(),
        user_id: row.user_id.toString(),
        user_name: `${row.user.first_name} ${row.user.last_name}`.trim(),
        user_email: row.user.email,
        order_id: row.order_id,
        discount_amount: Number(row.discount_amount),
        used_at: row.used_at,
      })),
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        pages: Math.ceil(total / safeLimit),
      },
      summary: {
        total_usage: stats.total_usage,
        total_discount: stats.total_discount_given,
        unique_users: stats.unique_users,
      },
    };
  }

  private async resolveUserTargetGroups(userId: bigint): Promise<Set<TargetGroup>> {
    const now = new Date();
    const registrationDays = Number(process.env.PROMO_SEGMENT_NEW_USER_DAYS ?? 30);
    const frequentBuyerOrders = Number(process.env.PROMO_SEGMENT_FREQUENT_BUYER_ORDERS ?? 5);
    const bulkOrderQuantity = Number(process.env.PROMO_SEGMENT_BULK_ORDER_QUANTITY ?? 50);

    const [user, orderAgg, orderCount, quantityAgg] = await Promise.all([
      prisma.user.findUnique({
        where: { user_id: userId },
        select: { created_at: true, is_active: true },
      }),
      prisma.shopOrder.aggregate({
        where: {
          user_id: userId,
          status: { notIn: ["cancelled"] },
        },
        _count: { id: true },
      }),
      prisma.shopOrder.count({
        where: {
          user_id: userId,
          status: { notIn: ["cancelled"] },
        },
      }),
      prisma.shopOrderItem.aggregate({
        where: {
          order: {
            user_id: userId,
            status: { notIn: ["cancelled"] },
          },
        },
        _sum: { quantity: true },
      }),
    ]);

    const groups = new Set<TargetGroup>();
    groups.add("all_users");

    if (!user || !user.is_active) return groups;

    const registeredMs = now.getTime() - user.created_at.getTime();
    if (registeredMs <= registrationDays * 24 * 60 * 60 * 1000) {
      groups.add("newly_registered");
    }

    if (orderCount === 0) {
      groups.add("first_time_buyers");
    }

    if ((orderAgg._count.id ?? 0) >= frequentBuyerOrders) {
      groups.add("frequent_buyers");
    }

    if ((quantityAgg._sum.quantity ?? 0) >= bulkOrderQuantity) {
      groups.add("bulk_orders");
    }

    return groups;
  }

  private async writeAudit(actorUserId: string, action: string, details: Record<string, unknown>) {
    try {
      if (!/^\d+$/.test(actorUserId)) return;
      const adminUserId = BigInt(actorUserId);
      const actor = await prisma.user.findUnique({
        where: { user_id: adminUserId },
        select: { email: true },
      });
      if (!actor) return;

      await prisma.adminAuditLog.create({
        data: {
          admin_user_id: adminUserId,
          admin_email: actor.email,
          action,
          details: JSON.stringify(details),
        },
      });
    } catch {
      // Best effort only.
    }
  }
}
