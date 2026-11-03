import { prisma } from "@/server/lib/prisma";
import { AppError } from "@/lib/errors/types";
import { QRErrorCode, toErrorCode } from "@/lib/errors/qr-errors";
import { SerialIdService } from "@/lib/services/serialIdService";

const prismaAny = prisma as any;

export interface ScanResult {
  bizcard_id: string;
  bizcard_name: string;
  user_id: string;
  user_name: string;
  is_virtual: boolean;
  is_merged: boolean;
  scan_count: number;
  redirect_url: string;
}

export class PhysicalCardService {
  private readonly requestId: string;
  private readonly serialService: SerialIdService;

  constructor(requestId: string) {
    this.requestId = requestId;
    this.serialService = SerialIdService.getInstance();
  }

  async scanPhysicalCard(
    serialId: string,
    scannerInfo: {
      ip: string;
      userAgent: string;
      location?: string;
    }
  ): Promise<ScanResult> {
    const normalizedSerial = this.serialService.normalizeSerialId(serialId);
    if (!normalizedSerial) {
      throw new AppError(
        toErrorCode(QRErrorCode.SERIAL_ID_MISSING),
        "Serial ID is required",
        400,
        { serialId },
        this.requestId
      );
    }

    if (!this.serialService.validateSerialId(normalizedSerial)) {
      throw new AppError(
        toErrorCode(QRErrorCode.SERIAL_ID_INVALID_FORMAT),
        `Invalid serial ID format: ${normalizedSerial}`,
        400,
        { serialId: normalizedSerial },
        this.requestId
      );
    }

    const resolved = await this.resolveBizcardForScan(normalizedSerial);
    if (!resolved) {
      await this.logFailedScan(normalizedSerial, scannerInfo, "Serial ID not found");
      throw new AppError(
        toErrorCode(QRErrorCode.PHYSICAL_CARD_NOT_FOUND),
        `Physical card with serial ID ${normalizedSerial} not found`,
        404,
        { serialId: normalizedSerial },
        this.requestId
      );
    }

    if (!resolved.user_id) {
      await this.logFailedScan(normalizedSerial, scannerInfo, "Card exists but is not linked to a user");
      throw new AppError(
        toErrorCode(QRErrorCode.PHYSICAL_CARD_EMPTY_RECORD),
        `Physical card ${normalizedSerial} is not assigned yet`,
        409,
        { serialId: normalizedSerial, bizcardId: resolved.bizcard_id?.toString() ?? null },
        this.requestId
      );
    }

    const stats = await this.incrementScanStats(resolved.bizcard_id, normalizedSerial, scannerInfo);

    const firstName = resolved.user?.first_name ?? "";
    const lastName = resolved.user?.last_name ?? "";
    const userName = `${firstName} ${lastName}`.trim() || resolved.user?.email || "Unknown User";
    const urlAlias = resolved.url_alias ?? resolved.user?.custom_uri;

    if (!urlAlias) {
      throw new AppError(
        toErrorCode(QRErrorCode.PHYSICAL_CARD_SCAN_FAILED),
        "Card is linked but has no public URL alias",
        409,
        { serialId: normalizedSerial, userId: resolved.user_id.toString() },
        this.requestId
      );
    }

    return {
      bizcard_id: resolved.bizcard_id.toString(),
      bizcard_name: resolved.bizcard_name,
      user_id: resolved.user_id.toString(),
      user_name: userName,
      is_virtual: resolved.bizcard_type === "virtual",
      is_merged: Boolean(resolved.is_merged),
      scan_count: stats.scan_count,
      redirect_url: `/${urlAlias}`,
    };
  }

