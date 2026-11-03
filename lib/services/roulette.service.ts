import { prisma } from "@/server/lib/prisma";
import { Prisma } from "@prisma/client";
import { getRandomPrize, PrizeOption } from "@/lib/roulette/probability";
import {
  RouletteErrorCode,
  createNoSpinsError,
  createInvalidVoucherError,
  createVoucherExpiredError,
  createVoucherAlreadyUsedError,
} from "@/lib/errors/roulette-errors";

export interface SpinBalance {
  balance: number;
  totalEarned: number;
  totalUsed: number;
}

export interface SpinResult {
  success: boolean;
  prize?: PrizeOption;
  voucherCode?: string;
  promoId?: bigint;
  remainingSpins?: number;
  error?: string;
  errorCode?: RouletteErrorCode;
}

export interface VoucherApplicationResult {
  success: boolean;
  discountAmount?: number;
  finalTotal?: number;
  promoId?: bigint;
  error?: string;
  errorCode?: RouletteErrorCode;
}

export class RouletteService {
  private requestId: string;

  constructor(requestId: string) {
    this.requestId = requestId;
  }

  /**
   * Get user's current spin balance
   */
  async getSpinBalance(userId: string | number | bigint): Promise<SpinBalance> {
    const userIdBigInt = typeof userId === "string" || typeof userId === "number" ? BigInt(userId) : userId;

    const user = await prisma.user.findUnique({
      where: { user_id: userIdBigInt },
      select: {
        spin_balance: true,
        total_spins_earned: true,
        total_spins_used: true,
      },
    });

    if (!user) {
      return { balance: 0, totalEarned: 0, totalUsed: 0 };
    }

    return {
      balance: user.spin_balance,
      totalEarned: user.total_spins_earned,
      totalUsed: user.total_spins_used,
    };
  }

  /**
   * Award spins to user based on completed order
   * Called when an order status changes to 'completed'
   */
  async awardSpinsForOrder(
    userId: string | bigint,
    orderId: string | bigint,
    itemCount: number
  ): Promise<{ spinsAwarded: number; newBalance: number }> {
    const userIdBigInt = typeof userId === "string" ? BigInt(userId) : userId;
    const orderIdBigInt = typeof orderId === "string" ? BigInt(orderId) : orderId;

    // Verify order is completed
    const order = await prisma.shopOrder.findUnique({
      where: { id: orderIdBigInt },
      select: { status: true },
    });

    if (!order || order.status !== "completed") {
      throw new Error(`Order ${orderId} must be completed before awarding spins`);
    }

    // Check if spins were already awarded for this order
    const existingSpinAward = await prisma.spinHistory.findFirst({
      where: {
        user_id: userIdBigInt,
        order_id: orderIdBigInt,
        source: "order_completed",
      },
    });

    if (existingSpinAward) {
      throw new Error(`Spins already awarded for order ${orderId}`);
    }

    // Each item gives 1 spin
    const spinsAwarded = Math.max(1, itemCount); // Minimum 1 spin per order

    // Update user balance and record in transaction
    const [updatedUser, spinRecord] = await prisma.$transaction([
      prisma.user.update({
        where: { user_id: userIdBigInt },
        data: {
          spin_balance: { increment: spinsAwarded },
          total_spins_earned: { increment: spinsAwarded },
        },
      }),
      prisma.spinHistory.create({
        data: {
          user_id: userIdBigInt,
          prize_type: "spin_award",
          prize_value: new Prisma.Decimal(spinsAwarded),
          source: "order_completed",
          order_id: orderIdBigInt,
        },
      }),
    ]);

    console.log(`[Roulette] Awarded ${spinsAwarded} spins to user ${userId} for order ${orderId}`);

    return {
      spinsAwarded,
      newBalance: updatedUser.spin_balance,
    };
  }

