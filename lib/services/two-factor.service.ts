import { generateSecret, generateURI, verify } from "otplib";
import QRCode from "qrcode";
import { prisma } from "@/server/lib/prisma";
import { SettingsErrorCode, createSettingsError } from "@/lib/errors/settings-errors";
import { EncryptionService } from "@/lib/services/encryption.service";

const TOTP_PERIOD_SECONDS = 30;
const TOTP_EPOCH_TOLERANCE_SECONDS = 30;

export interface TwoFactorSetupData {
  secret: string;
  qrCode: string;
  manualEntryKey: string;
  otpauthUrl: string;
}

export class TwoFactorService {
  private readonly requestId: string;
  private readonly encryptionService: EncryptionService;

  constructor(requestId: string) {
    this.requestId = requestId;
    this.encryptionService = new EncryptionService(requestId);
  }

  async generateTwoFactorSetup(email: string): Promise<TwoFactorSetupData> {
    const secret = generateSecret();
    const serviceName = "ONTAP SuperAdmin";
    const otpauthUrl = generateURI({
      strategy: "totp",
      issuer: serviceName,
      label: email,
      secret,
      period: TOTP_PERIOD_SECONDS,
    });

    try {
      const qrCode = await QRCode.toDataURL(otpauthUrl);
      const manualEntryKey = secret.match(/.{1,4}/g)?.join(" ") ?? secret;

      return {
        secret,
        qrCode,
        manualEntryKey,
        otpauthUrl,
      };
    } catch (error) {
      throw createSettingsError(
        SettingsErrorCode.QR_CODE_GENERATION_FAILED,
        "Failed to generate 2FA QR code",
        500,
        this.requestId,
        {
          error: error instanceof Error ? error.message : "Unknown error",
        }
      );
    }
  }

  async verifyCode(secret: string, token: string): Promise<boolean> {
    const result = await verify({
      strategy: "totp",
      secret,
      token,
      period: TOTP_PERIOD_SECONDS,
      epochTolerance: TOTP_EPOCH_TOLERANCE_SECONDS,
    });
    return result.valid;
  }

  async enableTwoFactor(userId: number, secret: string, verificationCode: string): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { user_id: BigInt(userId) },
      select: {
        user_id: true,
        two_factor_enabled: true,
      },
    });

    if (!user) {
      throw createSettingsError(
        SettingsErrorCode.PROFILE_NOT_FOUND,
        "User not found",
        404,
        this.requestId,
        { userId }
      );
    }

    if (user.two_factor_enabled) {
      throw createSettingsError(
        SettingsErrorCode.TWO_FACTOR_ALREADY_ENABLED,
        "Two-factor authentication is already enabled",
        409,
        this.requestId,
        { userId }
      );
    }

    const isValid = await this.verifyCode(secret, verificationCode);
    if (!isValid) {
      throw createSettingsError(
        SettingsErrorCode.INVALID_TWO_FACTOR_CODE,
        "Invalid verification code",
        400,
        this.requestId
      );
    }

    const encryptedSecret = this.encryptionService.encryptToCompact(secret);

    await prisma.user.update({
      where: { user_id: BigInt(userId) },
      data: {
        two_factor_secret: encryptedSecret,
        two_factor_enabled: true,
      },
    });
  }

  async disableTwoFactor(userId: number): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { user_id: BigInt(userId) },
      select: {
        user_id: true,
        two_factor_enabled: true,
      },
    });

    if (!user) {
      throw createSettingsError(
        SettingsErrorCode.PROFILE_NOT_FOUND,
        "User not found",
        404,
        this.requestId,
        { userId }
      );
    }

    if (!user.two_factor_enabled) {
      throw createSettingsError(
        SettingsErrorCode.TWO_FACTOR_NOT_ENABLED,
        "Two-factor authentication is not enabled",
        409,
        this.requestId,
        { userId }
      );
    }

    await prisma.user.update({
      where: { user_id: BigInt(userId) },
      data: {
        two_factor_secret: null,
        two_factor_enabled: false,
      },
    });
  }

  async verifyTwoFactorLogin(userId: number, token: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { user_id: BigInt(userId) },
      select: {
        two_factor_secret: true,
        two_factor_enabled: true,
      },
    });

    if (!user || !user.two_factor_enabled || !user.two_factor_secret) {
      return false;
    }

    const decryptedSecret = this.encryptionService.decryptCompact(user.two_factor_secret);
    return this.verifyCode(decryptedSecret, token);
  }

  async getTwoFactorStatus(userId: number): Promise<{ enabled: boolean }> {
    const user = await prisma.user.findUnique({
      where: { user_id: BigInt(userId) },
      select: { two_factor_enabled: true },
    });

    if (!user) {
      throw createSettingsError(
        SettingsErrorCode.PROFILE_NOT_FOUND,
        "User not found",
        404,
        this.requestId,
        { userId }
      );
    }

    return { enabled: user.two_factor_enabled };
  }
}
