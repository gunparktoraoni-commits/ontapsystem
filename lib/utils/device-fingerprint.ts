/**
 * Device Fingerprinting Utility
 * 
 * This module provides consistent device fingerprinting across the backend.
 * In production, this integrates with FingerprintJS Pro API for robust fingerprints.
 * For now, it provides utility functions for hashing and validating fingerprints.
 */

import crypto from 'crypto';

export interface DeviceFingerprintResult {
  fingerprint: string;
  hash: string;
  timestamp: number;
}

/**
 * Generate a consistent hash from a raw fingerprint string
 * This is used to store fingerprints securely in the database
 * 
 * @param rawFingerprint - The raw fingerprint string from FingerprintJS or other source
 * @returns Hash of the fingerprint for database storage
 */
export function hashDeviceFingerprint(rawFingerprint: string): string {
  if (!rawFingerprint || typeof rawFingerprint !== 'string') {
    throw new Error('Invalid fingerprint: must be a non-empty string');
  }

  const hash = crypto
    .createHash('sha256')
    .update(rawFingerprint.trim())
    .digest('hex');

  return hash;
}

/**
 * Validate fingerprint format from client
 * 
 * @param fingerprint - Fingerprint string to validate
 * @returns True if valid, false otherwise
 */
export function isValidFingerprint(fingerprint: unknown): fingerprint is string {
  if (typeof fingerprint !== 'string') {
    return false;
  }

  // FingerprintJS Pro returns UUIDs or hex strings, typically 32-64 chars
  // Allow some flexibility for different fingerprinting sources
  return fingerprint.length >= 32 && fingerprint.length <= 256;
}

/**
 * Generate a test fingerprint for development/testing
 * DO NOT use in production
 * 
 * @param userAgent - Optional user agent string
 * @param seed - Optional seed for reproducibility
 * @returns Test fingerprint string
 */
export function generateTestFingerprint(userAgent?: string, seed?: number): string {
  const agent = userAgent || 'test-agent';
  const s = seed || Date.now();

  return crypto
    .createHash('sha256')
    .update(`${agent}-${s}`)
    .digest('hex')
    .substring(0, 32); // Truncate to 32 chars for consistency
}

/**
 * Generate a device ID (for frontend integration)
 * This should be called on the frontend using actual FingerprintJS library
 * 
 * Type definition for what the frontend should send
 */
export interface ClientDeviceFingerprint {
  visitorId: string; // From FingerprintJS
  confidence: {
    score: number; // 0.0 to 1.0
  };
  components?: Record<string, any>; // Optional detailed components from FP
}

/**
 * Validate device fingerprint request from client
 * 
 * @param payload - Raw fingerprint data from client
 * @returns Normalized fingerprint string or throws error
 */
export function normalizeClientFingerprint(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid fingerprint payload');
  }

  const data = payload as Record<string, any>;

  // Accept either:
  // 1. FingerprintJS format: { visitorId: string, confidence: { score: number } }
  // 2. Simple string: just the fingerprint
  // 3. Simple object: { fingerprint: string }

  let fingerprint = '';

  if (typeof data.visitorId === 'string') {
    fingerprint = data.visitorId;
  } else if (typeof data.fingerprint === 'string') {
    fingerprint = data.fingerprint;
  } else if (typeof data === 'string') {
    fingerprint = data;
  }

  if (!isValidFingerprint(fingerprint)) {
    throw new Error('Invalid fingerprint format');
  }

  return fingerprint;
}

/**
 * Check if two fingerprints match
 * Uses timing-safe comparison to prevent timing attacks
 * 
 * @param hash1 - First hashed fingerprint
 * @param hash2 - Second hashed fingerprint
 * @returns True if hashes match
 */
export function compareFingerprints(hash1: string, hash2: string): boolean {
  try {
    return crypto.timingSafeEqual(Buffer.from(hash1), Buffer.from(hash2));
  } catch {
    return false;
  }
}
