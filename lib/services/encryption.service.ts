import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { SettingsErrorCode, createSettingsError } from "@/lib/errors/settings-errors";

const KEY_HEX_LENGTH = 64;
const IV_LENGTH = 12;

type EncryptedPayload = {
  encryptedData: string;
  iv: string;
  authTag: string;
};

function getEncryptionKey(requestId: string): Buffer {
  const keyHex = process.env.SETTINGS_ENCRYPTION_KEY ?? process.env.AFFILIATE_ENCRYPTION_KEY;
  if (!keyHex || keyHex.length !== KEY_HEX_LENGTH) {
    throw createSettingsError(
      SettingsErrorCode.ENCRYPTION_FAILED,
      "Encryption key is not configured correctly",
      500,
      requestId,
      {
        expectedHexLength: KEY_HEX_LENGTH,
        providedLength: keyHex?.length ?? 0,
      }
    );
  }

  return Buffer.from(keyHex, "hex");
}

export class EncryptionService {
  private readonly requestId: string;

  constructor(requestId: string) {
    this.requestId = requestId;
  }

  encrypt(text: string): EncryptedPayload {
    try {
      const key = getEncryptionKey(this.requestId);
      const iv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv("aes-256-gcm", key, iv);

      let encrypted = cipher.update(text, "utf8", "hex");
      encrypted += cipher.final("hex");
      const authTag = cipher.getAuthTag().toString("hex");

      return {
        encryptedData: encrypted,
        iv: iv.toString("hex"),
        authTag,
      };
    } catch (error) {
      if (error instanceof Error && "code" in error) {
        throw error;
      }

      throw createSettingsError(
        SettingsErrorCode.ENCRYPTION_FAILED,
        "Failed to encrypt data",
        500,
        this.requestId,
        {
          error: error instanceof Error ? error.message : "Unknown error",
        }
      );
    }
  }

  decrypt(encryptedData: string, iv: string, authTag: string): string {
    try {
      const key = getEncryptionKey(this.requestId);
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "hex"));
      decipher.setAuthTag(Buffer.from(authTag, "hex"));

      let decrypted = decipher.update(encryptedData, "hex", "utf8");
      decrypted += decipher.final("utf8");

      return decrypted;
    } catch (error) {
      throw createSettingsError(
        SettingsErrorCode.DECRYPTION_FAILED,
        "Failed to decrypt data",
        500,
        this.requestId,
        {
          error: error instanceof Error ? error.message : "Unknown error",
        }
      );
    }
  }

  encryptToCompact(text: string): string {
    const encrypted = this.encrypt(text);
    return `${encrypted.iv}:${encrypted.authTag}:${encrypted.encryptedData}`;
  }

  decryptCompact(compact: string): string {
    const parts = compact.split(":");
    if (parts.length !== 3) {
      throw createSettingsError(
        SettingsErrorCode.DECRYPTION_FAILED,
        "Invalid encrypted payload format",
        500,
        this.requestId
      );
    }

    const [iv, authTag, encryptedData] = parts;
    return this.decrypt(encryptedData, iv, authTag);
  }
}
