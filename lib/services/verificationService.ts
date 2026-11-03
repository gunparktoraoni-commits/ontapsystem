import crypto, { randomInt, timingSafeEqual } from "crypto";
import { prisma } from "@/server/lib/prisma";
import { EmailService } from "@/lib/services/emailService";

const CODE_LENGTH = 6;
const CODE_EXPIRY_MINUTES = 15;
const MAX_ATTEMPTS = 3;
const RESEND_COOLDOWN_SECONDS = 60;
const EMAIL_VERIFICATION_PURPOSE = "email_verification";

type VerificationError =
  | "NO_ACTIVE_CODE"
  | "INVALID_CODE"
  | "MAX_ATTEMPTS_EXCEEDED"
  | "RATE_LIMIT_EXCEEDED"
  | "USER_NOT_FOUND"
  | "ALREADY_VERIFIED"
  | "EMAIL_SEND_FAILED";

export class VerificationService {
  private static instance: VerificationService;

  private constructor() {}

  static getInstance(): VerificationService {
    if (!VerificationService.instance) {
      VerificationService.instance = new VerificationService();
    }
    return VerificationService.instance;
  }

  /** Test helper — clears the singleton between unit tests. */
  static resetInstanceForTests(): void {
    VerificationService.instance = undefined as unknown as VerificationService;
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  generateCode(): string {
    const min = 10 ** (CODE_LENGTH - 1);
    const max = 10 ** CODE_LENGTH;
    return randomInt(min, max).toString();
  }

  hashCode(code: string): string {
    const pepper =
      process.env.JWT_SECRET ||
      process.env.AFFILIATE_ENCRYPTION_KEY ||
      "default-pepper";
    return crypto.createHmac("sha256", pepper).update(code).digest("hex");
  }

  verifyCode(inputCode: string, storedHash: string): boolean {
    if (!storedHash) return false;

    const stored = Buffer.from(storedHash, "hex");
    const matchesStoredHash = (hash: string): boolean => {
      const candidate = Buffer.from(hash, "hex");
      return candidate.length === stored.length && timingSafeEqual(candidate, stored);
    };

    const hmacMatch = matchesStoredHash(this.hashCode(inputCode));
    const sha256Match = matchesStoredHash(
      crypto.createHash("sha256").update(inputCode).digest("hex"),
    );

    return hmacMatch || sha256Match;
  }

  async createVerification(
    email: string,
  ): Promise<
    { code: string; expiresAt: Date; userId: number } | { error: VerificationError }
  > {
    const normalizedEmail = this.normalizeEmail(email);

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: {
        user_id: true,
        first_name: true,
        email: true,
        credentials: { select: { email_verified: true } },
      },
    });

    if (!user) return { error: "USER_NOT_FOUND" };
    if (user.credentials?.email_verified) return { error: "ALREADY_VERIFIED" };

    const userId = Number(user.user_id);
    const code = this.generateCode();
    const codeHash = this.hashCode(code);
    const expiresAt = new Date(Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000);

    await prisma.$transaction(async (tx) => {
      await tx.emailOtp.updateMany({
        where: {
          user_id: BigInt(userId),
          used: false,
          purpose: EMAIL_VERIFICATION_PURPOSE,
        },
        data: { used: true },
      });

      await tx.emailOtp.create({
        data: {
          user_id: BigInt(userId),
          otp_hash: codeHash,
          attempts: 0,
          used: false,
          purpose: EMAIL_VERIFICATION_PURPOSE,
          expires_at: expiresAt,
        },
      });
    });

    return { code, expiresAt, userId };
  }

  async validateCode(
    email: string,
    inputCode: string,
  ): Promise<{
    valid: boolean;
    error?: VerificationError;
    shouldReset?: boolean;
  }> {
    const normalizedEmail = this.normalizeEmail(email);

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: {
        user_id: true,
        credentials: { select: { email_verified: true } },
      },
    });

    if (!user) return { valid: false, error: "USER_NOT_FOUND" };
    if (user.credentials?.email_verified) {
      return { valid: false, error: "ALREADY_VERIFIED" };
    }

    const userId = Number(user.user_id);

    const verification = await prisma.emailOtp.findFirst({
      where: {
        user_id: BigInt(userId),
        used: false,
        purpose: EMAIL_VERIFICATION_PURPOSE,
        expires_at: { gt: new Date() },
      },
      orderBy: { created_at: "desc" },
    });

    if (!verification) {
      return { valid: false, error: "NO_ACTIVE_CODE", shouldReset: true };
    }

    if (verification.attempts >= MAX_ATTEMPTS) {
      await prisma.emailOtp.update({
        where: { id: verification.id },
        data: { used: true },
      });
      return { valid: false, error: "MAX_ATTEMPTS_EXCEEDED", shouldReset: true };
    }

    const isValid = this.verifyCode(inputCode, verification.otp_hash);

    if (!isValid) {
      const updated = await prisma.emailOtp.update({
        where: { id: verification.id },
        data: { attempts: { increment: 1 } },
      });

      const remainingAttempts = MAX_ATTEMPTS - updated.attempts;
      if (remainingAttempts <= 0) {
        await prisma.emailOtp.update({
          where: { id: verification.id },
          data: { used: true },
        });
        return {
          valid: false,
          error: "MAX_ATTEMPTS_EXCEEDED",
          shouldReset: true,
        };
      }

      return { valid: false, error: "INVALID_CODE", shouldReset: false };
    }

    await prisma.$transaction(async (tx) => {
      await tx.emailOtp.update({
        where: { id: verification.id },
        data: { used: true },
      });

      await tx.credential.update({
        where: { user_id: BigInt(userId) },
        data: {
          email_verified: true,
          email_verified_at: new Date(),
        },
      });
    });

    return { valid: true };
  }

  async resendVerification(
    email: string,
  ): Promise<{
    success: boolean;
    cooldownRemaining?: number;
    error?: VerificationError;
  }> {
    const normalizedEmail = this.normalizeEmail(email);

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: {
        user_id: true,
        first_name: true,
        email: true,
        credentials: { select: { email_verified: true } },
      },
    });

    if (!user) return { success: false, error: "USER_NOT_FOUND" };
    if (user.credentials?.email_verified) {
      return { success: false, error: "ALREADY_VERIFIED" };
    }

    const userId = Number(user.user_id);

    const recentVerification = await prisma.emailOtp.findFirst({
      where: {
        user_id: BigInt(userId),
        purpose: EMAIL_VERIFICATION_PURPOSE,
        created_at: {
          gt: new Date(Date.now() - RESEND_COOLDOWN_SECONDS * 1000),
        },
      },
      orderBy: { created_at: "desc" },
    });

    if (recentVerification) {
      const secondsElapsed = Math.floor(
        (Date.now() - recentVerification.created_at.getTime()) / 1000,
      );
      return {
        success: false,
        cooldownRemaining: Math.max(
          1,
          RESEND_COOLDOWN_SECONDS - secondsElapsed,
        ),
        error: "RATE_LIMIT_EXCEEDED",
      };
    }

    const created = await this.createVerification(normalizedEmail);
    if ("error" in created) return { success: false, error: created.error };

    const emailService = EmailService.getInstance();
    const sent = await emailService.sendVerificationEmail({
      email: normalizedEmail,
      code: created.code,
      expiresAt: created.expiresAt,
    });

    if (!sent.success) {
      return { success: false, error: "EMAIL_SEND_FAILED" };
    }

    return { success: true };
  }
}
