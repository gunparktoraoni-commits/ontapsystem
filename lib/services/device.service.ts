/**
 * Device Usage Service
 * 
 * Manages device fingerprint tracking, device eligibility checks,
 * device-to-user linking, and spin quota per device.
 */

import { PrismaClient } from '@prisma/client';
import { toJsonString } from '@/server/lib/json-field';
import {
  hashDeviceFingerprint,
  normalizeClientFingerprint,
} from '@/lib/utils/device-fingerprint';

const prisma = new PrismaClient();

export interface DeviceEligibilityResult {
  allowed: boolean;
  spinsUsed: number;
  linkedUserIds: bigint[];
  message?: string;
}

export interface LinkedAccountInfo {
  userId: bigint;
  email: string;
  firstSeen: Date;
}

export class DeviceService {
  private requestId: string;

  constructor(requestId: string) {
    this.requestId = requestId;
  }

  /**
   * Get or create a device ID from fingerprint
   * 
   * @param rawFingerprint - Raw fingerprint from client (FingerprintJS format)
   * @param userId - Optional user ID to link the device to
   * @returns Device hash for database storage
   */
  async getOrCreateDeviceId(
    rawFingerprint: unknown,
    userId?: bigint | null
  ): Promise<string> {
    // Normalize and validate the fingerprint
    const normalizedFingerprint = normalizeClientFingerprint(rawFingerprint);
    const deviceHash = hashDeviceFingerprint(normalizedFingerprint);

    // Try to find existing device
    const existingDevice = await prisma.deviceUsage.findUnique({
      where: { device_fingerprint: deviceHash },
      select: {
        device_fingerprint: true,
        primary_user_id: true,
        linked_user_ids: true,
      },
    });

    if (existingDevice) {
      // Device exists, optionally link new user
      if (userId && (!existingDevice.primary_user_id || existingDevice.primary_user_id !== userId)) {
        await this.linkDeviceToUser(deviceHash, userId);
      }
      return deviceHash;
    }

    // Create new device record
    await prisma.deviceUsage.create({
      data: {
        device_fingerprint: deviceHash,
        primary_user_id: userId || null,
        linked_user_ids: userId ? toJsonString([userId.toString()]) : null,
      },
    });

    console.log(`[DeviceService] Created new device ${deviceHash.substring(0, 8)}... for user ${userId || 'anonymous'}`);
    return deviceHash;
  }

  /**
   * Check if a device is eligible to spin
   * A device can only spin once per user
   * 
   * @param deviceHash - Device fingerprint hash
   * @param userId - User attempting to spin
   * @returns Eligibility result with details
   */
  async checkDeviceEligibility(deviceHash: string, userId: bigint): Promise<DeviceEligibilityResult> {
    const device = await prisma.deviceUsage.findUnique({
      where: { device_fingerprint: deviceHash },
      select: {
        spins_used: true,
        linked_user_ids: true,
        primary_user_id: true,
      },
    });

    // Device doesn't exist yet - first time spinning on this device
    if (!device) {
      return {
        allowed: true,
        spinsUsed: 0,
        linkedUserIds: [],
      };
    }

    // Parse linked user IDs
    const linkedUserIds = device.linked_user_ids
      ? (typeof device.linked_user_ids === 'string'
          ? JSON.parse(device.linked_user_ids)
          : device.linked_user_ids
        ).map((id: string | number) => BigInt(id))
      : [];

    // Current user is in linked users - can't spin again
    if (linkedUserIds.some((id: bigint) => id === userId)) {
      return {
        allowed: false,
        spinsUsed: device.spins_used,
        linkedUserIds,
        message: `This device has already been used for roulette spins. You cannot spin again on this device.`,
      };
    }

    // Device has been used but by different user(s) - can't spin
    if (device.spins_used > 0) {
      return {
        allowed: false,
        spinsUsed: device.spins_used,
        linkedUserIds,
        message: `This device has already been used for roulette spins. You cannot spin again on this device.`,
      };
    }

    // Device exists but no spins yet - allow
    return {
      allowed: true,
      spinsUsed: 0,
      linkedUserIds,
    };
  }

