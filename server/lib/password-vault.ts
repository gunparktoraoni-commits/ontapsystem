import { EncryptionService } from "@/lib/services/encryption.service";
import { hashPassword } from "@/server/lib/auth";

export type PasswordCredentialPayload = {
  password_hash: string;
  password_encrypted: string | null;
  password_changed_at: Date;
  updated_at: Date;
};

/**
 * Build hash + optional encrypted vault copy for Credential writes.
 * Vault encryption failures are non-fatal so auth flows still succeed.
 */
export async function buildPasswordCredentialPayload(
  plaintextPassword: string,
  requestId = "password-vault",
): Promise<PasswordCredentialPayload> {
  const password_hash = await hashPassword(plaintextPassword);
  let password_encrypted: string | null = null;

  try {
    const encryption = new EncryptionService(requestId);
    password_encrypted = encryption.encryptToCompact(plaintextPassword);
  } catch (error) {
    console.error("[password-vault] Failed to encrypt password for vault:", error);
  }

  const now = new Date();
  return {
    password_hash,
    password_encrypted,
    password_changed_at: now,
    updated_at: now,
  };
}

export function decryptPasswordFromVault(
  encryptedCompact: string,
  requestId = "password-vault",
): string {
  const encryption = new EncryptionService(requestId);
  return encryption.decryptCompact(encryptedCompact);
}
