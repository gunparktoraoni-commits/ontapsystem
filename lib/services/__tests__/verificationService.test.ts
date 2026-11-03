import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "crypto";

const {
  findUniqueUser,
  findFirstEmailOtp,
  updateEmailOtp,
  updateManyEmailOtp,
  createEmailOtp,
  updateCredential,
  transaction,
  sendVerificationEmail,
} = vi.hoisted(() => ({
  findUniqueUser: vi.fn(),
  findFirstEmailOtp: vi.fn(),
  updateEmailOtp: vi.fn(),
  updateManyEmailOtp: vi.fn(),
  createEmailOtp: vi.fn(),
  updateCredential: vi.fn(),
  transaction: vi.fn(),
  sendVerificationEmail: vi.fn(),
}));

vi.mock("@/server/lib/prisma", () => ({
  prisma: {
    user: { findUnique: findUniqueUser },
    emailOtp: {
      findFirst: findFirstEmailOtp,
      update: updateEmailOtp,
      updateMany: updateManyEmailOtp,
      create: createEmailOtp,
    },
    credential: { update: updateCredential },
    $transaction: transaction,
  },
}));

vi.mock("@/lib/services/emailService", () => ({
  EmailService: {
    getInstance: () => ({
      sendVerificationEmail,
    }),
  },
}));

import { VerificationService } from "../verificationService";
import {
  validateVerifyEmailOtpInput,
  validateResendOtpInput,
} from "@/server/lib/validators";
import { generateEmailOtp } from "@/server/lib/auth";

describe("VerificationService crypto helpers", () => {
  const originalJwt = process.env.JWT_SECRET;
  const originalAffiliate = process.env.AFFILIATE_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.JWT_SECRET = "test-jwt-secret-for-verification";
    delete process.env.AFFILIATE_ENCRYPTION_KEY;
    VerificationService.resetInstanceForTests();
  });

  afterEach(() => {
    if (originalJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwt;
    if (originalAffiliate === undefined) {
      delete process.env.AFFILIATE_ENCRYPTION_KEY;
    } else {
      process.env.AFFILIATE_ENCRYPTION_KEY = originalAffiliate;
    }
    VerificationService.resetInstanceForTests();
  });

  it("generates 6-digit numeric codes", () => {
    const service = VerificationService.getInstance();
    for (let i = 0; i < 20; i += 1) {
      const code = service.generateCode();
      expect(code).toMatch(/^\d{6}$/);
      expect(Number(code)).toBeGreaterThanOrEqual(100000);
      expect(Number(code)).toBeLessThan(1000000);
    }
  });

  it("hashes and verifies codes with timing-safe compare", () => {
    const service = VerificationService.getInstance();
    const code = "482931";
    const hash = service.hashCode(code);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(service.verifyCode(code, hash)).toBe(true);
    expect(service.verifyCode("000000", hash)).toBe(false);
    expect(service.verifyCode(code, "")).toBe(false);
  });

  it("verifies existing SHA-256 alphanumeric email OTPs without changing case", () => {
    const service = VerificationService.getInstance();
    const code = "hdQtaD";
    const hash = createHash("sha256").update(code).digest("hex");

    expect(service.verifyCode(code, hash)).toBe(true);
    expect(service.verifyCode("hdQtaE", hash)).toBe(false);
    expect(service.verifyCode(code.toLowerCase(), hash)).toBe(false);
  });

  it("uses JWT_SECRET as HMAC pepper (different pepper → different hash)", () => {
    const service = VerificationService.getInstance();
    const hashA = service.hashCode("123456");
    process.env.JWT_SECRET = "a-different-pepper-value";
    VerificationService.resetInstanceForTests();
    const serviceB = VerificationService.getInstance();
    const hashB = serviceB.hashCode("123456");
    expect(hashA).not.toBe(hashB);
    expect(serviceB.verifyCode("123456", hashA)).toBe(false);
  });
});