  /**
   * Record a successful spin for a device/user combination
   * Increments the spin counter and links the user to the device
   * 
   * @param deviceHash - Device fingerprint hash
   * @param userId - User who performed the spin
   */
  async recordDeviceSpin(deviceHash: string, userId: bigint): Promise<void> {
    // First check eligibility
    const eligibility = await this.checkDeviceEligibility(deviceHash, userId);
    if (!eligibility.allowed) {
      throw new Error(`Device not eligible for spin: ${eligibility.message}`);
    }

    // Get or create device record
    const device = await prisma.deviceUsage.findUnique({
      where: { device_fingerprint: deviceHash },
      select: { primary_user_id: true, linked_user_ids: true },
    });

    let linkedUsers: string[] = [];
    if (device?.linked_user_ids) {
      linkedUsers = typeof device.linked_user_ids === 'string'
        ? JSON.parse(device.linked_user_ids)
        : device.linked_user_ids;
    }

    // Add user to linked list if not already there
    if (!linkedUsers.includes(userId.toString())) {
      linkedUsers.push(userId.toString());
    }

    if (!device) {
      // Create new device record
      await prisma.deviceUsage.create({
        data: {
          device_fingerprint: deviceHash,
          primary_user_id: userId,
          linked_user_ids: toJsonString(linkedUsers),
          spins_used: 1,
          last_spin_at: new Date(),
        },
      });
    } else {
      // Update existing device record
      await prisma.deviceUsage.update({
        where: { device_fingerprint: deviceHash },
        data: {
          linked_user_ids: toJsonString(linkedUsers),
          spins_used: {
            increment: 1,
          },
          last_spin_at: new Date(),
          // Only update primary_user_id if it wasn't set
          ...(device.primary_user_id === null && { primary_user_id: userId }),
        },
      });
    }

    console.log(
      `[DeviceService] Recorded spin for device ${deviceHash.substring(0, 8)}... user ${userId}. Spins used: 1`
    );
  }

  /**
   * Link a device to a user account
   * Used when user logs in/registers, to track which accounts share devices
   * 
   * @param deviceHash - Device fingerprint hash
   * @param userId - User ID to link
   */
  async linkDeviceToUser(deviceHash: string, userId: bigint): Promise<void> {
    const device = await prisma.deviceUsage.findUnique({
      where: { device_fingerprint: deviceHash },
      select: { linked_user_ids: true, primary_user_id: true },
    });

    let linkedUsers: string[] = [];
    if (device?.linked_user_ids) {
      linkedUsers = typeof device.linked_user_ids === 'string'
        ? JSON.parse(device.linked_user_ids)
        : Array.isArray(device.linked_user_ids)
        ? (device.linked_user_ids as any[]).map(u => u.toString())
        : [];
    }

    // Add user if not already linked
    if (!linkedUsers.includes(userId.toString())) {
      linkedUsers.push(userId.toString());
    }

    await prisma.deviceUsage.update({
      where: { device_fingerprint: deviceHash },
      data: {
        linked_user_ids: toJsonString(linkedUsers),
        primary_user_id: device?.primary_user_id || userId,
      },
    });

    console.log(
      `[DeviceService] Linked device ${deviceHash.substring(0, 8)}... to user ${userId}`
    );
  }

  /**
   * Get all linked accounts for a device
   * 
   * @param deviceHash - Device fingerprint hash
   * @returns Array of linked user IDs
   */
  async getLinkedAccounts(deviceHash: string): Promise<bigint[]> {
    const device = await prisma.deviceUsage.findUnique({
      where: { device_fingerprint: deviceHash },
      select: { linked_user_ids: true },
    });

    if (!device?.linked_user_ids) {
      return [];
    }

    const linkedUsers = typeof device.linked_user_ids === 'string'
      ? JSON.parse(device.linked_user_ids)
      : device.linked_user_ids;

    return (linkedUsers as string[]).map(id => BigInt(id));
  }

  /**
   * Get device usage statistics
   * 
   * @param deviceHash - Device fingerprint hash
   * @returns Device usage info
   */
  async getDeviceStats(deviceHash: string) {
    return prisma.deviceUsage.findUnique({
      where: { device_fingerprint: deviceHash },
      select: {
        device_fingerprint: true,
        spins_used: true,
        linked_user_ids: true,
        first_seen_at: true,
        last_spin_at: true,
        created_at: true,
      },
    });
  }
}

export default DeviceService;
