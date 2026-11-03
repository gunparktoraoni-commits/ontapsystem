// lib/bizcard/generator.ts
import { randomBytes } from "crypto";

export const SERIAL_ID_LENGTH = 6;
export const SERIAL_ID_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const SERIAL_ID_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;

/**
 * Get a random character from the charset
 */
function getRandomChar(): string {
  const randomIndex = randomBytes(1)[0] % SERIAL_ID_CHARSET.length;
  return SERIAL_ID_CHARSET[randomIndex];
}

/**
 * Generate a serial ID for a bizcard
 * Format: 6 characters (uppercase letters + numbers, excluding I,O,0,1)
 * Example: A3F8K2
 */
export function generateBizcardSerialId(): string {
  let serial = "";
  for (let i = 0; i < SERIAL_ID_LENGTH; i++) {
    serial += getRandomChar();
  }
  return serial;
}

/**
 * Generate multiple unique serial IDs
 */
export async function generateUniqueSerialIds(
  count: number,
  checkExisting?: (ids: string[]) => Promise<Set<string>>
): Promise<string[]> {
  const ids = new Set<string>();
  let attempts = 0;
  const maxAttempts = 50;

  while (ids.size < count && attempts < maxAttempts) {
    attempts++;
    const remaining = count - ids.size;
    const batchSize = Math.min(remaining * 3, 500);
    const candidates = new Set<string>();

    for (let i = 0; i < batchSize; i++) {
      candidates.add(generateBizcardSerialId());
    }

    const candidateArray = Array.from(candidates);
    
    if (checkExisting) {
      const existing = await checkExisting(candidateArray);
      for (const candidate of candidateArray) {
        if (ids.size >= count) break;
        if (!existing.has(candidate) && !ids.has(candidate)) {
          ids.add(candidate);
        }
      }
    } else {
      for (const candidate of candidateArray) {
        if (ids.size >= count) break;
        if (!ids.has(candidate)) {
          ids.add(candidate);
        }
      }
    }
  }

  if (ids.size < count) {
    throw new Error(`Failed to generate ${count} unique serial IDs after ${maxAttempts} attempts`);
  }

  return Array.from(ids);
}

/**
 * Generate URL alias from first and last name
 */
export function generateUrlAlias(firstName: string, lastName: string, userId: bigint): string {
  const base = `${firstName}-${lastName}`.toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  
  const suffix = userId.toString().slice(-6);
  return `${base}-${suffix}`;
}

/**
 * Normalize URL alias (lowercase, remove special chars)
 */
export function normalizeUrlAlias(alias: string): string | null {
  const cleaned = alias.trim().toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  
  if (cleaned.length >= 3 && cleaned.length <= 64) {
    return cleaned;
  }
  return null;
}

/**
 * Validate serial ID format
 */
export function isValidSerialId(serialId: string): boolean {
  const normalized = normalizeSerialId(serialId);
  if (!normalized) return false;
  return SERIAL_ID_PATTERN.test(normalized);
}

/**
 * Normalize serial ID (uppercase, remove spaces)
 */
export function normalizeSerialId(input: string): string | null {
  const cleaned = input.trim().toUpperCase().replace(/\s+/g, "");
  if (cleaned.length === 0) return null;
  return cleaned;
}