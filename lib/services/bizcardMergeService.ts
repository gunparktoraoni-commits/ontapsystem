// lib/services/bizcardMergeService.ts
import { prisma } from "@/server/lib/prisma";
import { buildVCardPublicUrl } from "@/server/lib/qr";

const prismaAny = prisma as any;

export interface MergeResult {
  success: boolean;
  updatedVirtualCardId: bigint;
  blankSerialId: string;
  mergedAt: Date;
}

export interface MergeError {
  code: "CARD_NOT_AVAILABLE" | "VIRTUAL_CARD_NOT_FOUND" | "USER_MISMATCH" | "MERGE_FAILED";
  message: string;
}

function buildYearlyExpiry(from: Date): Date {
  const expiry = new Date(from);
  expiry.setFullYear(expiry.getFullYear() + 1);
  return expiry;
}

export class BizcardMergeService {
  private static instance: BizcardMergeService;
  
  private constructor() {}
  
  static getInstance(): BizcardMergeService {
    if (!BizcardMergeService.instance) {
      BizcardMergeService.instance = new BizcardMergeService();
    }
    return BizcardMergeService.instance;
  }
  
  async mergeBlankCard(
    serialId: string,
    virtualCardId: bigint,
    userId: bigint
  ): Promise<MergeResult | MergeError> {
    try {
      const result = await prismaAny.$transaction(async (tx: any) => {
        // Find and lock the blank card
        const blankCard = await tx.bizcard.findFirst({
          where: {
            serial_id: serialId,
            is_blank: true,
            deactivated_flag: false,
            user_id: null,
          },
          select: {
            bizcard_id: true,
            serial_id: true,
            qr_code_url: true,
            portfolio_url: true,
            subscription_tier: true,
          },
        });
        
        if (!blankCard) {
          throw new Error("CARD_NOT_AVAILABLE");
        }
        
        // Verify virtual card ownership
        const virtualCard = await tx.bizcard.findFirst({
          where: {
            bizcard_id: virtualCardId,
            user_id: userId,
            is_blank: false,
            deactivated_flag: false,
          },
          select: {
            bizcard_id: true,
            url_alias: true,
            qr_code_url: true,
            company_id: true,
          },
        });
        
        if (!virtualCard) {
          throw new Error("VIRTUAL_CARD_NOT_FOUND");
        }

        // Keep company Admin "Cards" counts accurate after QR merge.
        let mergeCompanyId = virtualCard.company_id ?? null;
        if (!mergeCompanyId) {
          const owner = await tx.user.findUnique({
            where: { user_id: userId },
            select: { company_id: true },
          });
          mergeCompanyId = owner?.company_id ?? null;
          if (!mergeCompanyId) {
            const membership = await tx.companyEmployee.findFirst({
              where: { user_id: userId, is_active: true },
              select: { company_id: true },
              orderBy: { joined_at: "desc" },
            });
            mergeCompanyId = membership?.company_id ?? null;
          }
        }

        const alias = typeof virtualCard.url_alias === "string" ? virtualCard.url_alias.trim() : "";
        const aliasPortfolioUrl = alias
          ? (buildVCardPublicUrl(alias) ?? `/${encodeURIComponent(alias)}`)
          : null;

        const now = new Date();
        const blankTier =
          typeof blankCard.subscription_tier === "string"
            ? blankCard.subscription_tier.trim().toLowerCase()
            : "";
        const hasTier = blankTier === "basic" || blankTier === "standard" || blankTier === "premium";
        const subscriptionExpiresAt = hasTier ? buildYearlyExpiry(now) : null;

        let planId: bigint | null = null;
        if (hasTier) {
          const plan = await tx.subscriptionPlan.findUnique({
            where: { tier_code: blankTier },
            select: { id: true },
          });
          planId = plan?.id ?? null;
        }
        
        // Create merge history record
        await tx.bizcardMergeHistory.create({
          data: {
            blank_bizcard_id: blankCard.bizcard_id,
            blank_serial_id: blankCard.serial_id,
            virtual_bizcard_id: virtualCardId,
            user_id: userId,
            merged_at: now,
          },
        });
        
        // Delete the blank card
        await tx.bizcard.delete({
          where: { bizcard_id: blankCard.bizcard_id },
        });
        
        // Update virtual card with serial ID and QR data.
        // Prefer the public alias portfolio URL over the blank serial resolver URL
        // so Super Admin Distributed Cards do not flicker back to /{SERIAL}.
        // Only overwrite qr_code_url when the blank card has a stored QR asset.
        const updatedVirtualCard = await tx.bizcard.update({
          where: { bizcard_id: virtualCardId },
          data: {
            serial_id: blankCard.serial_id,
            ...(blankCard.qr_code_url
              ? { qr_code_url: blankCard.qr_code_url }
              : {}),
            portfolio_url: aliasPortfolioUrl ?? blankCard.portfolio_url,
            is_merged: true,
            merged_at: now,
            updated_at: now,
            ...(mergeCompanyId && !virtualCard.company_id
              ? { company_id: mergeCompanyId }
              : {}),
            ...(hasTier
              ? {
                  subscription_tier: blankTier,
                  subscription_status: "active",
                  subscription_started_at: now,
                  subscription_expires_at: subscriptionExpiresAt,
                }
              : {}),
          },
        });

        // Activate BizcardSubscription when a matching plan exists for the blank tier.
        if (hasTier && planId && subscriptionExpiresAt) {
          await tx.bizcardSubscription.upsert({
            where: { bizcard_id: virtualCardId },
            create: {
              bizcard_id: virtualCardId,
              plan_id: planId,
              status: "active",
              billing_cycle: "yearly",
              started_at: now,
              expires_at: subscriptionExpiresAt,
              auto_renew: true,
            },
            update: {
              plan_id: planId,
              status: "active",
              billing_cycle: "yearly",
              started_at: now,
              expires_at: subscriptionExpiresAt,
              auto_renew: true,
            },
          });
        }
        
        return {
          updatedVirtualCard,
          blankCard,
        };
      });
      
      return {
        success: true,
        updatedVirtualCardId: result.updatedVirtualCard.bizcard_id,
        blankSerialId: result.blankCard.serial_id,
        mergedAt: new Date(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "MERGE_FAILED";
      return {
        code: message as MergeError["code"],
        message: this.getErrorMessage(message as MergeError["code"]),
      };
    }
  }
  
  private getErrorMessage(code: MergeError["code"]): string {
    switch (code) {
      case "CARD_NOT_AVAILABLE":
        return "This physical card has already been claimed or does not exist.";
      case "VIRTUAL_CARD_NOT_FOUND":
        return "The selected virtual card does not exist or does not belong to you.";
      case "USER_MISMATCH":
        return "You do not have permission to claim this card.";
      default:
        return "Failed to merge cards. Please try again.";
    }
  }
}