  async registerPhysicalCard(serialId: string): Promise<{
    bizcard_id: string;
    serial_id: string;
    bizcard_type: string;
    bizcard_name: string;
    created_at: Date;
  }> {
    const normalizedSerial = this.serialService.normalizeSerialId(serialId);
    if (!normalizedSerial) {
      throw new AppError(
        toErrorCode(QRErrorCode.SERIAL_ID_MISSING),
        "serial_id is required",
        400,
        { serialId },
        this.requestId
      );
    }

    if (!this.serialService.validateSerialId(normalizedSerial)) {
      throw new AppError(
        toErrorCode(QRErrorCode.SERIAL_ID_INVALID_FORMAT),
        `Invalid serial ID format: ${normalizedSerial}`,
        400,
        { serialId: normalizedSerial },
        this.requestId
      );
    }

    const [existingBizcard, existingEmployeeCard] = await Promise.all([
      prismaAny.bizcard.findFirst({ where: { serial_id: normalizedSerial }, select: { bizcard_id: true } }),
      prismaAny.employeeCard.findUnique({ where: { serial_id: normalizedSerial }, select: { card_id: true } }),
    ]);

    if (existingBizcard || existingEmployeeCard) {
      throw new AppError(
        toErrorCode(QRErrorCode.PHYSICAL_CARD_ALREADY_LINKED),
        `Physical card with serial ID ${normalizedSerial} already exists`,
        409,
        {
          serialId: normalizedSerial,
          existingBizcardId: existingBizcard?.bizcard_id?.toString() ?? null,
          existingEmployeeCardId: existingEmployeeCard?.card_id?.toString() ?? null,
        },
        this.requestId
      );
    }

    const now = new Date();
    const created = await prismaAny.$transaction(async (tx: any) => {
      const blankCard = await tx.bizcard.create({
        data: {
          user_id: null,
          serial_id: normalizedSerial,
          bizcard_type: "physical",
          bizcard_name: `Physical Card ${normalizedSerial.slice(0, 12)}`,
          first_name: "Unassigned",
          last_name: "Physical Card",
          email: `card_${normalizedSerial.toLowerCase()}@ontap.local`,
          contact_number: "N/A",
          city: "",
          is_blank: true,
          is_merged: false,
          deactivated_flag: false,
          generated_at: now,
          created_at: now,
          updated_at: now,
        },
        select: {
          bizcard_id: true,
          serial_id: true,
          bizcard_type: true,
          bizcard_name: true,
          created_at: true,
        },
      });

      await tx.employeeCard.create({
        data: {
          serial_id: normalizedSerial,
          card_type: "individual",
          activation_status: "unassigned",
          company_id: null,
          assigned_user_id: null,
          created_at: now,
          updated_at: now,
        },
      }).catch(() => {
        // Hybrid compatibility mode: keep bizcard record as source if employeeCard mirror fails.
      });

      return blankCard;
    });

    return {
      bizcard_id: created.bizcard_id.toString(),
      serial_id: created.serial_id,
      bizcard_type: created.bizcard_type,
      bizcard_name: created.bizcard_name,
      created_at: created.created_at,
    };
  }

