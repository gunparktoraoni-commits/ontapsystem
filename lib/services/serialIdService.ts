import { randomBytes } from "node:crypto";
import { prisma } from "@/server/lib/prisma";
import {
  isValidSerialId as isValidSerialIdFormat,
  normalizeSerialId as normalizeSerialIdFormat,
} from "@/lib/bizcard/serial-id-format";

const prismaAny = prisma as any;

export class SerialIdService {
  private static instance: SerialIdService;
  private readonly serialLength = 6;
  // Character set excludes I, O, 0, 1 to avoid confusion
  private readonly characterSet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  private constructor() {}

  static getInstance(): SerialIdService {
    if (!SerialIdService.instance) {
      SerialIdService.instance = new SerialIdService();
    }
    return SerialIdService.instance;
  }

  /**
   * Generate a single 6-character serial ID
   * Format: XXXXXX (6 uppercase alphanumeric characters)
   * Example: A3F8K2
   */
  generateSerialId(): string {
    const bytes = randomBytes(this.serialLength);
    let serial = "";

    for (let i = 0; i < this.serialLength; i++) {
      const idx = bytes[i] % this.characterSet.length;
      serial += this.characterSet[idx];
    }

    return serial;
  }

  /**
   * Generate multiple unique serial IDs with conflict checking
   */
  async generateBatchSerialIds(count: number): Promise<string[]> {
    if (!Number.isInteger(count) || count < 1 || count > 10000) {
      throw new Error("count must be an integer between 1 and 10000");
    }

    const unique = new Set<string>();
    let attempts = 0;
    const maxAttempts = 50;

    while (unique.size < count && attempts < maxAttempts) {
      attempts++;
      
      const remaining = count - unique.size;
      const batchSize = Math.min(remaining * 3, 500);
      const candidates = new Set<string>();

      for (let i = 0; i < batchSize; i++) {
        candidates.add(this.generateSerialId());
      }

      const candidateArray = Array.from(candidates);
      
      // Check for existing serial IDs in database
      const existingRows = await prismaAny.bizcard.findMany({
        where: {
          serial_id: {
            in: candidateArray,
          },
        },
        select: {
          serial_id: true,
        },
      });

      const existing = new Set<string>(
        existingRows
          .map((row: { serial_id?: string | null }) => row.serial_id)
          .filter((v: string | null | undefined): v is string => typeof v === "string")
      );

      for (const candidate of candidateArray) {
        if (unique.size >= count) break;
        if (!existing.has(candidate) && !unique.has(candidate)) {
          unique.add(candidate);
        }
      }
    }

    if (unique.size < count) {
      throw new Error(`Unable to generate ${count} unique serial IDs after ${maxAttempts} attempts`);
    }

    return Array.from(unique);
  }

  /**
   * Validate serial ID format
   * Must be exactly 6 uppercase alphanumeric characters
   * Excludes I, O, 0, 1
   */
  validateSerialId(serialId: string): boolean {
    return isValidSerialIdFormat(serialId);
  }

  /**
   * Normalize serial ID: trim, uppercase, remove spaces
   */
  normalizeSerialId(serialId: string): string | null {
    return normalizeSerialIdFormat(serialId);
  }

  /**
   * Get regex pattern for validation
   */
  getSerialIdPattern(): RegExp {
    return /^[A-HJ-NP-Z2-9]{6}$/;
  }
}