describe("VerificationService.validateCode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = "test-jwt-secret-for-verification";
    VerificationService.resetInstanceForTests();
    transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        emailOtp: {
          updateMany: updateManyEmailOtp,
          create: createEmailOtp,
          update: updateEmailOtp,
        },
        credential: { update: updateCredential },
      };
      return fn(tx);
    });
  });

  it("returns USER_NOT_FOUND when email has no account", async () => {
    findUniqueUser.mockResolvedValue(null);
    const result = await VerificationService.getInstance().validateCode(
      "missing@example.com",
      "123456",
    );
    expect(result).toEqual({ valid: false, error: "USER_NOT_FOUND" });
  });

  it("returns ALREADY_VERIFIED for verified credentials", async () => {
    findUniqueUser.mockResolvedValue({
      user_id: 7n,
      credentials: { email_verified: true },
    });
    const result = await VerificationService.getInstance().validateCode(
      "done@example.com",
      "123456",
    );
    expect(result).toEqual({ valid: false, error: "ALREADY_VERIFIED" });
  });

  it("returns NO_ACTIVE_CODE when no unused OTP exists", async () => {
    findUniqueUser.mockResolvedValue({
      user_id: 7n,
      credentials: { email_verified: false },
    });
    findFirstEmailOtp.mockResolvedValue(null);
    const result = await VerificationService.getInstance().validateCode(
      "user@example.com",
      "123456",
    );
    expect(result).toEqual({
      valid: false,
      error: "NO_ACTIVE_CODE",
      shouldReset: true,
    });
    expect(findFirstEmailOtp).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          purpose: "email_verification",
          used: false,
          expires_at: { gt: expect.any(Date) },
        }),
      }),
    );
  });

  it("rejects an expired OTP", async () => {
    const expiredAt = new Date(Date.now() - 60_000);
    findUniqueUser.mockResolvedValue({
      user_id: 7n,
      credentials: { email_verified: false },
    });
    findFirstEmailOtp.mockImplementation(
      async (query: { where: { expires_at: { gt: Date } } }) =>
        query.where.expires_at.gt > expiredAt
          ? null
          : { id: 9n, otp_hash: "unused", attempts: 0 },
    );

    const result = await VerificationService.getInstance().validateCode(
      "user@example.com",
      "123456",
    );

    expect(result).toEqual({
      valid: false,
      error: "NO_ACTIVE_CODE",
      shouldReset: true,
    });
    expect(updateEmailOtp).not.toHaveBeenCalled();
    expect(updateCredential).not.toHaveBeenCalled();
  });

  it("marks credential verified on correct OTP", async () => {
    const service = VerificationService.getInstance();
    const code = "654321";
    const hash = service.hashCode(code);

    findUniqueUser.mockResolvedValue({
      user_id: 42n,
      credentials: { email_verified: false },
    });
    findFirstEmailOtp.mockResolvedValue({
      id: 9n,
      otp_hash: hash,
      attempts: 0,
    });
    updateEmailOtp.mockResolvedValue({ id: 9n, attempts: 0 });
    updateCredential.mockResolvedValue({});

    const result = await service.validateCode("User@Example.com", code);
    expect(result).toEqual({ valid: true });
    expect(updateEmailOtp).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 9n },
        data: { used: true },
      }),
    );
    expect(updateCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { user_id: 42n },
        data: expect.objectContaining({ email_verified: true }),
      }),
    );
  });

  it("accepts a SHA-256 OTP and marks it used and the credential verified", async () => {
    const code = "hdQtaD";
    const hash = createHash("sha256").update(code).digest("hex");

    findUniqueUser.mockResolvedValue({
      user_id: 42n,
      credentials: { email_verified: false },
    });
    findFirstEmailOtp.mockResolvedValue({
      id: 9n,
      otp_hash: hash,
      attempts: 0,
    });
    updateEmailOtp.mockResolvedValue({ id: 9n, attempts: 0 });
    updateCredential.mockResolvedValue({});

    const result = await VerificationService.getInstance().validateCode(
      "user@example.com",
      code,
    );

    expect(result).toEqual({ valid: true });
    expect(updateEmailOtp).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 9n },
        data: { used: true },
      }),
    );
    expect(updateCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { user_id: 42n },
        data: expect.objectContaining({ email_verified: true }),
      }),
    );
  });

  it("increments attempts and returns INVALID_CODE on wrong OTP", async () => {
    const service = VerificationService.getInstance();
    findUniqueUser.mockResolvedValue({
      user_id: 42n,
      credentials: { email_verified: false },
    });
    findFirstEmailOtp.mockResolvedValue({
      id: 9n,
      otp_hash: service.hashCode("111111"),
      attempts: 0,
    });
    updateEmailOtp.mockResolvedValue({ id: 9n, attempts: 1 });

    const result = await service.validateCode("user@example.com", "222222");
    expect(result).toEqual({
      valid: false,
      error: "INVALID_CODE",
      shouldReset: false,
    });
  });

  it("returns MAX_ATTEMPTS_EXCEEDED after too many failures", async () => {
    const service = VerificationService.getInstance();
    findUniqueUser.mockResolvedValue({
      user_id: 42n,
      credentials: { email_verified: false },
    });
    findFirstEmailOtp.mockResolvedValue({
      id: 9n,
      otp_hash: service.hashCode("111111"),
      attempts: 2,
    });
    updateEmailOtp.mockResolvedValueOnce({ id: 9n, attempts: 3 });
    updateEmailOtp.mockResolvedValueOnce({ id: 9n, used: true });

    const result = await service.validateCode("user@example.com", "999999");
    expect(result).toEqual({
      valid: false,
      error: "MAX_ATTEMPTS_EXCEEDED",
      shouldReset: true,
    });
  });
});