  async mergeWithPhysicalCard(
    virtualBizcardId: number,
    serialId: string,
    userId: string
  ): Promise<{
    bizcard_id: string;
    bizcard_name: string;
    serial_id: string;
    is_merged: boolean;
    merged_at: Date;
  }> {
    const normalizedSerial = this.serialService.normalizeSerialId(serialId);
    if (!normalizedSerial) {
      throw new AppError(
        toErrorCode(QRErrorCode.SERIAL_ID_MISSING),
        "serial_id is required",
        400,
        { serialId },
        this.requestId
      );
    }

    if (!this.serialService.validateSerialId(normalizedSerial)) {
      throw new AppError(
        toErrorCode(QRErrorCode.SERIAL_ID_INVALID_FORMAT),
        `Invalid serial ID format: ${normalizedSerial}`,
        400,
        { serialId: normalizedSerial },
        this.requestId
      );
    }

    const ownerId = BigInt(userId);
    const now = new Date();

    const mergedCard = await prismaAny.$transaction(async (tx: any) => {
      const virtualBizcard = await tx.bizcard.findFirst({
        where: {
          bizcard_id: BigInt(virtualBizcardId),
          user_id: ownerId,
          bizcard_type: "virtual",
          deactivated_flag: false,
        },
        select: {
          bizcard_id: true,
          bizcard_name: true,
          serial_id: true,
          is_merged: true,
        },
      });

      if (!virtualBizcard) {
        throw new AppError(
          toErrorCode(QRErrorCode.MERGE_FAILED_CARD_EXISTS),
          `Virtual bizcard ${virtualBizcardId} not found or does not belong to user`,
          404,
          { virtualBizcardId, userId },
          this.requestId
        );
      }

      if (virtualBizcard.is_merged) {
        throw new AppError(
          toErrorCode(QRErrorCode.MERGE_FAILED_ALREADY_MERGED),
          `Virtual bizcard ${virtualBizcardId} is already merged`,
          409,
          { virtualBizcardId, serialId: virtualBizcard.serial_id },
          this.requestId
        );
      }

      const blankPhysicalCard = await tx.bizcard.findFirst({
        where: {
          serial_id: normalizedSerial,
          bizcard_type: "physical",
          is_blank: true,
          user_id: null,
          deactivated_flag: false,
        },
        select: {
          bizcard_id: true,
          serial_id: true,
          qr_code_url: true,
          qr_code_generated_at: true,
          url_alias: true,
          subscription_tier: true,
        },
      });

      if (!blankPhysicalCard) {
        throw new AppError(
          toErrorCode(QRErrorCode.PHYSICAL_CARD_NOT_FOUND),
          `Physical card with serial ID ${normalizedSerial} not found or already linked`,
          404,
          { serialId: normalizedSerial },
          this.requestId
        );
      }

      const blankTier =
        typeof blankPhysicalCard.subscription_tier === "string"
          ? blankPhysicalCard.subscription_tier.trim().toLowerCase()
          : "";
      const hasTier = blankTier === "basic" || blankTier === "standard" || blankTier === "premium";
      const subscriptionExpiresAt = hasTier
        ? (() => {
            const expiry = new Date(now);
            expiry.setFullYear(expiry.getFullYear() + 1);
            return expiry;
          })()
        : null;

      let planId: bigint | null = null;
      if (hasTier) {
        const plan = await tx.subscriptionPlan.findUnique({
          where: { tier_code: blankTier },
          select: { id: true },
        });
        planId = plan?.id ?? null;
      }

      await tx.bizcardMergeHistory.create({
        data: {
          blank_bizcard_id: blankPhysicalCard.bizcard_id,
          blank_serial_id: blankPhysicalCard.serial_id,
          virtual_bizcard_id: BigInt(virtualBizcardId),
          user_id: ownerId,
          merged_at: now,
        },
      });

      // Transfer QR metadata from blank card to virtual card (preserve original QR image/metadata)
      // and activate the blank card's subscription tier on the virtual card.
      const updatedVirtual = await tx.bizcard.update({
        where: { bizcard_id: BigInt(virtualBizcardId) },
        data: {
          serial_id: normalizedSerial,
          is_merged: true,
          merged_at: now,
          updated_at: now,
          ...(blankPhysicalCard.qr_code_url
            ? { qr_code_url: blankPhysicalCard.qr_code_url }
            : {}),
          ...(blankPhysicalCard.qr_code_generated_at
            ? { qr_code_generated_at: blankPhysicalCard.qr_code_generated_at }
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
        select: {
          bizcard_id: true,
          bizcard_name: true,
          serial_id: true,
          is_merged: true,
          merged_at: true,
          url_alias: true,
          qr_code_url: true,
        },
      });

      if (hasTier && planId && subscriptionExpiresAt) {
        await tx.bizcardSubscription.upsert({
          where: { bizcard_id: BigInt(virtualBizcardId) },
          create: {
            bizcard_id: BigInt(virtualBizcardId),
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

      // Remove the blank physical card record now that its serial_id has been transferred
      await tx.bizcard.delete({ where: { bizcard_id: blankPhysicalCard.bizcard_id } });

      await tx.employeeCard.upsert({
        where: { serial_id: normalizedSerial },
        update: {
          assigned_user_id: ownerId,
          activation_status: "active",
          updated_at: now,
          activated_at: now,
        },
        create: {
          serial_id: normalizedSerial,
          card_type: "individual",
          assigned_user_id: ownerId,
          activation_status: "active",
          activated_at: now,
          created_at: now,
          updated_at: now,
        },
      });

      return updatedVirtual;
    });

    return {
      bizcard_id: mergedCard.bizcard_id.toString(),
      bizcard_name: mergedCard.bizcard_name,
      serial_id: mergedCard.serial_id,
      is_merged: Boolean(mergedCard.is_merged),
      merged_at: mergedCard.merged_at ?? now,
    };
  }

  private async resolveBizcardForScan(serialId: string): Promise<any | null> {
    const directBizcard = await prismaAny.bizcard.findFirst({
      where: {
        serial_id: serialId,
        deactivated_flag: false,
      },
      select: {
        bizcard_id: true,
        bizcard_name: true,
        bizcard_type: true,
        is_blank: true,
        is_merged: true,
        url_alias: true,
        user_id: true,
        first_name: true,
        last_name: true,
        email: true,
        user: {
          select: {
            user_id: true,
            first_name: true,
            last_name: true,
            custom_uri: true,
            email: true,
            is_active: true,
          },
        },
      },
    });

    if (directBizcard && !directBizcard.user_id) {
      return directBizcard;
    }

    if (directBizcard?.user_id && directBizcard.user?.is_active) {
      return directBizcard;
    }

    const employeeCard = await prismaAny.employeeCard.findUnique({
      where: { serial_id: serialId },
      select: {
        assigned_user_id: true,
        activation_status: true,
      },
    });

    if (!employeeCard?.assigned_user_id || employeeCard.activation_status === "inactive" || employeeCard.activation_status === "revoked") {
      return null;
    }

    const linkedBizcard = await prismaAny.bizcard.findFirst({
      where: {
        user_id: employeeCard.assigned_user_id,
        deactivated_flag: false,
      },
      orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
      select: {
        bizcard_id: true,
        bizcard_name: true,
        bizcard_type: true,
        is_merged: true,
        url_alias: true,
        user_id: true,
        user: {
          select: {
            user_id: true,
            first_name: true,
            last_name: true,
            custom_uri: true,
            email: true,
            is_active: true,
          },
        },
      },
    });

    return linkedBizcard?.user?.is_active ? linkedBizcard : null;
  }

  private async incrementScanStats(
    bizcardId: bigint,
    serialId: string,
    scannerInfo: {
      ip: string;
      userAgent: string;
      location?: string;
    }
  ): Promise<{ scan_count: number }> {
    const now = new Date();

    const result = await prismaAny.$transaction(async (tx: any) => {
      const updatedBizcard = await tx.bizcard.update({
        where: { bizcard_id: bizcardId },
        data: {
          scan_count: { increment: 1 },
          qr_code_last_accessed: now,
          updated_at: now,
        },
        select: {
          scan_count: true,
        },
      });

      await tx.qRCodeScan.create({
        data: {
          bizcard_id: bizcardId,
          serial_id_raw: serialId,
          scanner_ip: scannerInfo.ip,
          scanner_user_agent: scannerInfo.userAgent,
          scanner_location: scannerInfo.location,
          scan_timestamp: now,
          scan_successful: true,
        },
      }).catch((error: unknown) => {
        console.error("[PhysicalCardService] Failed to log successful QR scan", {
          requestId: this.requestId,
          bizcardId: bizcardId.toString(),
          error: error instanceof Error ? error.message : String(error),
        });
      });

      return updatedBizcard;
    });

    return { scan_count: Number(result.scan_count ?? 0) };
  }

  private async logFailedScan(
    serialId: string,
    scannerInfo: { ip: string; userAgent: string; location?: string },
    errorMessage: string
  ): Promise<void> {
    await prismaAny.qRCodeScan
      .create({
        data: {
          bizcard_id: null,
          serial_id_raw: serialId,
          scanner_ip: scannerInfo.ip,
          scanner_user_agent: scannerInfo.userAgent,
          scanner_location: scannerInfo.location,
          scan_successful: false,
          error_message: errorMessage,
        },
      })
      .catch((error: unknown) => {
        console.error("[PhysicalCardService] Failed to log failed QR scan", {
          requestId: this.requestId,
          serialId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }
}
