/**
 * Session Storage Helper for BizCard Setup Flow
 * 
 * Manages temporary localStorage storage for incomplete BizCard setup sessions.
 * This allows users to resume setup from where they left off if they refresh or navigate away.
 */

import type { BizCardFormData, VCardFormData, ServiceItem, GalleryItem, VideoItem } from '../types';

const SETUP_SESSION_KEY = 'ontap:setup:session';
const SESSION_EXPIRY_DAYS = 7;

export interface SetupSession {
  /** Unique session identifier (UUID or timestamp-based) */
  sessionId: string;
  
  /** Email address entered during registration */
  email: string;
  
  /** User ID from registration (if available) */
  userId?: number;
  
  /** Current step in the setup wizard (0-based or step name) */
  currentStep: 'register' | 'verify' | 'verified' | 'bizcard' | 'vcard' | 'services' | 'theme' | 'completed' | 'upsell' | 'passkey' | 'completed';
  
  /** Collected data from each step */
  stepData: {
    bizCard?: BizCardFormData;
    vcard?: VCardFormData;
    services?: ServiceItem[];
    gallery?: GalleryItem[];
    videos?: VideoItem[];
    selectedTheme?: string;
  };
  
  /** Whether the session has been successfully completed and saved */
  isComplete: boolean;
  
  /** Timestamp when the session was created */
  createdAt: string;
  
  /** Timestamp when the session was last updated */
  updatedAt: string;
  
  /** OTP verification state */
  emailVerified?: boolean;
  
  /** QR Serial for distributed cards (if applicable) */
  assignedBizcardSerial?: string;
}

/**
 * Generate a unique session ID
 */
function generateSessionId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Check if a session has expired
 */
function isSessionExpired(session: SetupSession): boolean {
  const createdAt = new Date(session.createdAt).getTime();
  const now = Date.now();
  const expiryTime = SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
  return now - createdAt > expiryTime;
}

/**
 * Create a new setup session
 */
export function createSetupSession(email: string, userId?: number): SetupSession {
  const now = new Date().toISOString();
  return {
    sessionId: generateSessionId(),
    email: email.trim().toLowerCase(),
    userId,
    currentStep: 'register',
    stepData: {},
    isComplete: false,
    createdAt: now,
    updatedAt: now,
    emailVerified: false,
  };
}

/**
 * Save a setup session to localStorage
 */
export function saveSetupSession(session: SetupSession): void {
  if (typeof window === 'undefined') return;
  try {
    // Always update the timestamp
    const updatedSession = {
      ...session,
      updatedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(SETUP_SESSION_KEY, JSON.stringify(updatedSession));
  } catch (error) {
    console.warn('[SessionStorage] Failed to save setup session:', error);
  }
}

/**
 * Load a setup session from localStorage
 */
export function loadSetupSession(): SetupSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(SETUP_SESSION_KEY);
    if (!stored) return null;
    
    const session = JSON.parse(stored) as SetupSession;
    
    // Check if session has expired
    if (isSessionExpired(session)) {
      clearSetupSession();
      return null;
    }
    
    return session;
  } catch (error) {
    console.warn('[SessionStorage] Failed to load setup session:', error);
    return null;
  }
}

/**
 * Get session for a specific email (checks if incomplete session exists)
 */
export function getSessionForEmail(email: string): SetupSession | null {
  const session = loadSetupSession();
  if (!session || session.isComplete || session.email !== email.trim().toLowerCase()) {
    return null;
  }
  return session;
}

/**
 * Update the current step in the session
 */
export function updateSessionStep(step: SetupSession['currentStep']): void {
  const session = loadSetupSession();
  if (session) {
    session.currentStep = step;
    saveSetupSession(session);
  }
}

/**
 * Update step data in the session
 */
export function updateSessionStepData<K extends keyof SetupSession['stepData']>(
  key: K,
  data: SetupSession['stepData'][K]
): void {
  const session = loadSetupSession();
  if (session) {
    session.stepData = {
      ...session.stepData,
      [key]: data,
    };
    saveSetupSession(session);
  }
}

/**
 * Mark session as complete (will be deleted after final submission succeeds)
 */
export function markSessionComplete(): void {
  const session = loadSetupSession();
  if (session) {
    session.isComplete = true;
    saveSetupSession(session);
  }
}

/**
 * Mark email as verified in the session
 */
export function markEmailVerified(): void {
  const session = loadSetupSession();
  if (session) {
    session.emailVerified = true;
    saveSetupSession(session);
  }
}

/**
 * Update email in session (after registration, if needed)
 */
export function updateSessionEmail(email: string): void {
  const session = loadSetupSession();
  if (session) {
    session.email = email.trim().toLowerCase();
    saveSetupSession(session);
  }
}

/**
 * Update userId in session (after registration)
 */
export function updateSessionUserId(userId: number): void {
  const session = loadSetupSession();
  if (session) {
    session.userId = userId;
    saveSetupSession(session);
  }
}

/**
 * Update assigned bizcard serial in session
 */
export function updateSessionBizcardSerial(serial: string): void {
  const session = loadSetupSession();
  if (session) {
    session.assignedBizcardSerial = serial;
    saveSetupSession(session);
  }
}

/**
 * Clear the setup session from localStorage (call after successful account creation)
 */
export function clearSetupSession(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(SETUP_SESSION_KEY);
  } catch (error) {
    console.warn('[SessionStorage] Failed to clear setup session:', error);
  }
}

/**
 * Get all stored session data (for debugging or analytics)
 */
export function getSessionSummary(): { hasSession: boolean; email?: string; currentStep?: string; isComplete?: boolean } {
  const session = loadSetupSession();
  return {
    hasSession: Boolean(session),
    email: session?.email,
    currentStep: session?.currentStep,
    isComplete: session?.isComplete,
  };
}