  /**
   * Perform a roulette spin and return the prize
   */
  async performSpin(userId: string | bigint): Promise<SpinResult> {
    const userIdBigInt = typeof userId === "string" ? BigInt(userId) : userId;

    // Check if user has spins available
    const user = await prisma.user.findUnique({
      where: { user_id: userIdBigInt },
      select: {
        spin_balance: true,
        total_spins_used: true,
        user_id: true,
      },
    });

    if (!user || user.spin_balance <= 0) {
      const error = createNoSpinsError();
      return {
        success: false,
        error: error.error.message,
        errorCode: error.error.code,
      };
    }

    // Get random prize based on probability
    const prize = getRandomPrize();

    let promoId: bigint | undefined;
    let voucherCode: string | undefined;

    // If prize is a discount, create a voucher
    if (prize.type === "discount" && prize.discountPercentage) {
      const voucherResult = await this.createVoucher(userIdBigInt, prize);
      promoId = voucherResult.promoId;
      voucherCode = voucherResult.voucherCode;
    }

    // Deduct spin and record history in transaction
    const [updatedUser] = await prisma.$transaction([
      prisma.user.update({
        where: { user_id: userIdBigInt },
        data: {
          spin_balance: { decrement: 1 },
          total_spins_used: { increment: 1 },
          last_spin_at: new Date(),
        },
      }),
      prisma.spinHistory.create({
        data: {
          user_id: userIdBigInt,
          prize_type: prize.type,
          prize_value: prize.discountPercentage ? new Prisma.Decimal(prize.discountPercentage) : null,
          discount_percentage: prize.discountPercentage || null,
          voucher_code: voucherCode || null,
          promo_id: promoId || null,
          source: "spin",
        },
      }),
    ]);

    console.log(`[Roulette] User ${userId} spun and won: ${prize.label}`);

    return {
      success: true,
      prize,
      voucherCode,
      promoId,
      remainingSpins: updatedUser.spin_balance,
    };
  }

  /**
   * Create a voucher for a discount prize
   */
  private async createVoucher(
    userId: bigint,
    prize: PrizeOption
  ): Promise<{ voucherCode: string; promoId: bigint }> {
    if (!prize.discountPercentage) {
      throw new Error("Cannot create voucher without discount percentage");
    }

    // Generate unique voucher code
    const voucherCode = this.generateVoucherCode(userId, prize.discountPercentage);

    // Create promotion/voucher record with 30-day expiry
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 30);

    const promotion = await prisma.promotion.create({
      data: {
        promo_name: `Spin ${prize.discountPercentage}% OFF`,
        promo_type: "percentage",
        code: voucherCode,
        discount_percentage: prize.discountPercentage,
        description: `Roulette spin prize - ${prize.discountPercentage}% discount`,
        applicable_to: "all",
        source: "spin",
        per_user_limit: 1,
        usage_limit: 1, // Single use
        starts_at: new Date(),
        expires_at: expiryDate,
        is_active: true,
        created_by: userId,
      },
    });

    console.log(`[Roulette] Created voucher ${voucherCode} (${prize.discountPercentage}% OFF) for user ${userId}`);

