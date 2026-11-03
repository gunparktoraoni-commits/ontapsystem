/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "./errors/types";
import { ConnectionMessagingErrorCode } from "./errors/connection-messaging-errors";
import {
  decryptMessage,
  decryptStoredMessageBody,
  encryptMessage,
  isEncryptedMessage,
} from "./messaging-encryption";

const VALID_KEY = "a".repeat(64);

describe("messaging-encryption", () => {
  const originalMessageKey = process.env.MESSAGE_ENCRYPTION_KEY;
  const originalEncryptionKey = process.env.ENCRYPTION_KEY;
  const originalSettingsKey = process.env.SETTINGS_ENCRYPTION_KEY;
  const originalAffiliateKey = process.env.AFFILIATE_ENCRYPTION_KEY;

  function restoreEnv(name: string, value: string | undefined) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  beforeEach(() => {
    process.env.MESSAGE_ENCRYPTION_KEY = VALID_KEY;
    delete process.env.ENCRYPTION_KEY;
    delete process.env.SETTINGS_ENCRYPTION_KEY;
    delete process.env.AFFILIATE_ENCRYPTION_KEY;
  });

  afterEach(() => {
    restoreEnv("MESSAGE_ENCRYPTION_KEY", originalMessageKey);
    restoreEnv("ENCRYPTION_KEY", originalEncryptionKey);
    restoreEnv("SETTINGS_ENCRYPTION_KEY", originalSettingsKey);
    restoreEnv("AFFILIATE_ENCRYPTION_KEY", originalAffiliateKey);
  });

  it("round-trips plaintext through encrypt/decrypt", () => {
    const plain = "Hello associate — secret note";
    const cipher = encryptMessage(plain);
    expect(isEncryptedMessage(cipher)).toBe(true);
    expect(cipher.startsWith("enc:v1:")).toBe(true);
    expect(cipher).not.toContain(plain);
    expect(decryptMessage(cipher)).toBe(plain);
  });

  it("produces unique ciphertext for the same plaintext (random IV)", () => {
    const a = encryptMessage("same");
    const b = encryptMessage("same");
    expect(a).not.toBe(b);
    expect(decryptMessage(a)).toBe("same");
    expect(decryptMessage(b)).toBe("same");
  });

  it("detects encrypted vs legacy plaintext", () => {
    expect(isEncryptedMessage("plain hello")).toBe(false);
    expect(isEncryptedMessage(encryptMessage("x"))).toBe(true);
  });

  it("decryptStoredMessageBody passes through legacy plaintext", () => {
    expect(decryptStoredMessageBody("legacy message")).toBe("legacy message");
    expect(decryptStoredMessageBody(null)).toBeNull();
  });

  it("decryptStoredMessageBody decrypts encrypted values", () => {
    const cipher = encryptMessage("visible to client");
    expect(decryptStoredMessageBody(cipher)).toBe("visible to client");
  });

  it("decryptStoredMessageBody returns placeholder on corrupt ciphertext", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(decryptStoredMessageBody("enc:v1:bad:payload:here")).toBe("[Encrypted message]");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("throws ENCRYPTION_KEY_MISSING when key is unset", () => {
    delete process.env.MESSAGE_ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY;
    delete process.env.SETTINGS_ENCRYPTION_KEY;
    delete process.env.AFFILIATE_ENCRYPTION_KEY;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => encryptMessage("nope")).toThrow(AppError);
    try {
      encryptMessage("nope");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe(ConnectionMessagingErrorCode.ENCRYPTION_KEY_MISSING);
    }
    spy.mockRestore();
  });

  it("accepts ENCRYPTION_KEY fallback when MESSAGE_ENCRYPTION_KEY is unset", () => {
    delete process.env.MESSAGE_ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = VALID_KEY;
    const cipher = encryptMessage("via fallback key");
    expect(decryptMessage(cipher)).toBe("via fallback key");
  });

  it("accepts AFFILIATE_ENCRYPTION_KEY fallback when dedicated keys are unset", () => {
    delete process.env.MESSAGE_ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY;
    delete process.env.SETTINGS_ENCRYPTION_KEY;
    process.env.AFFILIATE_ENCRYPTION_KEY = VALID_KEY;
    const cipher = encryptMessage("via affiliate key");
    expect(decryptMessage(cipher)).toBe("via affiliate key");
  });

  it("throws ENCRYPTION_KEY_MISSING when key length is invalid", () => {
    process.env.MESSAGE_ENCRYPTION_KEY = "tooshort";
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => encryptMessage("x")).toThrow(AppError);
    try {
      encryptMessage("x");
    } catch (error) {
      expect((error as AppError).code).toBe(ConnectionMessagingErrorCode.ENCRYPTION_KEY_MISSING);
    }
    spy.mockRestore();
  });
});