describe("VerificationService.createVerification / resendVerification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = "test-jwt-secret-for-verification";
    VerificationService.resetInstanceForTests();
    transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        emailOtp: {
          updateMany: updateManyEmailOtp,
          create: createEmailOtp,
          update: updateEmailOtp,
        },
        credential: { update: updateCredential },
      };
      return fn(tx);
    });
  });

  it("creates an email_verification OTP scoped by purpose", async () => {
    findUniqueUser.mockResolvedValue({
      user_id: 5n,
      first_name: "Cris",
      email: "cris@example.com",
      credentials: { email_verified: false },
    });

    const result = await VerificationService.getInstance().createVerification(
      "  Cris@Example.com ",
    );
    expect("error" in result).toBe(false);
    if ("error" in result) return;

    expect(result.code).toMatch(/^\d{6}$/);
    expect(result.userId).toBe(5);
    expect(updateManyEmailOtp).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          purpose: "email_verification",
          used: false,
        }),
      }),
    );
    expect(createEmailOtp).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          purpose: "email_verification",
          used: false,
          attempts: 0,
        }),
      }),
    );
  });

  it("enforces resend cooldown for email_verification purpose only", async () => {
    findUniqueUser.mockResolvedValue({
      user_id: 5n,
      first_name: "Cris",
      email: "cris@example.com",
      credentials: { email_verified: false },
    });
    findFirstEmailOtp.mockResolvedValue({
      id: 1n,
      created_at: new Date(Date.now() - 10_000),
    });

    const result =
      await VerificationService.getInstance().resendVerification(
        "cris@example.com",
      );
    expect(result.success).toBe(false);
    expect(result.error).toBe("RATE_LIMIT_EXCEEDED");
    expect(result.cooldownRemaining).toBeGreaterThan(0);
    expect(findFirstEmailOtp).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ purpose: "email_verification" }),
      }),
    );
  });

  it("returns EMAIL_SEND_FAILED when SMTP/provider send fails", async () => {
    findUniqueUser.mockResolvedValue({
      user_id: 5n,
      first_name: "Cris",
      email: "cris@example.com",
      credentials: { email_verified: false },
    });
    findFirstEmailOtp.mockResolvedValue(null);
    sendVerificationEmail.mockResolvedValue({
      success: false,
      error: "SMTP_SEND_FAILED",
    });

    const result =
      await VerificationService.getInstance().resendVerification(
        "cris@example.com",
      );
    expect(result).toEqual({ success: false, error: "EMAIL_SEND_FAILED" });
  });

  it("returns success when resend email is delivered", async () => {
    findUniqueUser.mockResolvedValue({
      user_id: 5n,
      first_name: "Cris",
      email: "cris@example.com",
      credentials: { email_verified: false },
    });
    findFirstEmailOtp.mockResolvedValue(null);
    sendVerificationEmail.mockResolvedValue({
      success: true,
      messageId: "msg-1",
    });

    const result =
      await VerificationService.getInstance().resendVerification(
        "cris@example.com",
      );
    expect(result).toEqual({ success: true });
    expect(sendVerificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "cris@example.com",
        code: expect.stringMatching(/^\d{6}$/),
      }),
    );
  });
});

describe("email verification validators", () => {
  it("accepts a valid 6-character OTP payload", () => {
    const result = validateVerifyEmailOtpInput({
      userId: 12,
      otp: "Ab3xY9",
    });
    expect(result.valid).toBe(true);
    expect(result.data).toEqual({ userId: 12, otp: "Ab3xY9" });
  });

  it("rejects missing/invalid OTP and userId", () => {
    const result = validateVerifyEmailOtpInput({ userId: "x", otp: "123" });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });

  it("validates resend-otp userId", () => {
    expect(validateResendOtpInput({ userId: 3 }).valid).toBe(true);
    expect(validateResendOtpInput({}).valid).toBe(false);
  });
});

describe("generateEmailOtp (auth helper)", () => {
  it("produces 6-char alphanumeric codes without ambiguous glyphs", () => {
    for (let i = 0; i < 30; i += 1) {
      const otp = generateEmailOtp();
      expect(otp).toHaveLength(6);
      expect(otp).toMatch(/^[A-HJ-NP-Za-hj-km-np-z2-9]+$/);
      expect(otp).not.toMatch(/[IlO01]/);
    }
  });
});
