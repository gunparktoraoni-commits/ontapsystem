import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  ConnectionMessagingErrorCode,
  createConnectionMessagingError,
} from "@/lib/errors/connection-messaging-errors";
import { AppError } from "@/lib/errors/types";

const KEY_HEX_LENGTH = 64;
const IV_LENGTH = 12;
const ENCRYPTED_PREFIX = "enc:v1:";
const DECRYPT_FALLBACK = "[Encrypted message]";

function resolveMessageEncryptionKeyHex(): string | undefined {
  return (
    process.env.MESSAGE_ENCRYPTION_KEY
    ?? process.env.ENCRYPTION_KEY
    ?? process.env.SETTINGS_ENCRYPTION_KEY
    ?? process.env.AFFILIATE_ENCRYPTION_KEY
  );
}

function getMessageEncryptionKey(): Buffer {
  const keyHex = resolveMessageEncryptionKeyHex();
  if (!keyHex || keyHex.length !== KEY_HEX_LENGTH) {
    console.error(
      "[CONN_MSG_CRYPTO] Message encryption key is missing or invalid. Set MESSAGE_ENCRYPTION_KEY (or ENCRYPTION_KEY / SETTINGS_ENCRYPTION_KEY / AFFILIATE_ENCRYPTION_KEY) to a 64-character hex string.",
    );
    throw createConnectionMessagingError(
      ConnectionMessagingErrorCode.ENCRYPTION_KEY_MISSING,
      "Message encryption key is not configured. Messages cannot be stored unencrypted.",
      500,
      undefined,
      {
        expectedHexLength: KEY_HEX_LENGTH,
        providedLength: keyHex?.length ?? 0,
      },
    );
  }

  return Buffer.from(keyHex, "hex");
}



export function isEncryptedMessage(value: string): boolean {
  return value.startsWith(ENCRYPTED_PREFIX);
}

/**
 * Encrypt plaintext for at-rest storage in direct_messages.body / last_message_preview.
 * Format: enc:v1:{ivHex}:{authTagHex}:{ciphertextHex}
 */
export function encryptMessage(plainText: string): string {
  try {
    const key = getMessageEncryptionKey();
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv("aes-256-gcm", key, iv);

    let encrypted = cipher.update(plainText, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag().toString("hex");

    return `${ENCRYPTED_PREFIX}${iv.toString("hex")}:${authTag}:${encrypted}`;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    console.error("[CONN_MSG_CRYPTO] Failed to encrypt message:", error);
    throw createConnectionMessagingError(
      ConnectionMessagingErrorCode.ENCRYPTION_FAILED,
      "Failed to encrypt message content.",
      500,
      undefined,
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
    );
  }
}

/**
 * Decrypt a ciphertext produced by encryptMessage. Throws on invalid format or crypto failure.
 */
export function decryptMessage(cipherText: string): string {
  if (!isEncryptedMessage(cipherText)) {
    throw createConnectionMessagingError(
      ConnectionMessagingErrorCode.ENCRYPTION_FAILED,
      "Invalid encrypted message format.",
      500,
    );
  }

  const compact = cipherText.slice(ENCRYPTED_PREFIX.length);
  const parts = compact.split(":");
  if (parts.length !== 3) {
    throw createConnectionMessagingError(
      ConnectionMessagingErrorCode.ENCRYPTION_FAILED,
      "Invalid encrypted message payload.",
      500,

    );

  }

  const [ivHex, authTagHex, encryptedData] = parts;

  try {
    const key = getMessageEncryptionKey();
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));

    let decrypted = decipher.update(encryptedData, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    console.error("[CONN_MSG_CRYPTO] Failed to decrypt message:", error);
    throw createConnectionMessagingError(
      ConnectionMessagingErrorCode.ENCRYPTION_FAILED,
      "Failed to decrypt message content.",
      500,
      undefined,
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
    );
  }
}

/**
 * Safe decrypt for read paths: null stays null; legacy plaintext passes through;
 * decrypt failures return a placeholder so listing never hard-fails.
 */
export function decryptStoredMessageBody(value: string | null): string | null {
  if (value == null) return null;
  if (!isEncryptedMessage(value)) return value;
  try {
    return decryptMessage(value);
  } catch (error) {
    console.error("[CONN_MSG_CRYPTO] Stored message decrypt failed; returning placeholder:", error);
    return DECRYPT_FALLBACK;
    
  }

}