    return {
      voucherCode,
      promoId: promotion.id,
    };
  }

  /**
   * Get user's available spin vouchers
   */
  async getUserVouchers(userId: string | number | bigint): Promise<
    Array<{
      id: bigint;
      code: string;
      promoName: string;
      discountPercentage: number;
      expiresAt: Date;
      isUsed: boolean;
    }>
  > {
    const userIdBigInt = typeof userId === "string" || typeof userId === "number" ? BigInt(userId) : userId;

    const vouchers = await prisma.promotion.findMany({
      where: {
        source: "spin",
        is_active: true,
        expires_at: { gt: new Date() },
        created_by: userIdBigInt,
        // Check usage limit vs usage count
        OR: [
          { usage_limit: null },
          { usage_count: { lt: prisma.promotion.fields.usage_limit } },
        ],
      },
      orderBy: { expires_at: "asc" },
    });

    // Check which vouchers have been used in orders
    const vouchersWithUsageStatus = await Promise.all(
      vouchers.map(async (voucher) => {
        const usedInOrder = await prisma.shopOrder.findFirst({
          where: { promo_id: voucher.id },
        });

        return {
          id: voucher.id,
          code: voucher.code || "",
          promoName: voucher.promo_name,
          discountPercentage: voucher.discount_percentage || 0,
          expiresAt: voucher.expires_at,
          isUsed: !!usedInOrder,
        };
      })
    );

    // Filter out used vouchers
    return vouchersWithUsageStatus.filter((v) => !v.isUsed);
  }

  /**
   * Apply voucher to order and calculate discount
   */
  async applyVoucher(
    userId: string | bigint,
    voucherCode: string,
    orderSubtotal: number
  ): Promise<VoucherApplicationResult> {
    const userIdBigInt = typeof userId === "string" ? BigInt(userId) : userId;

    // Find the voucher
    const voucher = await prisma.promotion.findFirst({
      where: {
        code: voucherCode,
        source: "spin",
        is_active: true,
        created_by: userIdBigInt,
      },
    });

    if (!voucher) {
      const error = createInvalidVoucherError(voucherCode);
      return {
        success: false,
        error: error.error.message,
        errorCode: error.error.code,
      };
    }

    // Check if expired
    if (voucher.expires_at < new Date()) {
      const error = createVoucherExpiredError(voucherCode, voucher.expires_at);
      return {
        success: false,
        error: error.error.message,
        errorCode: error.error.code,
      };
    }

    // Check if already used
    const usedInOrder = await prisma.shopOrder.findFirst({
      where: { promo_id: voucher.id },
    });

    if (usedInOrder) {
      const error = createVoucherAlreadyUsedError(voucherCode, String(usedInOrder.id));
      return {
        success: false,
        error: error.error.message,
        errorCode: error.error.code,
      };
    }

    // Check usage limits
    if (voucher.usage_limit && voucher.usage_count >= voucher.usage_limit) {
      const error = createVoucherAlreadyUsedError(voucherCode);
      return {
        success: false,
        error: error.error.message,
        errorCode: error.error.code,
      };
    }

    // Calculate discount
    let discountAmount = 0;
    if (voucher.promo_type === "percentage" && voucher.discount_percentage) {
      discountAmount = (orderSubtotal * voucher.discount_percentage) / 100;

      // Apply max discount cap if set
      if (voucher.max_discount_amount && discountAmount > Number(voucher.max_discount_amount)) {
        discountAmount = Number(voucher.max_discount_amount);
      }
    }

    // Round to 2 decimal places
    discountAmount = Math.round(discountAmount * 100) / 100;

    return {
      success: true,
      discountAmount,
      finalTotal: Math.max(0, orderSubtotal - discountAmount),
      promoId: voucher.id,
    };
  }

  /**
   * Get spin history for user
   */
  async getSpinHistory(userId: string | number | bigint, limit: number = 20): Promise<
    Array<{
      spinId: bigint;
      prizeType: string;
      prizeValue: number | null;
      discountPercentage: number | null;
      voucherCode: string | null;
      source: string;
      createdAt: Date;
    }>
  > {
    const userIdBigInt = typeof userId === "string" || typeof userId === "number" ? BigInt(userId) : userId;

    const history = await prisma.spinHistory.findMany({
      where: { user_id: userIdBigInt },
      orderBy: { created_at: "desc" },
      take: Math.min(limit, 100), // Max 100 records
    });

    return history.map((record) => ({
      spinId: record.spin_id,
      prizeType: record.prize_type,
      prizeValue: record.prize_value ? Number(record.prize_value) : null,
      discountPercentage: record.discount_percentage,
      voucherCode: record.voucher_code,
      source: record.source,
      createdAt: record.created_at,
    }));
  }

  /**
   * Initialize new user with 5 free spins on registration
   */
  async initializeNewUserSpins(userId: string | bigint): Promise<{ spinsAwarded: number }> {
    const userIdBigInt = typeof userId === "string" ? BigInt(userId) : userId;

    const INITIAL_SPINS = 5;

    await prisma.$transaction([
      prisma.user.update({
        where: { user_id: userIdBigInt },
        data: {
          spin_balance: INITIAL_SPINS,
          total_spins_earned: INITIAL_SPINS,
        },
      }),
      prisma.spinHistory.create({
        data: {
          user_id: userIdBigInt,
          prize_type: "spin_award",
          prize_value: new Prisma.Decimal(INITIAL_SPINS),
          source: "registration",
        },
      }),
    ]);

    console.log(`[Roulette] Initialized ${INITIAL_SPINS} spins for new user ${userId}`);

    return { spinsAwarded: INITIAL_SPINS };
  }

  /**
   * Generate unique voucher code
   */
  private generateVoucherCode(userId: bigint, discountPercentage: number): string {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    const userSuffix = userId.toString().slice(-4);
    return `SPIN${discountPercentage}_${timestamp}_${random}_${userSuffix}`;
  }
}

// Singleton instance for use in API routes
export const rouletteService = new RouletteService("system");
