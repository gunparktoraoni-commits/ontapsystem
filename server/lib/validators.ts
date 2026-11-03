// ──────────────────────────────────────────────────────────────
// Server-Side Input Validators
// ──────────────────────────────────────────────────────────────
// WHY server-side validation is mandatory:
// - Client-side validation is a UX convenience, not a security control
// - Any HTTP client (curl, Postman, scripts) can bypass the frontend
// - All input from the network boundary is untrusted
//
// Sanitization approach:
// - Trim whitespace from string inputs
// - Normalize email to lowercase
// - Reject null bytes and control characters
// - Validate length limits to prevent payload abuse
// - Prisma parameterized queries prevent SQL injection by default
// ──────────────────────────────────────────────────────────────

import {
  ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_VIDEO_MIME_TYPES,
  validateMediaUrl,
} from "./media";
import { isOwnCloudinaryUrl } from "./cloudinary";
import { isOwnR2Url } from "./r2-storage";
import type { ContactLinkLabelMode } from "@/app/types";
import { sanitizeUrlAlias } from "@/lib/bizcard/url-alias-utils";
import { normalizeSocialUrlKey } from "@/lib/social-links";

function isAllowedServiceMediaUrl(url: string): boolean {
  if (isOwnR2Url(url)) return true;
  try {
    return isOwnCloudinaryUrl(url);
  } catch {
    return false;
  }
}

/**
 * Sanitize a string input: trim whitespace and reject control characters.
 * Control characters (except newline/tab) can be used for injection attacks.
 */
export function sanitizeString(input: unknown): string | null {
  if (typeof input !== "string") return null;
  // Remove null bytes and non-printable control characters (except \n \r \t)
  const cleaned = input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim();
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Validate and sanitize email input.
 */
export function sanitizeEmail(input: unknown): string | null {
  const raw = sanitizeString(input);
  if (!raw) return null;
  return raw.toLowerCase().trim();
}

/**
 * Validate login request body.
 * Returns { valid, errors, data } where data contains sanitized fields.
 */
export function validateLoginInput(body: Record<string, unknown>): {
  valid: boolean;
  errors: string[];
  data: { email: string; password: string; rememberMe: boolean };
} {
  const errors: string[] = [];

  const email = sanitizeEmail(body.email);
  if (!email) {
    errors.push("Email is required.");
  }

  const password = typeof body.password === "string" ? body.password : null;
  if (!password) {
    errors.push("Password is required.");
  }

  const rememberMe = body.rememberMe === true;

  return {
    valid: errors.length === 0,
    errors,
    data: {
      email: email ?? "",
      password: password ?? "",
      rememberMe,
    },
  };
}

/**
 * Validate registration request body.
 *
 * Supports two registration types:
 *   - "individual": standard user account (role assigned server-side as "user")
 *   - "company":    creates a company account (role assigned server-side as "company_admin")
 *                   requires an additional `companyName` field
 *
 * Security notes:
 * - `role` is intentionally NOT accepted from the client — it is derived server-side
 *   from `registrationType` to prevent privilege escalation.
 * - `companyName` is only validated when `registrationType === "company"`.
 * - `middleName` and `contact` are optional for both types.
 */
export function validateRegisterInput(body: Record<string, unknown>): {
  valid: boolean;
  errors: string[];
  data: {
    registrationType: "individual" | "company";
    email: string;
    password: string;
    confirmPassword: string;
    firstName: string;
    lastName: string;
    middleName: string | null;
    contact: string | null;
    companyName: string | null;
    promotionalEmailOptIn: boolean;
  };
} {
  const errors: string[] = [];

  // Registration type — default to "individual" if omitted or unrecognised
  const rawType = sanitizeString(body.registrationType);
  const allowedTypes = ["individual", "company"] as const;
  const registrationType: "individual" | "company" =
    rawType && (allowedTypes as readonly string[]).includes(rawType)
      ? (rawType as "individual" | "company")
      : "individual";

  const email = sanitizeEmail(body.email);
  if (!email) errors.push("Email is required.");

  const password = typeof body.password === "string" ? body.password : null;
  if (!password) errors.push("Password is required.");

  const confirmPassword =
    typeof body.confirmPassword === "string" ? body.confirmPassword : null;
  if (!confirmPassword) errors.push("Confirm password is required.");

  const firstName = sanitizeString(body.firstName);
  if (!firstName) errors.push("First name is required.");
  if (firstName && firstName.length > 100)
    errors.push("First name must not exceed 100 characters.");

  const lastName = sanitizeString(body.lastName);
  if (!lastName) errors.push("Last name is required.");
  if (lastName && lastName.length > 100)
    errors.push("Last name must not exceed 100 characters.");

  // Optional for both registration types
  const middleName = sanitizeString(body.middleName);
  if (middleName && middleName.length > 100)
    errors.push("Middle name must not exceed 100 characters.");

  const contact = sanitizeString(body.contact);
  if (contact && contact.length > 20)
    errors.push("Contact must not exceed 20 characters.");

  // Company name — required only when registrationType === "company"
  const companyName = sanitizeString(body.companyName);
  if (registrationType === "company") {
    if (!companyName) errors.push("Company name is required.");
    if (companyName && companyName.length > 255)
      errors.push("Company name must not exceed 255 characters.");
  }

  const promotionalEmailOptIn = body.promotionalEmailOptIn === true;

  return {
    valid: errors.length === 0,
    errors,
    data: {
      registrationType,
      email: email ?? "",
      password: password ?? "",
      confirmPassword: confirmPassword ?? "",
      firstName: firstName ?? "",
      lastName: lastName ?? "",
      middleName: middleName ?? null,
      contact: contact ?? null,
      companyName: companyName ?? null,
      promotionalEmailOptIn,
    },
  };
}

/**
 * Validate forgot-password request body.
 */
export function validateForgotPasswordInput(body: Record<string, unknown>): {
  valid: boolean;
  errors: string[];
  data: { email: string };
} {
  const errors: string[] = [];

  const email = sanitizeEmail(body.email);
  if (!email) errors.push("Email is required.");

  return {
    valid: errors.length === 0,
    errors,
    data: { email: email ?? "" },
  };
}

/**
 * Validate verify-code request body.
 */
export function validateVerifyCodeInput(body: Record<string, unknown>): {
  valid: boolean;
  errors: string[];
  data: { userId: number; code: string };
} {
  const errors: string[] = [];

  const rawUserId = Number(body.userId);
  if (!body.userId || isNaN(rawUserId) || rawUserId <= 0) {
    errors.push("Valid user ID is required.");
  }

  const code = sanitizeString(body.code);
  if (!code || code.length !== 6) {
    errors.push("Verification code must be exactly 6 characters.");
  }

  return {
    valid: errors.length === 0,
    errors,
    data: { userId: rawUserId, code: code ?? "" },
  };
}

/**
 * Validate reset-password request body.
 */
export function validateResetPasswordInput(body: Record<string, unknown>): {
  valid: boolean;
  errors: string[];
  data: { userId: number; password: string; confirmPassword: string };
} {
  const errors: string[] = [];

  const rawUserId = Number(body.userId);
  if (!body.userId || isNaN(rawUserId) || rawUserId <= 0) {
    errors.push("Valid user ID is required.");
  }

  const password = typeof body.password === "string" ? body.password : null;
  if (!password) errors.push("Password is required.");

  const confirmPassword =
    typeof body.confirmPassword === "string" ? body.confirmPassword : null;
  if (!confirmPassword) errors.push("Confirm password is required.");

  return {
    valid: errors.length === 0,
    errors,
    data: {
      userId: rawUserId,
      password: password ?? "",
      confirmPassword: confirmPassword ?? "",
    },
  };
}

// ──────────────────────────────────────────────────────────────
// Email OTP Verification Validators
// ──────────────────────────────────────────────────────────────

/**
 * Validate verify-email-otp request body.
 * OTP is 6 characters, case-sensitive (mixed case + specials).
 */
export function validateVerifyEmailOtpInput(body: Record<string, unknown>): {
  valid: boolean;
  errors: string[];
  data: { userId: number; otp: string };
} {
  const errors: string[] = [];

  const rawUserId = Number(body.userId);
  if (
    !body.userId ||
    isNaN(rawUserId) ||
    rawUserId <= 0 ||
    !Number.isInteger(rawUserId)
  ) {
    errors.push("Valid user ID is required.");
  }

  // OTP: exactly 6 chars, no sanitization that would strip specials
  const otp = typeof body.otp === "string" ? body.otp.trim() : null;
  if (!otp) {
    errors.push("OTP is required.");
  } else if (otp.length !== 6) {
    errors.push("OTP must be exactly 6 characters.");
  } else if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(otp)) {
    // Reject control characters but allow special characters
    errors.push("OTP contains invalid characters.");
  }

  return {
    valid: errors.length === 0,
    errors,
    data: {
      userId: isNaN(rawUserId) ? 0 : rawUserId,
      otp: otp ?? "",
    },
  };
}

/**
 * Validate resend-otp request body.
 */
export function validateResendOtpInput(body: Record<string, unknown>): {
  valid: boolean;
  errors: string[];
  data: { userId: number };
} {
  const errors: string[] = [];

  const rawUserId = Number(body.userId);
  if (
    !body.userId ||
    isNaN(rawUserId) ||
    rawUserId <= 0 ||
    !Number.isInteger(rawUserId)
  ) {
    errors.push("Valid user ID is required.");
  }

  return {
    valid: errors.length === 0,
    errors,
    data: { userId: isNaN(rawUserId) ? 0 : rawUserId },
  };
}

// ──────────────────────────────────────────────────────────────
// Employee Card Validators
// ──────────────────────────────────────────────────────────────

// Serial IDs are extracted from QR/NFC URLs: taptap.com/<serialId>
// Accepted charset: uppercase letters, lowercase letters, digits,
// hyphens and underscores (URL-safe, no ambiguous characters).
// Length: 4–64 characters (accommodates various card manufacturers).
const SERIAL_ID_REGEX = /^[A-Za-z0-9_-]{4,64}$/;

// Maximum number of serial IDs accepted in a single batch-assign request.
// Keeps individual DB transactions manageable and prevents abuse.
const MAX_BATCH_SIZE = 100;

/**
 * Validate a single card-scan request body.
 * Used by POST /api/cards/scan.
 */
export function validateCardScanInput(body: Record<string, unknown>): {
  valid: boolean;
  errors: string[];
  data: { serialId: string };
} {
  const errors: string[] = [];

  const raw = sanitizeString(body.serialId);
  if (!raw) {
    errors.push("serialId is required.");
  } else if (!SERIAL_ID_REGEX.test(raw)) {
    // Generic message — don't leak the accepted format to potential attackers
    errors.push("Invalid serial ID format.");
  }

  return {
    valid: errors.length === 0,
    errors,
    data: { serialId: raw ?? "" },
  };
}

/**
 * Validate a bulk card-assign request body.
 * Used by POST /api/cards/assign.
 *
 * Accepts an array of serial IDs. Duplicates within the batch are
 * silently de-duplicated server-side to keep the response predictable.
 */
export function validateCardAssignInput(body: Record<string, unknown>): {
  valid: boolean;
  errors: string[];
  data: { serialIds: string[] };
} {
  const errors: string[] = [];

  if (!Array.isArray(body.serialIds)) {
    errors.push("serialIds must be an array.");
    return { valid: false, errors, data: { serialIds: [] } };
  }

  if (body.serialIds.length === 0) {
    errors.push("serialIds must contain at least one entry.");
  }

  if (body.serialIds.length > MAX_BATCH_SIZE) {
    errors.push(
      `A maximum of ${MAX_BATCH_SIZE} serial IDs may be submitted at once.`,
    );
  }

  // Validate each individual ID — collect all bad ones so the client can fix them all at once
  const invalid: string[] = [];
  const seen = new Set<string>();
  const valid: string[] = [];

  for (const item of body.serialIds) {
    const raw = sanitizeString(item);
    if (!raw || !SERIAL_ID_REGEX.test(raw)) {
      invalid.push(String(item).substring(0, 100));
      continue;
    }
    // De-duplicate within the batch
    if (!seen.has(raw)) {
      seen.add(raw);
      valid.push(raw);
    }
  }

  if (invalid.length > 0) {
    errors.push(`The following serial IDs are invalid: ${invalid.join(", ")}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    data: { serialIds: valid },
  };
}

// ──────────────────────────────────────────────────────────────
// BizCard Merge / Linking Validators
// ──────────────────────────────────────────────────────────────

/**
 * Validate the body of POST /api/cards/merge.
 * An authenticated individual user links a blank BizCard to their vCard.
 */
export function validateCardMergeInput(body: Record<string, unknown>): {
  valid: boolean;
  errors: string[];
  data: { serialId: string };
} {
  const errors: string[] = [];
  const raw = sanitizeString(body.serialId);

  if (!raw) {
    errors.push("serialId is required.");
  } else if (!SERIAL_ID_REGEX.test(raw)) {
    errors.push("Invalid serial ID format.");
  }

  return {
    valid: errors.length === 0,
    errors,
    data: { serialId: raw ?? "" },
  };
}

/**
 * Validate the body of POST /api/cards/link-employee.
 * A company admin links a claimed card to a specific employee (by userId).
 */
export function validateCardLinkEmployeeInput(body: Record<string, unknown>): {
  valid: boolean;
  errors: string[];
  data: { serialId: string; userId: number };
} {
  const errors: string[] = [];

  const rawSerial = sanitizeString(body.serialId);
  if (!rawSerial) {
    errors.push("serialId is required.");
  } else if (!SERIAL_ID_REGEX.test(rawSerial)) {
    errors.push("Invalid serial ID format.");
  }

  const rawUserId = body.userId;
  const userId =
    typeof rawUserId === "number"
      ? rawUserId
      : typeof rawUserId === "string"
        ? parseInt(rawUserId, 10)
        : NaN;

  if (!Number.isFinite(userId) || userId <= 0) {
    errors.push("userId must be a positive integer.");
  }

  return {
    valid: errors.length === 0,
    errors,
    data: { serialId: rawSerial ?? "", userId: userId || 0 },
  };
}

// Allowed activation_status values that a user/admin may set via the API.
// "revoked" is intentionally excluded — that is a platform/admin action only.
const SETTABLE_STATUSES = ["active", "inactive"] as const;
type SettableStatus = (typeof SETTABLE_STATUSES)[number];

/**
 * Validate the body of PATCH /api/cards/[cardId].
 * Only activationStatus may be changed via this endpoint; serial_id is immutable.
 */
export function validateCardStatusUpdateInput(body: Record<string, unknown>): {
  valid: boolean;
  errors: string[];
  data: { activationStatus: SettableStatus };
} {
  const errors: string[] = [];

  const status = body.activationStatus;
  if (
    typeof status !== "string" ||
    !(SETTABLE_STATUSES as readonly string[]).includes(status)
  ) {
    errors.push(
      `activationStatus must be one of: ${SETTABLE_STATUSES.join(", ")}.`,
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    data: { activationStatus: (status as SettableStatus) ?? "active" },
  };
}

// ──────────────────────────────────────────────────────────────
// Portfolio Interaction Validators
// ──────────────────────────────────────────────────────────────

// Allowed values for save_type in ContactSave
const ALLOWED_SAVE_TYPES = ["vcf", "phone"] as const;
type SaveType = (typeof ALLOWED_SAVE_TYPES)[number];

// Allowed values for relationship_type in Connection
const ALLOWED_RELATIONSHIP_TYPES = ["friend", "associate"] as const;
type RelationshipType = (typeof ALLOWED_RELATIONSHIP_TYPES)[number];

// Allowed values for action in connection response
const ALLOWED_CONNECTION_ACTIONS = ["accept", "decline", "block"] as const;
type ConnectionAction = (typeof ALLOWED_CONNECTION_ACTIONS)[number];

// Session ID: UUID v4 format, or any alphanumeric + hyphens (64 chars max)
// The frontend should generate a UUID v4 and persist it in localStorage.
const SESSION_ID_REGEX = /^[a-zA-Z0-9_-]{8,128}$/;

/**
 * Validate the body of POST /api/portfolio/[uri]/view.
 * Records an anonymous or authenticated page visit.
 * All fields are optional — the endpoint degrades gracefully without them.
 */
export function validatePortfolioViewInput(body: Record<string, unknown>): {
  valid: boolean;
  errors: string[];
  data: {
    sessionId: string | null;
    deviceType: string | null;
    browser: string | null;
    os: string | null;
    referrer: string | null;
  };
} {
  const errors: string[] = [];

  // sessionId — optional but validated if present
  const rawSession = sanitizeString(body.sessionId);
  const sessionId =
    rawSession && SESSION_ID_REGEX.test(rawSession) ? rawSession : null;

  // deviceType — optional, truncated to 50 chars
  const rawDevice = sanitizeString(body.deviceType);
  const deviceType = rawDevice ? rawDevice.substring(0, 50) : null;

  // browser — optional, truncated to 100 chars
  const rawBrowser = sanitizeString(body.browser);
  const browser = rawBrowser ? rawBrowser.substring(0, 100) : null;

  // os — optional, truncated to 100 chars
  const rawOs = sanitizeString(body.os);
  const os = rawOs ? rawOs.substring(0, 100) : null;

  // referrer — optional, truncated to 512 chars (URL length)
  const rawReferrer = sanitizeString(body.referrer);
  const referrer = rawReferrer ? rawReferrer.substring(0, 512) : null;

  return {
    valid: errors.length === 0,
    errors,
    data: { sessionId, deviceType, browser, os, referrer },
  };
}

/**
 * Validate the body of POST /api/portfolio/[uri]/save-contact.
 * Records when a visitor saves or downloads the portfolio owner's contact.
 */
export function validateContactSaveInput(body: Record<string, unknown>): {
  valid: boolean;
  errors: string[];
  data: {
    sessionId: string | null;
    saveType: SaveType;
    deviceType: string | null;
    browser: string | null;
    os: string | null;
    referrer: string | null;
  };
} {
  const errors: string[] = [];

  const rawSession = sanitizeString(body.sessionId);
  const sessionId =
    rawSession && SESSION_ID_REGEX.test(rawSession) ? rawSession : null;

  const rawSaveType = sanitizeString(body.saveType);
  const saveType: SaveType =
    rawSaveType &&
    (ALLOWED_SAVE_TYPES as readonly string[]).includes(rawSaveType)
      ? (rawSaveType as SaveType)
      : "vcf"; // default to vcf download

  const rawDevice = sanitizeString(body.deviceType);
  const deviceType = rawDevice ? rawDevice.substring(0, 50) : null;

  const rawBrowser = sanitizeString(body.browser);
  const browser = rawBrowser ? rawBrowser.substring(0, 100) : null;

  const rawOs = sanitizeString(body.os);
  const os = rawOs ? rawOs.substring(0, 100) : null;

  const rawReferrer = sanitizeString(body.referrer);
  const referrer = rawReferrer ? rawReferrer.substring(0, 512) : null;

  return {
    valid: errors.length === 0,
    errors,
    data: { sessionId, saveType, deviceType, browser, os, referrer },
  };
}

/**
 * Validate the body of POST /api/portfolio/[uri]/connect.
 * Authenticated user sends a friend/associate connection request.
 */
export function validateConnectionRequestInput(body: Record<string, unknown>): {
  valid: boolean;
  errors: string[];
  data: { relationshipType: RelationshipType };
} {
  const errors: string[] = [];

  const rawType = sanitizeString(body.relationshipType);
  const relationshipType: RelationshipType =
    rawType &&
    (ALLOWED_RELATIONSHIP_TYPES as readonly string[]).includes(rawType)
      ? (rawType as RelationshipType)
      : "friend"; // default to friend if omitted or invalid

  return {
    valid: errors.length === 0,
    errors,
    data: { relationshipType },
  };
}

/**
 * Validate the body of PATCH /api/connections/[id].
 * Authenticated recipient responds to a pending connection request.
 */
export function validateConnectionRespondInput(body: Record<string, unknown>): {
  valid: boolean;
  errors: string[];
  data: { action: ConnectionAction };
} {
  const errors: string[] = [];

  const rawAction = body.action;
  if (
    typeof rawAction !== "string" ||
    !(ALLOWED_CONNECTION_ACTIONS as readonly string[]).includes(rawAction)
  ) {
    errors.push(
      `action must be one of: ${ALLOWED_CONNECTION_ACTIONS.join(", ")}.`,
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    data: { action: (rawAction as ConnectionAction) ?? "decline" },
  };
}

/**
 * Validate the body of POST /api/portfolio/[uri]/inquire.
 * Public (optionally authenticated) contact form submission.
 *
 * Security notes:
 * - message is stripped of HTML tags to prevent XSS via stored inquiry display
 * - email format is validated but not verified (visitors may use any email)
 * - subject and phone are optional
 * - All string fields are truncated to their DB column limits
 */
export function validateInquiryInput(body: Record<string, unknown>): {
  valid: boolean;
  errors: string[];
  data: {
    name: string;
    email: string;
    message: string;
    subject: string | null;
    phone: string | null;
  };
} {
  const errors: string[] = [];

  // name — required, max 255 chars
  const name = sanitizeString(body.name);
  if (!name) {
    errors.push("Name is required.");
  } else if (name.length > 255) {
    errors.push("Name must not exceed 255 characters.");
  }

  // email — required, basic format check, max 191 chars
  const rawEmail = sanitizeEmail(body.email);
  if (!rawEmail) {
    errors.push("Email is required.");
  } else if (rawEmail.length > 191) {
    errors.push("Email must not exceed 191 characters.");
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
    errors.push("A valid email address is required.");
  }

  // message — required, min 10 chars, max 5000 chars
  // Strip basic HTML tags to prevent stored XSS when the inquiry is displayed
  const rawMessage = sanitizeString(body.message);
  const cleanMessage = rawMessage
    ? rawMessage.replace(/<[^>]*>/g, "").substring(0, 5000)
    : null;
  if (!cleanMessage) {
    errors.push("Message is required.");
  } else if (cleanMessage.length < 10) {
    errors.push("Message must be at least 10 characters.");
  }

  // subject — optional, max 255 chars
  const rawSubject = sanitizeString(body.subject);
  const subject = rawSubject ? rawSubject.substring(0, 255) : null;

  // phone — optional, max 50 chars, basic digits only
  const rawPhone = sanitizeString(body.phone);
  const phone =
    rawPhone && /^[\d\s\+\-\(\)\.]{5,50}$/.test(rawPhone)
      ? rawPhone.substring(0, 50)
      : null;

  return {
    valid: errors.length === 0,
    errors,
    data: {
      name: name ?? "",
      email: rawEmail ?? "",
      message: cleanMessage ?? "",
      subject,
      phone,
    },
  };
}

/** Allowed topic values for the public marketing-site contact form. */
export const LANDING_CONTACT_TOPICS = [
  "General Inquiry",
  "Partnership Opportunities",
  "Account Concerns",
  "Customer Support",
  "Order and Billing",
] as const;

export type LandingContactTopic = (typeof LANDING_CONTACT_TOPICS)[number];

/**
 * Validate POST /api/contact (landing-page "Send Us A Message" form).
 *
 * Security notes:
 * - Topic must match an allowlist (blocks free-text subject injection)
 * - Message HTML is stripped to prevent XSS if stored/displayed later
 * - Phone digits-only length check; rejects oversized payloads early
 * - Honeypot field (`website`) must be empty when present (bot trap)
 * - newsletter is coerced to boolean only
 */
export function validateLandingContactInput(body: Record<string, unknown>): {
  valid: boolean;
  errors: string[];
  data: {
    fullName: string;
    email: string;
    contactNumber: string;
    message: string;
    topic: LandingContactTopic;
    newsletter: boolean;
  };
  isBot: boolean;
} {
  const errors: string[] = [];

  // Honeypot — bots often fill hidden "website" fields; treat as success silently upstream.
  const honeypot = sanitizeString(body.website);
  if (honeypot) {
    return {
      valid: false,
      errors: [],
      isBot: true,
      data: {
        fullName: "",
        email: "",
        contactNumber: "",
        message: "",
        topic: LANDING_CONTACT_TOPICS[0],
        newsletter: false,
      },
    };
  }

  const fullName = sanitizeString(body.fullName ?? body.name);
  if (!fullName) {
    errors.push("Full name is required.");
  } else if (fullName.length < 2) {
    errors.push("Full name must be at least 2 characters.");
  } else if (fullName.length > 100) {
    errors.push("Full name must not exceed 100 characters.");
  } else if (!/^[\p{L}\p{M}\s.'-]+$/u.test(fullName)) {
    errors.push("Full name contains invalid characters.");
  }

  const rawEmail = sanitizeEmail(body.email);
  if (!rawEmail) {
    errors.push("Email is required.");
  } else if (rawEmail.length > 191) {
    errors.push("Email must not exceed 191 characters.");
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(rawEmail)) {
    errors.push("A valid email address is required.");
  }

  const rawPhone = sanitizeString(body.contactNumber ?? body.phone);
  const phoneDigits = rawPhone ? rawPhone.replace(/\D/g, "") : "";
  if (!rawPhone) {
    errors.push("Contact number is required.");
  } else if (phoneDigits.length < 10 || phoneDigits.length > 15) {
    errors.push("Contact number must be 10–15 digits.");
  }

  const rawTopic = sanitizeString(body.topic ?? body.subject);
  const topic = LANDING_CONTACT_TOPICS.find((t) => t === rawTopic);
  if (!topic) {
    errors.push("Please select a valid topic.");
  }

  const rawMessage = sanitizeString(body.message);
  const cleanMessage = rawMessage
    ? rawMessage.replace(/<[^>]*>/g, "").substring(0, 5000)
    : null;
  if (!cleanMessage) {
    errors.push("Message is required.");
  } else if (cleanMessage.length < 10) {
    errors.push("Message must be at least 10 characters.");
  } else if (cleanMessage.length > 2000) {
    errors.push("Message must not exceed 2000 characters.");
  }

  const newsletter = body.newsletter === true || body.newsletter === "true" || body.newsletter === 1;

  return {
    valid: errors.length === 0,
    errors,
    isBot: false,
    data: {
      fullName: fullName ?? "",
      email: rawEmail ?? "",
      contactNumber: phoneDigits.slice(0, 15),
      message: cleanMessage ?? "",
      topic: topic ?? LANDING_CONTACT_TOPICS[0],
      newsletter,
    },
  };
}

const ALLOWED_SEVERITIES = ["low", "medium", "high", "critical"] as const;
const MAX_MESSAGE_LEN = 2000;
const MAX_STACK_LEN = 10000;
const MAX_URL_LEN = 2048;
const MAX_FILE_LEN = 500;

export interface ErrorLogInput {
  errorMessage: string;
  stackTrace: string | null;
  fileName: string | null;
  lineNumber: number | null;
  colNumber: number | null;
  browserInfo: string | null;
  deviceInfo: string | null;
  pageUrl: string | null;
  severity: "low" | "medium" | "high" | "critical";
  sessionId: string | null;
}

/**
 * Validate and sanitize an incoming client error log payload.
 *
 * Security notes:
 * - All string fields are truncated to their column size limits
 * - Control characters are stripped to prevent log injection
 * - Numeric fields are validated as integers
 * - severity is validated against an allow-list
 */
export function validateErrorLogInput(body: Record<string, unknown>): {
  valid: boolean;
  errors: string[];
  data: ErrorLogInput;
} {
  const errors: string[] = [];

  // errorMessage — required
  const rawMessage = sanitizeString(body.errorMessage);
  if (!rawMessage) {
    errors.push("errorMessage is required.");
  }
  const errorMessage = (rawMessage ?? "").substring(0, MAX_MESSAGE_LEN);

  // stackTrace — optional
  const rawStack =
    typeof body.stackTrace === "string"
      ? body.stackTrace
          .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
          .substring(0, MAX_STACK_LEN)
      : null;

  // fileName — optional
  const rawFile = sanitizeString(body.fileName);
  const fileName = rawFile ? rawFile.substring(0, MAX_FILE_LEN) : null;

  // lineNumber — optional integer
  const rawLine = body.lineNumber;
  const lineNumber =
    typeof rawLine === "number" && Number.isInteger(rawLine) && rawLine >= 0
      ? rawLine
      : null;

  // colNumber — optional integer
  const rawCol = body.colNumber;
  const colNumber =
    typeof rawCol === "number" && Number.isInteger(rawCol) && rawCol >= 0
      ? rawCol
      : null;

  // browserInfo — optional
  const rawBrowser = sanitizeString(body.browserInfo);
  const browserInfo = rawBrowser ? rawBrowser.substring(0, 512) : null;

  // deviceInfo — optional
  const rawDevice = sanitizeString(body.deviceInfo);
  const deviceInfo = rawDevice ? rawDevice.substring(0, 255) : null;

  // pageUrl — optional; strip control chars, validate length
  const rawUrl = sanitizeString(body.pageUrl);
  const pageUrl = rawUrl ? rawUrl.substring(0, MAX_URL_LEN) : null;

  // severity — required, allow-list validated
  const rawSeverity = sanitizeString(body.severity);
  const severity = (ALLOWED_SEVERITIES as readonly string[]).includes(
    rawSeverity ?? "",
  )
    ? (rawSeverity as "low" | "medium" | "high" | "critical")
    : null;
  if (!severity) {
    errors.push(`severity must be one of: ${ALLOWED_SEVERITIES.join(", ")}.`);
  }

  // sessionId — optional, max 255 chars
  const rawSession = sanitizeString(body.sessionId);
  const sessionId = rawSession ? rawSession.substring(0, 255) : null;

  return {
    valid: errors.length === 0,
    errors,
    data: {
      errorMessage,
      stackTrace: rawStack,
      fileName,
      lineNumber,
      colNumber,
      browserInfo,
      deviceInfo,
      pageUrl,
      severity: severity ?? "low",
      sessionId,
    },
  };
}

// ──────────────────────────────────────────────────────────────
// vCard Validators
// ──────────────────────────────────────────────────────────────

// Social platform allow-list — prevents arbitrary strings being stored
// as platform names which could confuse consumers or enable spoofing.
const ALLOWED_PLATFORMS = [
  "facebook",
  "twitter",
  "instagram",
  "linkedin",
  "youtube",
  "tiktok",
  "github",
  "gitlab",
  "behance",
  "dribbble",
  "medium",
  "substack",
  "notion",
  "calendly",
  "wellfound",
  "googlescholar",
  "researchgate",
  "orcid",
  "slack",
  "website",
  "whatsapp",
  "telegram",
  "viber",
  "discord",
  "threads",
  "bluesky",
  "snapchat",
  "pinterest",
  "reddit",
  "twitch",
  "spotify",
  "other",
] as const;

export type SocialPlatform = (typeof ALLOWED_PLATFORMS)[number];

/**
 * Very lightweight URL format check.
 * We do NOT use a full URL parser here — the goal is to ensure the stored
 * value at least starts with http/https so downstream renderers can use it
 * safely as an anchor href. Full URL parsing would reject legitimate
 * platform-custom-scheme deep-links.
 */
function isValidUrl(value: string): boolean {
  return /^https?:\/\/.{3,}/i.test(value);
}

/** Prefix bare host/path URLs with https:// before validation. */
function normalizeHttpUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "#") return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed.replace(/^\/\//, "")}`;
}

/** Strip whitespace from phone numbers so length checks match DB columns. */
function normalizeContactNumber(raw: string): string {
  return raw.replace(/\s+/g, "");
}

const SOCIAL_PLATFORM_ALIASES: Record<string, SocialPlatform> = {
  linkedin: "linkedin",
  facebook: "facebook",
  fb: "facebook",
  instagram: "instagram",
  ig: "instagram",
  instagram_page: "instagram",
  youtube: "youtube",
  yt: "youtube",
  twitter: "twitter",
  "x / twitter": "twitter",
  x: "twitter",
  xtwitter: "twitter",
  tiktok: "tiktok",
  website: "website",
  web: "website",
  site: "website",
  github: "github",
  gh: "github",
  gitlab: "gitlab",
  behance: "behance",
  dribbble: "dribbble",
  medium: "medium",
  substack: "substack",
  notion: "notion",
  calendly: "calendly",
  wellfound: "wellfound",
  angellist: "wellfound",
  angel: "wellfound",
  googlescholar: "googlescholar",
  "google scholar": "googlescholar",
  google_scholar: "googlescholar",
  scholar: "googlescholar",
  researchgate: "researchgate",
  orcid: "orcid",
  slack: "slack",
  whatsapp: "whatsapp",
  telegram: "telegram",
  viber: "viber",
  discord: "discord",
  threads: "threads",
  bluesky: "bluesky",
  bsky: "bluesky",
  snapchat: "snapchat",
  pinterest: "pinterest",
  reddit: "reddit",
  twitch: "twitch",
  spotify: "spotify",
  other: "other",
  // Legacy theme / migrated contact-style platforms → other
  email: "other",
  phone: "other",
};

/**
 * Resolve a platform string to an allow-listed slug.
 * Unknown / legacy values coerce to `"other"` so migrated users can save
 * existing social rows without a hard validation failure.
 * Empty/missing platform still returns null (caller treats as required).
 */
function resolveSocialPlatform(raw: string | null): SocialPlatform | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  if (!key) return null;
  return SOCIAL_PLATFORM_ALIASES[key] ?? "other";
}

// ── Social link ────────────────────────────────────────────────

export interface SocialInput {
  platform: SocialPlatform;
  url: string;
  displayOrder: number;
  isVisible: boolean;
}

/**
 * Validate a single social-link entry submitted in a vCard setup/update payload.
 * Returns a per-item error array alongside the sanitized data so the caller can
 * attribute errors back to specific list positions in the response.
 */
export function validateSocialInput(item: Record<string, unknown>): {
  valid: boolean;
  errors: string[];
  data: SocialInput;
} {
  const errors: string[] = [];

  // platform — required; known aliases map to allow-list; unknown legacy
  // values coerce to "other" (migration-tolerant). Empty platform is invalid.
  const rawPlatform = sanitizeString(item.platform);
  const platform = resolveSocialPlatform(rawPlatform);
  if (!platform) {
    errors.push("platform is required.");
  }

  // url — required, http(s) only (bare domains are prefixed with https://)
  const rawUrl = sanitizeString(item.url);
  const normalizedUrl = rawUrl ? normalizeHttpUrl(rawUrl) : "";
  if (!normalizedUrl) {
    errors.push("url is required.");
  } else if (normalizedUrl.length > 512) {
    errors.push("url must not exceed 512 characters.");
  } else if (!isValidUrl(normalizedUrl)) {
    errors.push("url must start with http:// or https://.");
  }
  const url =
    normalizedUrl && isValidUrl(normalizedUrl)
      ? normalizedUrl.substring(0, 512)
      : "";

  // displayOrder — optional, defaults to 0
  const rawOrder = Number(item.displayOrder ?? 0);
  const displayOrder =
    Number.isInteger(rawOrder) && rawOrder >= 0 ? rawOrder : 0;

  // isVisible — optional, defaults to true
  const isVisible = item.isVisible !== false;

  return {
    valid: errors.length === 0,
    errors,
    data: { platform: platform ?? "other", url, displayOrder, isVisible },
  };
}

// ── Service ────────────────────────────────────────────────────

export interface ServiceInput {
  name: string;
  description: string;
  tagline: string | null;
  serviceUrl: string | null;
  featured_image: string | null;
  displayOrder: number;
  isVisible: boolean;
  media: ServiceMediaInput[];
}

export interface ServiceMediaInput {
  url: string;
  mimeType: string;
  fileName: string | null;
  displayOrder: number;
  bytes: number | null;
}

function validateServiceMediaInput(
  item: Record<string, unknown>,
  index: number,
): {
  valid: boolean;
  errors: string[];
  data: ServiceMediaInput;
} {
  const errors: string[] = [];

  const rawUrl = sanitizeString(item.url ?? item.file_url);
  if (!rawUrl) {
    errors.push(`media[${index}].url is required.`);
  } else {
    const urlValidation = validateMediaUrl(rawUrl, `media[${index}].url`);
    if (!urlValidation.valid) {
      errors.push(urlValidation.error);
    } else if (!isAllowedServiceMediaUrl(rawUrl)) {
      errors.push(
        `media[${index}].url must belong to this application's media storage (R2 or Cloudinary).`,
      );
    }
  }

  const rawMimeType = sanitizeString(item.mimeType ?? item.mime_type);
  const mimeType = rawMimeType?.toLowerCase() ?? "";
  if (!mimeType) {
    errors.push(`media[${index}].mimeType is required.`);
  } else if (
    !ALLOWED_IMAGE_MIME_TYPES.has(mimeType) &&
    !ALLOWED_VIDEO_MIME_TYPES.has(mimeType)
  ) {
    errors.push(`media[${index}].mimeType is not supported.`);
  }

  const rawFileName = sanitizeString(item.fileName ?? item.file_name);
  if (rawFileName && rawFileName.length > 255) {
    errors.push(`media[${index}].fileName must not exceed 255 characters.`);
  }

  const rawDisplayOrder = Number(
    item.displayOrder ?? item.display_order ?? index,
  );
  const displayOrder =
    Number.isInteger(rawDisplayOrder) && rawDisplayOrder >= 0
      ? rawDisplayOrder
      : index;

  let bytes: number | null = null;
  if (item.bytes !== undefined && item.bytes !== null && item.bytes !== "") {
    const parsedBytes =
      typeof item.bytes === "number" ? item.bytes : Number(item.bytes);
    if (!Number.isInteger(parsedBytes) || parsedBytes < 0) {
      errors.push(
        `media[${index}].bytes must be a non-negative integer when provided.`,
      );
    } else {
      bytes = parsedBytes;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    data: {
      url: rawUrl ?? "",
      mimeType,
      fileName: rawFileName ?? null,
      displayOrder,
      bytes,
    },
  };
}

function parseServiceMediaList(
  raw: unknown,
  fieldName = "media",
): {
  value: ServiceMediaInput[];
  errors: string[];
} {
  if (raw === undefined) {
    return { value: [], errors: [] };
  }

  if (!Array.isArray(raw)) {
    return {
      value: [],
      errors: [`${fieldName} must be an array when provided.`],
    };
  }

  if (raw.length > 20) {
    return {
      value: [],
      errors: [`${fieldName} must not contain more than 20 items.`],
    };
  }

  const items: ServiceMediaInput[] = [];
  const errors: string[] = [];
  const seenUrls = new Set<string>();

  for (let index = 0; index < raw.length; index++) {
    const item = raw[index];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`${fieldName}[${index}] must be an object.`);
      continue;
    }

    const validated = validateServiceMediaInput(
      item as Record<string, unknown>,
      index,
    );
    if (!validated.valid) {
      errors.push(...validated.errors);
      continue;
    }

    if (seenUrls.has(validated.data.url)) {
      errors.push(
        `${fieldName}[${index}].url must be unique within the service.`,
      );
      continue;
    }

    seenUrls.add(validated.data.url);
    items.push(validated.data);
  }

  return { value: items, errors };
}

/**
 * Validate a single service entry.
 */
export function validateServiceInput(item: Record<string, unknown>): {
  valid: boolean;
  errors: string[];
  data: ServiceInput;
} {
  const errors: string[] = [];

  const name = sanitizePlainPersonText(item.name);
  if (!name) {
    errors.push("Service name is required.");
  } else if (name.length > 255) {
    errors.push("Service name must not exceed 255 characters.");
  }

  // Description is optional; empty string is stored when omitted.
  const description = sanitizeRichAboutText(item.description) ?? "";
  if (description.length > RICH_SERVICE_DESCRIPTION_MAX_LENGTH) {
    errors.push(
      `Service description must not exceed ${RICH_SERVICE_DESCRIPTION_MAX_LENGTH} characters.`,
    );
  }

  const rawTagline = sanitizePlainPersonText(item.tagline);
  let tagline: string | null = null;
  if (rawTagline) {
    if (rawTagline.length > 255) {
      errors.push("Service tagline must not exceed 255 characters.");
    } else {
      tagline = rawTagline;
    }
  }

  const rawServiceUrl = sanitizeString(item.serviceUrl);
  let serviceUrl: string | null = null;
  if (rawServiceUrl) {
    const normalizedServiceUrl = normalizeHttpUrl(rawServiceUrl);
    if (normalizedServiceUrl.length > 512) {
      errors.push("serviceUrl must not exceed 512 characters.");
    } else if (!isValidUrl(normalizedServiceUrl)) {
      errors.push("serviceUrl must start with http:// or https://.");
    } else {
      serviceUrl = normalizedServiceUrl;
    }
  }

  const rawFeaturedImage = sanitizeString(
    item.featured_image ?? item.featuredImageUrl,
  );
  let featured_image: string | null = null;
  if (rawFeaturedImage) {
    const normalizedFeatured = normalizeHttpUrl(rawFeaturedImage);
    if (isValidUrl(normalizedFeatured)) {
      featured_image = normalizedFeatured.substring(0, 512);
    }
  }

  const rawOrder = Number(item.displayOrder ?? 0);
  const displayOrder =
    Number.isInteger(rawOrder) && rawOrder >= 0 ? rawOrder : 0;

  const isVisible = item.isVisible !== false;
  const parsedMedia = parseServiceMediaList(
    item.media,
    `services[${displayOrder}].media`,
  );
  if (parsedMedia.errors.length > 0) errors.push(...parsedMedia.errors);

  return {
    valid: errors.length === 0,
    errors,
    data: {
      name: name ?? "",
      description: description ?? "",
      tagline,
      serviceUrl,
      featured_image,
      displayOrder,
      isVisible,
      media: parsedMedia.value,
    },
  };
}

export interface BizcardServiceCreateInput {
  name: string;
  description: string;
  tagline: string | null;
  price: number | null;
  currency: string | null;
  serviceUrl: string | null;
  featured_image: string | null;
  featured: boolean;
  isVisible: boolean;
  isPriceNegotiable: boolean;
  status: "active" | "draft" | "archived";
  media: ServiceMediaInput[];
}

export interface BizcardServiceUpdateInput {
  name?: string;
  description?: string;
  tagline?: string | null;
  price?: number | null;
  currency?: string | null;
  serviceUrl?: string | null;
  featured_image?: string | null;
  featured?: boolean;
  isVisible?: boolean;
  isPriceNegotiable?: boolean;
  status?: "active" | "draft" | "archived";
  media?: ServiceMediaInput[];
}

const SERVICE_STATUS_VALUES = new Set(["active", "draft", "archived"] as const);
const CURRENCY_CODE_REGEX = /^[A-Z]{3}$/;

import { normalizeDisplayText } from "@/app/lib/plainText";
import { sanitizePortfolioRichHtml, isRichTextEmpty } from "@/app/lib/richText";

function sanitizePlainPersonText(input: unknown): string | null {
  const raw = sanitizeString(input);
  if (!raw) return null;
  const normalized = normalizeDisplayText(raw);
  return normalized.length > 0 ? normalized : null;
}

/**
 * About / bio / services details: preserve a safe subset of rich formatting
 * (bold/italic/underline + spaces + line breaks) rather than flattening to
 * plain text, so the portfolio renders exactly how the user arranged it.
 * Returns sanitized HTML, or null when there is no visible content.
 */
function sanitizeRichAboutText(input: unknown): string | null {
  const raw = sanitizeString(input);
  if (raw == null) return null;
  if (isRichTextEmpty(raw)) return null;
  const clean = sanitizePortfolioRichHtml(raw);
  return clean.length > 0 ? clean : null;
}

/** Max stored length for a rich About/Bio value (HTML tags included). */
const RICH_ABOUT_MAX_LENGTH = 5000;
/** Max stored length for a rich service description (HTML tags included). */
const RICH_SERVICE_DESCRIPTION_MAX_LENGTH = 2000;

function parseNullablePrice(raw: unknown): {
  value: number | null;
  error?: string;
} {
  if (raw === null || raw === undefined || raw === "") {
    return { value: null };
  }

  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(parsed)) {
    return { value: null, error: "price must be a valid number or null." };
  }
  if (parsed < 0) {
    return { value: null, error: "price must be a positive number or null." };
  }
  return { value: parsed };
}

function parseNullableCurrency(raw: unknown): {
  value: string | null;
  error?: string;
} {
  if (raw === null || raw === undefined || raw === "") {
    return { value: null };
  }

  const cleaned = sanitizeString(raw);
  if (!cleaned) {
    return { value: null };
  }

  const normalized = cleaned.toUpperCase();
  if (!CURRENCY_CODE_REGEX.test(normalized)) {
    return {
      value: null,
      error: "currency must be a 3-letter ISO code (e.g. USD).",
    };
  }

  return { value: normalized };
}

function parseServiceStatus(raw: unknown): {
  value: "active" | "draft" | "archived";
  error?: string;
} {
  const cleaned = sanitizeString(raw)?.toLowerCase();
  if (!cleaned) {
    return { value: "active" };
  }
  if (!SERVICE_STATUS_VALUES.has(cleaned as "active" | "draft" | "archived")) {
    return {
      value: "active",
      error: "status must be one of: active, draft, archived.",
    };
  }
  return { value: cleaned as "active" | "draft" | "archived" };
}

export function validateBizcardServiceCreateInput(
  body: Record<string, unknown>,
): {
  valid: boolean;
  errors: string[];
  data: BizcardServiceCreateInput;
} {
  const errors: string[] = [];

  const name = sanitizePlainPersonText(body.name);
  if (!name) {
    errors.push("name is required.");
  } else if (name.length > 100) {
    errors.push("name must not exceed 100 characters.");
  }

  // Description is optional; empty string is stored (column is non-nullable Text).
  const description = sanitizeRichAboutText(body.description) ?? "";
  if (description.length > RICH_SERVICE_DESCRIPTION_MAX_LENGTH) {
    errors.push(
      `description must not exceed ${RICH_SERVICE_DESCRIPTION_MAX_LENGTH} characters.`,
    );
  }

  const parsedPrice = parseNullablePrice(body.price);
  if (parsedPrice.error) errors.push(parsedPrice.error);

  const parsedCurrency = parseNullableCurrency(body.currency);
  if (parsedCurrency.error) errors.push(parsedCurrency.error);

  if (parsedPrice.value !== null && !parsedCurrency.value) {
    errors.push("currency is required when price is provided.");
  }

  const rawServiceUrl = sanitizeString(body.serviceUrl ?? body.service_url);
  let serviceUrl: string | null = null;
  if (rawServiceUrl) {
    if (rawServiceUrl.length > 512) {
      errors.push("serviceUrl must not exceed 512 characters.");
    } else if (!isValidUrl(rawServiceUrl)) {
      errors.push("serviceUrl must start with http:// or https://.");
    } else {
      serviceUrl = rawServiceUrl;
    }
  }

  const parsedStatus = parseServiceStatus(body.status);
  if (parsedStatus.error) errors.push(parsedStatus.error);

  const parsedMedia = parseServiceMediaList(body.media);
  if (parsedMedia.errors.length > 0) errors.push(...parsedMedia.errors);

  const rawTagline = sanitizePlainPersonText(body.tagline);
  let tagline: string | null = null;
  if (rawTagline) {
    if (rawTagline.length > 255)
      errors.push("tagline must not exceed 255 characters.");
    else tagline = rawTagline;
  }

  const featured = body.featured === true;
  const isVisible = body.isVisible !== false;
  const isPriceNegotiable = body.isPriceNegotiable === true;

  return {
    valid: errors.length === 0,
    errors,
    data: {
      name: name ?? "",
      description: description ?? "",
      tagline,
      price: parsedPrice.value,
      currency: parsedCurrency.value,
      serviceUrl,
      featured_image: sanitizeString(body.featured_image) || null,
      featured,
      isVisible,
      isPriceNegotiable,
      status: parsedStatus.value,
      media: parsedMedia.value,
    },
  };
}

export function validateBizcardServiceUpdateInput(
  body: Record<string, unknown>,
): {
  valid: boolean;
  errors: string[];
  data: BizcardServiceUpdateInput;
} {
  const errors: string[] = [];
  const data: BizcardServiceUpdateInput = {};

  if ("name" in body) {
    const name = sanitizePlainPersonText(body.name);
    if (!name) errors.push("name cannot be empty.");
    else if (name.length > 100)
      errors.push("name must not exceed 100 characters.");
    else data.name = name;
  }

  if ("description" in body) {
    const description = sanitizeRichAboutText(body.description) ?? "";
    if (description.length > RICH_SERVICE_DESCRIPTION_MAX_LENGTH)
      errors.push(
        `description must not exceed ${RICH_SERVICE_DESCRIPTION_MAX_LENGTH} characters.`,
      );
    else data.description = description;
  }

  if ("tagline" in body) {
    const tagline = sanitizePlainPersonText(body.tagline);
    if (tagline === null) {
      data.tagline = null;
    } else if (tagline.length > 255) {
      errors.push("tagline must not exceed 255 characters.");
    } else {
      data.tagline = tagline;
    }
  }

  if ("price" in body) {
    const parsedPrice = parseNullablePrice(body.price);
    if (parsedPrice.error) errors.push(parsedPrice.error);
    else data.price = parsedPrice.value;
  }

  if ("currency" in body) {
    const parsedCurrency = parseNullableCurrency(body.currency);
    if (parsedCurrency.error) errors.push(parsedCurrency.error);
    else data.currency = parsedCurrency.value;
  }

  if (
    ("price" in body || "currency" in body) &&
    data.price !== undefined &&
    data.price !== null &&
    !data.currency
  ) {
    errors.push("currency is required when price is provided.");
  }

  if ("serviceUrl" in body || "service_url" in body) {
    const rawServiceUrl = sanitizeString(body.serviceUrl ?? body.service_url);
    if (rawServiceUrl === null) {
      data.serviceUrl = null;
    } else if (rawServiceUrl.length > 512) {
      errors.push("serviceUrl must not exceed 512 characters.");
    } else if (!isValidUrl(rawServiceUrl)) {
      errors.push("serviceUrl must start with http:// or https://.");
    } else {
      data.serviceUrl = rawServiceUrl;
    }
  }

  if ("status" in body) {
    const parsedStatus = parseServiceStatus(body.status);
    if (parsedStatus.error) errors.push(parsedStatus.error);
    else data.status = parsedStatus.value;
  }

  if ("media" in body) {
    const parsedMedia = parseServiceMediaList(body.media);
    if (parsedMedia.errors.length > 0) errors.push(...parsedMedia.errors);
    else data.media = parsedMedia.value;
  }

  if ("featured_image" in body) {
    const rawFeaturedImage = sanitizeString(body.featured_image);
    if (rawFeaturedImage === null) {
      data.featured_image = null;
    } else if (rawFeaturedImage.length > 512) {
      errors.push("featured_image must not exceed 512 characters.");
    } else if (!isValidUrl(rawFeaturedImage)) {
      errors.push("featured_image must start with http:// or https://.");
    } else {
      data.featured_image = rawFeaturedImage;
    }
  }

  if ("featured" in body) data.featured = body.featured === true;
  if ("isVisible" in body) data.isVisible = body.isVisible === true;
  if ("isPriceNegotiable" in body)
    data.isPriceNegotiable = body.isPriceNegotiable === true;

  return {
    valid: errors.length === 0,
    errors,
    data,
  };
}

export function validateThemeApplyInput(body: Record<string, unknown>): {
  valid: boolean;
  errors: string[];
  data: { themeId: bigint | null };
} {
  const errors: string[] = [];
  const raw = sanitizeString(body.theme_id ?? body.themeId);
  if (!raw || !/^\d{1,20}$/.test(raw)) {
    errors.push("theme_id must be a valid numeric ID.");
    return { valid: false, errors, data: { themeId: null } };
  }

  try {
    return { valid: true, errors, data: { themeId: BigInt(raw) } };
  } catch {
    errors.push("theme_id must be a valid numeric ID.");
    return { valid: false, errors, data: { themeId: null } };
  }
}

// ── vCard setup (initial wizard) ───────────────────────────────

export interface VCardSetupInput {
  // Custom URI for the public vCard URL  e.g. "john-doe"
  customUri: string | null;
  // vCard display name (shown on the card; defaults to first+last if null)
  vcardName: string | null;
  // Short bio / tagline
  vcardDescription: string | null;
  // Core profile fields (all optional — user may skip sections)
  firstName: string | null;
  lastName: string | null;
  middleName: string | null;
  profTitle: string | null; // "Dr.", "Engr.", etc.
  postNominal: string | null; // "MD", "PhD", etc.
  suffix: string | null; // "Jr.", "III", etc.
  jobPosition: string | null;
  about: string | null;
  languages: string | null;
  contact: string | null;
  altContact: string | null;
  telephone: string | null;
  altTelephone: string | null;
  /** Public bizcard contact email (does not change login User.email). */
  email: string | null;
  altEmail: string | null;
  // Media URLs (files must be pre-uploaded to CDN; API stores URL only)
  profileUrl: string | null;
  coverUrl: string | null;
  coverImagePosition: string | null;
  // Frontend filesystem theme slug/path (e.g. "ocean-gradient")
  themePath: string | null;
  // Publish immediately after setup?
  publishNow: boolean;
  // Nested arrays — validated per-item; omit from payload to leave untouched on update
  socials?: SocialInput[];
  services?: ServiceInput[];
  // Address (optional flat object)
  address: AddressInput | null;
  // Display preference toggles
  showCoverPhoto: boolean | undefined;
  showInquiryCard: boolean | undefined;
  showAssociateCount: boolean | undefined;
  showMutualAssociates: boolean | undefined;
  showEmail: boolean | undefined;
  contactLinkLabel: ContactLinkLabelMode | undefined;
}

export interface AddressInput {
  area: string | null; // Street / address line
  brgy: string | null; // Barangay / neighborhood
  city: string | null;
  region: string | null; // State / province / region
  zipcode: string | null;
  plusCode: string | null; // Google Plus Code (optional)
  mapLink: string | null; // Google Maps / OpenStreetMap / pin URL
  landmark: string | null; // Rich-text office / landmark details for map popup
  latitude: number | null;
  longitude: number | null;
}

/** Max stored length for a rich landmark value (HTML tags included). */
const RICH_LANDMARK_MAX_LENGTH = 2000;

function validateAddressInput(raw: unknown): {
  valid: boolean;
  errors: string[];
  data: AddressInput | null;
} {
  if (!raw || typeof raw !== "object")
    return { valid: true, errors: [], data: null };
  const obj = raw as Record<string, unknown>;
  const errors: string[] = [];

  const area = sanitizeString(obj.area);
  if (area && area.length > 255)
    errors.push("address.area must not exceed 255 characters.");

  const brgy = sanitizeString(obj.brgy);
  if (brgy && brgy.length > 255)
    errors.push("address.brgy must not exceed 255 characters.");

  const city = sanitizeString(obj.city);
  if (city && city.length > 255)
    errors.push("address.city must not exceed 255 characters.");

  const region = sanitizeString(obj.region);
  if (region && region.length > 255)
    errors.push("address.region must not exceed 255 characters.");

  const zipcode = sanitizeString(obj.zipcode);
  if (zipcode && zipcode.length > 20)
    errors.push("address.zipcode must not exceed 20 characters.");

  const plusCode = sanitizeString(obj.plusCode);
  if (plusCode && plusCode.length > 255)
    errors.push("address.plusCode must not exceed 255 characters.");

  const landmark = sanitizeRichAboutText(obj.landmark);
  if (landmark && landmark.length > RICH_LANDMARK_MAX_LENGTH) {
    errors.push(
      `address.landmark must not exceed ${RICH_LANDMARK_MAX_LENGTH} characters.`,
    );
  }

  let latitude: number | null = null;
  if (
    obj.latitude !== undefined &&
    obj.latitude !== null &&
    obj.latitude !== ""
  ) {
    const latNum =
      typeof obj.latitude === "number" ? obj.latitude : Number(obj.latitude);
    if (!Number.isFinite(latNum) || latNum < -90 || latNum > 90) {
      errors.push("address.latitude must be between -90 and 90.");
    } else {
      latitude = latNum;
    }
  }

  let longitude: number | null = null;
  if (
    obj.longitude !== undefined &&
    obj.longitude !== null &&
    obj.longitude !== ""
  ) {
    const lngNum =
      typeof obj.longitude === "number" ? obj.longitude : Number(obj.longitude);
    if (!Number.isFinite(lngNum) || lngNum < -180 || lngNum > 180) {
      errors.push("address.longitude must be between -180 and 180.");
    } else {
      longitude = lngNum;
    }
  }

  const hasAnyAddressField =
    Boolean(area) ||
    Boolean(brgy) ||
    Boolean(city) ||
    Boolean(region) ||
    Boolean(zipcode) ||
    Boolean(plusCode) ||
    Boolean(landmark) ||
    latitude !== null ||
    longitude !== null;

  // mapLink — optional, must be a valid http(s) URL if supplied
  const rawMapLink = sanitizeString(obj.mapLink);
  let mapLink: string | null = null;
  if (rawMapLink) {
    if (rawMapLink.length > 512) {
      errors.push("address.mapLink must not exceed 512 characters.");
    } else if (!/^https?:\/\/.{3,}/i.test(rawMapLink)) {
      errors.push("address.mapLink must start with http:// or https://.");
    } else {
      mapLink = rawMapLink;
    }
  }

  const hasMapLink = Boolean(mapLink);
  const hasMeaningfulAddress =
    hasAnyAddressField || hasMapLink;

  if (hasMeaningfulAddress && !mapLink && !plusCode) {
    errors.push(
      "address.mapLink is required when providing address details.",
    );
  }

  if (errors.length > 0) return { valid: false, errors, data: null };

  // Empty / no-op address payload (e.g. `{ landmark: "" }`) must not wipe stored address.
  if (!hasMeaningfulAddress) {
    return { valid: true, errors: [], data: null };
  }

  return {
    valid: true,
    errors: [],
    data: {
      area: area ?? null,
      brgy: brgy ?? null,
      city: city ?? null,
      region: region ?? null,
      zipcode: zipcode ?? null,
      plusCode: plusCode ?? null,
      mapLink: mapLink ?? null,
      landmark: landmark ?? null,
      latitude,
      longitude,
    },
  };
}

// Custom URI: lowercase letters, digits, hyphens only; 3-64 chars.
// This becomes the public URL slug: /v/<custom_uri>
const CUSTOM_URI_REGEX = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

/**
 * Validate the full vCard setup payload (POST /api/vcard/setup).
 * All profile fields are optional to allow incremental setup.
 * Social and service arrays are validated per-item; any item error
 * causes the whole request to be rejected with a descriptive message.
 */
export function validateVCardSetupInput(body: Record<string, unknown>): {
  valid: boolean;
  errors: string[];
  data: VCardSetupInput;
} {
  const errors: string[] = [];

  // customUri — optional but validated strictly if provided
  // Accept camelCase or snake_case; normalize spaces to hyphens before validating.
  const rawUri = sanitizeString(body.customUri ?? body.custom_uri ?? body.urlAlias ?? body.url_alias);
  let customUri: string | null = null;
  if (rawUri) {
    const normalised = sanitizeUrlAlias(rawUri);
    if (!CUSTOM_URI_REGEX.test(normalised)) {
      errors.push(
        "customUri must be 3-64 characters, lowercase letters, digits and hyphens only (cannot start or end with a hyphen).",
      );
    } else {
      customUri = normalised;
    }
  }

  // vCard display name
  const vcardName = sanitizeString(body.vcardName);
  if (vcardName && vcardName.length > 255)
    errors.push("vcardName must not exceed 255 characters.");

  // Short bio
  const vcardDescription = sanitizeString(body.vcardDescription);

  // Profile fields
  const firstName = sanitizeString(body.firstName);
  if (firstName && firstName.length > 100)
    errors.push("firstName must not exceed 100 characters.");

  const lastName = sanitizeString(body.lastName);
  if (lastName && lastName.length > 100)
    errors.push("lastName must not exceed 100 characters.");

  const middleName = sanitizeString(body.middleName);
  if (middleName && middleName.length > 100)
    errors.push("middleName must not exceed 100 characters.");

  const profTitle = sanitizeString(body.profTitle);
  if (profTitle && profTitle.length > 20)
    errors.push("profTitle must not exceed 20 characters.");

  const postNominal = sanitizeString(body.postNominal);
  if (postNominal && postNominal.length > 20)
    errors.push("postNominal must not exceed 20 characters.");

  const suffix = sanitizeString(body.suffix);
  if (suffix && suffix.length > 10)
    errors.push("suffix must not exceed 10 characters.");

  const jobPosition = sanitizeString(body.jobPosition);
  if (jobPosition && jobPosition.length > 100)
    errors.push("jobPosition must not exceed 100 characters.");

  const about = sanitizeRichAboutText(body.about);
  if (about && about.length > RICH_ABOUT_MAX_LENGTH)
    errors.push(`about must not exceed ${RICH_ABOUT_MAX_LENGTH} characters.`);

  const languages = sanitizeString(body.languages);
  if (languages && languages.length > 500)
    errors.push("languages must not exceed 500 characters.");

  const rawContact = sanitizeString(body.contact);
  const contactProvided = Object.prototype.hasOwnProperty.call(body, "contact");
  const contact = rawContact ? normalizeContactNumber(rawContact) : contactProvided ? "" : null;
  if (contact && contact.length > 20)
    errors.push("contact must not exceed 20 characters.");

  const rawAltContact = sanitizeString(body.altContact);
  const altContactProvided = Object.prototype.hasOwnProperty.call(body, "altContact");
  const altContact = rawAltContact
    ? normalizeContactNumber(rawAltContact)
    : altContactProvided
      ? ""
      : null;
  if (altContact && altContact.length > 20)
    errors.push("altContact must not exceed 20 characters.");

  const TELEPHONE_RE = /^[0-9+\-()\s.]{1,30}$/;
  const rawTelephone = sanitizeString(body.telephone);
  const telephoneProvided = Object.prototype.hasOwnProperty.call(body, "telephone");
  let telephone: string | null = null;
  if (telephoneProvided) {
    if (!rawTelephone) {
      telephone = "";
    } else if (!TELEPHONE_RE.test(rawTelephone)) {
      errors.push(
        "telephone must contain only digits, spaces, and the characters: + - ( ) .",
      );
    } else {
      const digits = rawTelephone.replace(/\D/g, "");
      if (digits.length < 7 || digits.length > 12) {
        errors.push("telephone must be 7–12 digits.");
      } else {
        telephone = digits;
      }
    }
  }

  const rawAltTelephone = sanitizeString(body.altTelephone);
  const altTelephoneProvided = Object.prototype.hasOwnProperty.call(
    body,
    "altTelephone",
  );
  let altTelephone: string | null = null;
  if (altTelephoneProvided) {
    if (!rawAltTelephone) {
      altTelephone = "";
    } else if (!TELEPHONE_RE.test(rawAltTelephone)) {
      errors.push(
        "altTelephone must contain only digits, spaces, and the characters: + - ( ) .",
      );
    } else {
      const digits = rawAltTelephone.replace(/\D/g, "");
      if (digits.length < 7 || digits.length > 12) {
        errors.push("altTelephone must be 7–12 digits.");
      } else {
        altTelephone = digits;
      }
    }
  }

  const rawEmail = sanitizeEmail(body.email);
  const emailProvided = Object.prototype.hasOwnProperty.call(body, "email");
  let email: string | null = null;
  if (emailProvided) {
    if (!rawEmail) {
      email = "";
    } else if (rawEmail.length > 255) {
      errors.push("email must not exceed 255 characters.");
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
      errors.push("email must be a valid email address.");
    } else {
      email = rawEmail;
    }
  }

  const rawAltEmail = sanitizeEmail(body.altEmail);
  const altEmailProvided = Object.prototype.hasOwnProperty.call(body, "altEmail");
  let altEmail: string | null = null;
  if (altEmailProvided) {
    if (!rawAltEmail) {
      altEmail = "";
    } else if (rawAltEmail.length > 191) {
      errors.push("altEmail must not exceed 191 characters.");
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawAltEmail)) {
      errors.push("altEmail must be a valid email address.");
    } else {
      altEmail = rawAltEmail;
    }
  }

  // Media URLs — must be valid https URLs if provided
  const rawProfileUrl = sanitizeString(body.profileUrl);
  if (rawProfileUrl && !isValidUrl(rawProfileUrl))
    errors.push("profileUrl must be a valid http(s) URL.");
  const profileUrl =
    rawProfileUrl && isValidUrl(rawProfileUrl)
      ? rawProfileUrl.substring(0, 512)
      : null;

  const rawCoverUrl = sanitizeString(body.coverUrl);
  if (rawCoverUrl && !isValidUrl(rawCoverUrl))
    errors.push("coverUrl must be a valid http(s) URL.");
  const coverUrl =
    rawCoverUrl && isValidUrl(rawCoverUrl)
      ? rawCoverUrl.substring(0, 512)
      : null;

  const rawCoverPosition = sanitizeString(body.coverImagePosition);
  let coverImagePosition: string | null = null;
  if (rawCoverPosition) {
    const allowed = new Set(["center top", "center center", "center bottom"]);
    if (
      !allowed.has(rawCoverPosition) &&
      !/^center\s+\d{1,3}%$/.test(rawCoverPosition)
    ) {
      errors.push(
        "coverImagePosition must be center top, center center, center bottom, or center N%.",
      );
    } else {
      coverImagePosition = rawCoverPosition.substring(0, 50);
    }
  }

  // Theme path/slug from frontend filesystem.
  // Backward-compatible aliases accepted from clients: theme, themeName.
  const rawThemePath = sanitizeString(
    body.themePath ?? body.theme ?? body.themeName,
  );
  let themePath: string | null = null;
  if (rawThemePath) {
    const normalizedTheme = rawThemePath.toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(normalizedTheme)) {
      errors.push(
        "themePath must be 2-64 chars using lowercase letters, digits, and hyphens.",
      );
    } else {
      themePath = normalizedTheme;
    }
  }

  // publishNow flag
  const publishNow = body.publishNow === true;

  // Display preference toggles (accept camelCase or snake_case from clients)
  const showCoverPhotoRaw = body.showCoverPhoto ?? body.show_cover_photo;
  const showInquiryCardRaw = body.showInquiryCard ?? body.show_inquiry_card;
  const showAssociateCountRaw = body.showAssociateCount ?? body.show_associate_count;
  const showMutualAssociatesRaw = body.showMutualAssociates ?? body.show_mutual_associates;
  const showEmailRaw = body.showEmail ?? body.show_email;
  const showCoverPhoto = showCoverPhotoRaw === true ? true : showCoverPhotoRaw === false ? false : undefined;
  const showInquiryCard = showInquiryCardRaw === true ? true : showInquiryCardRaw === false ? false : undefined;
  const showAssociateCount = showAssociateCountRaw === true ? true : showAssociateCountRaw === false ? false : undefined;
  const showMutualAssociates = showMutualAssociatesRaw === true ? true : showMutualAssociatesRaw === false ? false : undefined;
  const showEmail = showEmailRaw === true ? true : showEmailRaw === false ? false : undefined;
  let contactLinkLabel: ContactLinkLabelMode | undefined;
  if (body.contactLinkLabel !== undefined || body.contact_link_label !== undefined) {
    const normalizedLabel = sanitizeString(body.contactLinkLabel ?? body.contact_link_label)?.toLowerCase();
    if (normalizedLabel !== "platform" && normalizedLabel !== "link") {
      errors.push("contactLinkLabel must be either platform or link.");
    } else {
      contactLinkLabel = normalizedLabel;
    }
  }

  // Socials array — only present when the key is included in the body
  const hasSocials = Object.prototype.hasOwnProperty.call(body, "socials");
  const socials: SocialInput[] | undefined = hasSocials ? [] : undefined;
  if (hasSocials) {
    const socialsRaw = Array.isArray(body.socials) ? body.socials : null;
    if (socialsRaw === null) {
      errors.push("socials: must be an array.");
    } else {
      for (let i = 0; i < socialsRaw.length; i++) {
        const item = socialsRaw[i];
        if (typeof item !== "object" || item === null) {
          errors.push(`socials[${i}]: must be an object.`);
          continue;
        }
        const result = validateSocialInput(item as Record<string, unknown>);
        if (!result.valid) {
          result.errors.forEach((e) => errors.push(`socials[${i}]: ${e}`));
        } else {
          socials!.push(result.data);
        }
      }

      // Enforce unique social URLs (normalized). Keep first occurrence; drop the rest.
      if (socials && socials.length > 1) {
        const seen = new Set<string>();
        const unique: SocialInput[] = [];
        for (const item of socials) {
          const key = normalizeSocialUrlKey(item.url);
          if (key && seen.has(key)) continue;
          if (key) seen.add(key);
          unique.push(item);
        }
        socials.length = 0;
        socials.push(...unique);
      }
    }
  }

  // Services array — only present when the key is included in the body
  const hasServices = Object.prototype.hasOwnProperty.call(body, "services");
  const services: ServiceInput[] | undefined = hasServices ? [] : undefined;
  if (hasServices) {
    const servicesRaw = Array.isArray(body.services) ? body.services : null;
    if (servicesRaw === null) {
      errors.push("services: must be an array.");
    } else {
      for (let i = 0; i < servicesRaw.length; i++) {
        const item = servicesRaw[i];
        if (typeof item !== "object" || item === null) {
          errors.push(`services[${i}]: must be an object.`);
          continue;
        }
        const result = validateServiceInput(item as Record<string, unknown>);
        if (!result.valid) {
          result.errors.forEach((e) => errors.push(`services[${i}]: ${e}`));
        } else {
          services!.push(result.data);
        }
      }
    }
  }

  // Address
  const addressResult = validateAddressInput(body.address);
  if (!addressResult.valid) {
    addressResult.errors.forEach((e) => errors.push(e));
  }

  return {
    valid: errors.length === 0,
    errors,
    data: {
      customUri,
      vcardName: vcardName ?? null,
      vcardDescription: vcardDescription ?? null,
      firstName: firstName ?? null,
      lastName: lastName ?? null,
      middleName: middleName ?? null,
      profTitle: profTitle ?? null,
      postNominal: postNominal ?? null,
      suffix: suffix ?? null,
      jobPosition: jobPosition ?? null,
      about: about ?? null,
      languages: languages ?? null,
      contact: contact ?? null,
      altContact: altContact ?? null,
      telephone: telephone ?? null,
      altTelephone: altTelephone ?? null,
      email: email ?? null,
      altEmail: altEmail ?? null,
      profileUrl,
      coverUrl,
      coverImagePosition,
      themePath,
      publishNow,
      showCoverPhoto,
      showInquiryCard,
      showAssociateCount,
      showMutualAssociates,
      showEmail,
      contactLinkLabel,
      socials,
      services,
      address: addressResult.data,
    },
  };
}

// ── vCard profile update (partial) ─────────────────────────────

/**
 * Validate a partial vCard update payload (PUT /api/vcard/profile).
 * Identical validation rules as setup but NOTHING is required — the
 * caller passes only the fields they want to change.
 *
 * Uses the same VCardSetupInput type so callers can share a single
 * handler type; all fields nullable / optional.
 */
export function validateVCardUpdateInput(body: Record<string, unknown>): {
  valid: boolean;
  errors: string[];
  data: Partial<VCardSetupInput>;
} {
  // Re-use the setup validator since all fields are optional there too.
  // The only semantic difference is that an empty body {} is valid for
  // an update (means "no changes") but not for setup.
  const result = validateVCardSetupInput(body);
  // Strip required-field errors — for updates nothing is mandatory.
  // Since we mark nothing as required in validateVCardSetupInput, the
  // result is already appropriate; just forward it.
  return {
    valid: result.valid,
    errors: result.errors,
    data: result.data,
  };
}

// ──────────────────────────────────────────────────────────────
// Company Validators
// ──────────────────────────────────────────────────────────────

export interface CompanyCreateInput {
  name: string;
  description: string | null;
  email: string | null;
  logoUrl: string | null;
}

export interface CompanyCreateRequestInput {
  company_name: string;
  description: string | null;
  logo_url: string | null;
}

export interface CompanyApproveInput {
  request_id: number;
  action: "approve" | "reject";
  rejection_reason: string | null;
}

export interface CompanyJoinInput {
  company_id?: string;
  company_name?: string;
  security_code?: string;
}

/**
 * Validate the POST /api/company body.
 *
 * name        — required, 1–255 chars
 * description — optional, max 2000 chars
 * email       — optional, valid email format, max 191 chars
 * logoUrl     — optional, must start with http(s)://, max 512 chars
 */
export function validateCompanyCreateInput(body: Record<string, unknown>): {
  valid: boolean;
  errors: string[];
  data: CompanyCreateInput;
} {
  const errors: string[] = [];

  // name — required
  const rawName = sanitizeString(body.name);
  if (!rawName) {
    errors.push("Company name is required.");
  } else if (rawName.length > 255) {
    errors.push("Company name must not exceed 255 characters.");
  }
  const name = rawName ? rawName.substring(0, 255) : "";

  // description — optional, max 2000 chars
  const rawDesc = sanitizeString(body.description);
  const description = rawDesc ? rawDesc.substring(0, 2000) : null;

  // email — optional, valid format, max 191 chars
  const rawEmail = sanitizeString(body.email);
  let email: string | null = null;
  if (rawEmail) {
    if (rawEmail.length > 191) {
      errors.push("Company email must not exceed 191 characters.");
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
      errors.push("Company email must be a valid email address.");
    } else {
      email = rawEmail.toLowerCase();
    }
  }

  // logoUrl — optional, http(s) only, max 512 chars
  const rawLogo = sanitizeString(body.logoUrl);
  let logoUrl: string | null = null;
  if (rawLogo) {
    if (rawLogo.length > 512) {
      errors.push("logoUrl must not exceed 512 characters.");
    } else if (!/^https?:\/\/.{3,}/i.test(rawLogo)) {
      errors.push("logoUrl must start with http:// or https://.");
    } else {
      logoUrl = rawLogo;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    data: { name, description, email, logoUrl },
  };
}

export function validateCompanyCreateRequestInput(
  body: Record<string, unknown>,
): {
  valid: boolean;
  errors: string[];
  data: CompanyCreateRequestInput;
} {
  const errors: string[] = [];

  const companyName = sanitizeString(body.company_name);
  if (!companyName) {
    errors.push("company_name is required.");
  } else if (companyName.length > 255) {
    errors.push("company_name must not exceed 255 characters.");
  }

  const descriptionRaw = sanitizeString(body.description);
  const description = descriptionRaw ? descriptionRaw.substring(0, 2000) : null;

  const logoRaw = sanitizeString(body.logo_url);
  let logoUrl: string | null = null;
  if (logoRaw) {
    if (logoRaw.length > 500) {
      errors.push("logo_url must not exceed 500 characters.");
    } else if (!/^https?:\/\/.{3,}/i.test(logoRaw)) {
      errors.push("logo_url must start with http:// or https://.");
    } else {
      logoUrl = logoRaw;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    data: {
      company_name: companyName ?? "",
      description,
      logo_url: logoUrl,
    },
  };
}

export interface CompanySettingsUpdateInput {
  description?: string | null;
  email?: string | null;
  logo_url?: string | null;
  industry?: string | null;
  phone?: string | null;
  address?: string | null;
  approval_required?: boolean;
  is_public?: boolean;
}

/**
 * Validate PUT /api/company/settings body.
 * Profile fields are top-level; settings JSON is merged server-side for industry/phone/address only.
 */
export function validateCompanySettingsUpdateInput(
  body: Record<string, unknown>,
): {
  valid: boolean;
  errors: string[];
  data: CompanySettingsUpdateInput;
} {
  const errors: string[] = [];
  const data: CompanySettingsUpdateInput = {};

  if ("company_name" in body || "requested_name" in body || "name" in body) {
    errors.push(
      "Company name cannot be updated via this endpoint. Use POST /api/company/name-change/request.",
    );
  }

  if ("settings" in body) {
    errors.push("Use top-level profile fields instead of a settings object.");
  }

  if ("description" in body) {
    const rawDesc = sanitizeString(body.description);
    data.description = rawDesc ? rawDesc.substring(0, 2000) : null;
  }

  if ("email" in body) {
    const rawEmail = sanitizeString(body.email);
    if (!rawEmail) {
      data.email = null;
    } else if (rawEmail.length > 191) {
      errors.push("Company email must not exceed 191 characters.");
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
      errors.push("Company email must be a valid email address.");
    } else {
      data.email = rawEmail.toLowerCase();
    }
  }

  if ("logo_url" in body) {
    const rawLogo = sanitizeString(body.logo_url);
    if (!rawLogo) {
      data.logo_url = null;
    } else if (rawLogo.length > 512) {
      errors.push("logo_url must not exceed 512 characters.");
    } else if (!/^https?:\/\/.{3,}/i.test(rawLogo)) {
      errors.push("logo_url must start with http:// or https://.");
    } else {
      data.logo_url = rawLogo;
    }
  }

  if ("industry" in body) {
    const rawIndustry = sanitizeString(body.industry);
    data.industry = rawIndustry ? rawIndustry.substring(0, 100) : null;
  }

  if ("phone" in body) {
    const rawPhone = sanitizeString(body.phone);
    if (!rawPhone) {
      data.phone = null;
    } else if (rawPhone.length > 50) {
      errors.push("Phone must not exceed 50 characters.");
    } else if (!/^[\d\s+\-().]+$/.test(rawPhone)) {
      errors.push("Phone contains invalid characters.");
    } else {
      data.phone = rawPhone;
    }
  }

  if ("address" in body) {
    const rawAddress = sanitizeString(body.address);
    data.address = rawAddress ? rawAddress.substring(0, 500) : null;
  }

  if ("approval_required" in body) {
    if (typeof body.approval_required !== "boolean") {
      errors.push("approval_required must be boolean when provided.");
    } else {
      data.approval_required = body.approval_required;
    }
  }

  if ("is_public" in body) {
    if (typeof body.is_public !== "boolean") {
      errors.push("is_public must be boolean when provided.");
    } else {
      data.is_public = body.is_public;
    }
  }

  if (Object.keys(data).length === 0 && errors.length === 0) {
    errors.push("At least one updatable field is required.");
  }

  return {
    valid: errors.length === 0,
    errors,
    data,
  };
}

export function validateCompanyApproveInput(body: Record<string, unknown>): {
  valid: boolean;
  errors: string[];
  data: CompanyApproveInput;
} {
  const errors: string[] = [];

  const requestId = Number(body.request_id);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    errors.push("request_id must be a positive integer.");
  }

  const actionRaw = sanitizeString(body.action)?.toLowerCase();
  const action =
    actionRaw === "approve" || actionRaw === "reject" ? actionRaw : null;
  if (!action) {
    errors.push("action must be either 'approve' or 'reject'.");
  }

  const rejectionReason = sanitizeString(body.rejection_reason);
  if (action === "reject" && !rejectionReason) {
    errors.push("rejection_reason is required when action is reject.");
  }

  return {
    valid: errors.length === 0,
    errors,
    data: {
      request_id: Number.isInteger(requestId) ? requestId : 0,
      action: (action ?? "approve") as "approve" | "reject",
      rejection_reason: rejectionReason,
    },
  };
}

export function validateCompanyJoinInput(body: Record<string, unknown>): {
  valid: boolean;
  errors: string[];
  data: CompanyJoinInput;
} {
  const errors: string[] = [];

  const companyIdRaw = sanitizeString(body.company_id);
  const companyName = sanitizeString(body.company_name);
  const securityCode = sanitizeString(body.security_code);

  if (!companyIdRaw && !companyName) {
    errors.push("company_id or company_name is required.");
  }

  if (companyIdRaw && !/^\d+$/.test(companyIdRaw)) {
    errors.push("company_id must be a positive integer.");
  }

  if (companyName && companyName.length > 255) {
    errors.push("company_name must not exceed 255 characters.");
  }

  if (securityCode && securityCode.length > 32) {
    errors.push("security_code must not exceed 32 characters.");
  }

  return {
    valid: errors.length === 0,
    errors,
    data: {
      company_id: companyIdRaw || undefined,
      company_name: companyName || undefined,
      security_code: securityCode || undefined,
    },
  };
}

export function validateCompanySearchParams(params: Record<string, unknown>): {
  valid: boolean;
  errors: string[];
  data: { q: string; limit: number };
} {
  const errors: string[] = [];
  const q = sanitizeString(params.q) ?? "";
  const rawLimit = Number(params.limit ?? 10);

  if (q.length < 2) {
    errors.push("q must be at least 2 characters.");
  } else if (q.length > 100) {
    errors.push("q must not exceed 100 characters.");
  }

  const limit =
    Number.isFinite(rawLimit) && rawLimit >= 1 && rawLimit <= 20
      ? Math.floor(rawLimit)
      : 10;

  return {
    valid: errors.length === 0,
    errors,
    data: { q, limit },
  };
}

export function validateCompanyJoinRequestReviewInput(
  body: Record<string, unknown>,
): {
  valid: boolean;
  errors: string[];
  data: {
    request_id: string;
    action: "approve" | "reject";
    rejection_reason?: string;
  };
} {
  const errors: string[] = [];

  const requestId = sanitizeString(body.request_id);
  if (!requestId || !/^\d+$/.test(requestId)) {
    errors.push("request_id must be a positive integer.");
  }

  const actionRaw = sanitizeString(body.action)?.toLowerCase();
  const action =
    actionRaw === "approve" || actionRaw === "reject" ? actionRaw : null;
  if (!action) {
    errors.push("action must be either 'approve' or 'reject'.");
  }

  const rejectionReason = sanitizeString(body.rejection_reason);

  return {
    valid: errors.length === 0,
    errors,
    data: {
      request_id: requestId ?? "",
      action: (action ?? "approve") as "approve" | "reject",
      rejection_reason: rejectionReason || undefined,
    },
  };
}

// ──────────────────────────────────────────────────────────────
// BizCard API Validators
// ──────────────────────────────────────────────────────────────

// Custom URI for BizCard: lowercase alphanumeric + hyphens, 2–64 chars.
// Slightly more permissive than the vCard setup URI (allows 2-char slugs).
const BIZCARD_URI_REGEX = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]{2,64}$/;

// BizCard list — query param sort values allow-list.
// Prevents arbitrary column names from reaching Prisma orderBy.
export type BizCardSortField = "created_at" | "serial_id" | "activation_status";
const ALLOWED_SORT_FIELDS: readonly string[] = [
  "created_at",
  "serial_id",
  "activation_status",
];
export type SortDirection = "asc" | "desc";

/**
 * Validate query parameters for GET /api/bizcards/user.
 *
 * page         — 1-based page number  (default: 1)
 * limit        — items per page 1–50  (default: 20)
 * sortBy       — column to sort by    (default: "created_at")
 * sortDir      — "asc" | "desc"       (default: "desc")
 */
export function validateBizCardListParams(params: Record<string, unknown>): {
  valid: boolean;
  errors: string[];
  data: {
    page: number;
    limit: number;
    sortBy: BizCardSortField;
    sortDir: SortDirection;
  };
} {
  const errors: string[] = [];

  const rawPage = Number(params.page ?? 1);
  const rawLimit = Number(params.limit ?? 20);

  const page =
    Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const limit =
    Number.isFinite(rawLimit) && rawLimit >= 1 && rawLimit <= 50
      ? Math.floor(rawLimit)
      : 20;

  const rawSort = sanitizeString(params.sortBy);
  const rawSortDir = sanitizeString(params.sortDir);

  const sortBy: BizCardSortField =
    rawSort && (ALLOWED_SORT_FIELDS as readonly string[]).includes(rawSort)
      ? (rawSort as BizCardSortField)
      : "created_at";

  const sortDir: SortDirection =
    rawSortDir === "asc" || rawSortDir === "desc" ? rawSortDir : "desc";

  return {
    valid: errors.length === 0,
    errors,
    data: { page, limit, sortBy, sortDir },
  };
}

/**
 * Validate the PUT /api/bizcards/[serialId] request body.
 *
 * All fields are optional — supply only what needs to change.
 * Validates that supplied values meet length/format constraints.
 *
 * Editable vCard fields:
 *   customUri       — new slug (max 64, must pass CUSTOM_URI_REGEX)
 *   vcardName       — display name on the public card (max 255)
 *   profTitle       — prefix title, e.g. "Dr.", "Engr." (max 20)
 *   jobPosition     — job title / role label (max 100)
 *   about           — bio / description (max 3000)
 *   contact         — primary phone number (max 20)
 *   altContact      — secondary phone (max 20)
 *   altEmail        — secondary email (max 191)
 *
 * Editable card fields:
 *   activationStatus — "active" | "inactive" | "revoked"
 *     (only "active" → "inactive" and "inactive" → "active" are togglable by owner;
 *      "revoked" can only be set by company_admin — enforced in the route handler)
 */
export interface BizCardUpdateInput {
  customUri: string | null;
  vcardName: string | null;
  profTitle: string | null;
  jobPosition: string | null;
  about: string | null;
  contact: string | null;
  altContact: string | null;
  altEmail: string | null;
  activationStatus: "active" | "inactive" | "revoked" | null;
}

const ALLOWED_ACTIVATION_STATUSES = ["active", "inactive", "revoked"] as const;

export function validateBizCardUpdateInput(body: Record<string, unknown>): {
  valid: boolean;
  errors: string[];
  data: BizCardUpdateInput;
} {
  const errors: string[] = [];

  // customUri — optional, must pass URI regex if supplied
  const rawUri = sanitizeString(body.customUri ?? body.custom_uri ?? body.urlAlias ?? body.url_alias);
  let customUri: string | null = null;
  if (rawUri !== null) {
    const normalised = sanitizeUrlAlias(rawUri);
    if (!BIZCARD_URI_REGEX.test(normalised)) {
      errors.push(
        "customUri must be 2–64 lowercase alphanumeric characters or hyphens and cannot start or end with a hyphen.",
      );
    } else {
      customUri = normalised;
    }
  }

  // vcardName — optional, max 255
  const rawName = sanitizeString(body.vcardName);
  const vcardName = rawName ? rawName.substring(0, 255) : null;

  // profTitle — optional, max 20
  const rawTitle = sanitizeString(body.profTitle);
  const profTitle = rawTitle ? rawTitle.substring(0, 20) : null;

  // jobPosition — optional, max 100
  const rawJob = sanitizeString(body.jobPosition);
  const jobPosition = rawJob ? rawJob.substring(0, 100) : null;

  // about — optional rich text (bold/italic/underline + line breaks), capped
  const rawAbout = sanitizeRichAboutText(body.about);
  const about = rawAbout ? rawAbout.substring(0, RICH_ABOUT_MAX_LENGTH) : null;

  // contact — optional, digits/spaces/+/-/()/., max 20
  const rawContact = sanitizeString(body.contact);
  let contact: string | null = null;
  if (rawContact !== null) {
    if (rawContact.length > 20) {
      errors.push("contact must not exceed 20 characters.");
    } else if (rawContact && !/^[0-9+\-()\s.]{1,20}$/.test(rawContact)) {
      errors.push(
        "contact must contain only digits, spaces, and the characters: + - ( ) .",
      );
    } else {
      contact = rawContact;
    }
  }

  // altContact — same rules as contact
  const rawAlt = sanitizeString(body.altContact);
  let altContact: string | null = null;
  if (rawAlt !== null) {
    if (rawAlt.length > 20) {
      errors.push("altContact must not exceed 20 characters.");
    } else if (rawAlt && !/^[0-9+\-()\s.]{1,20}$/.test(rawAlt)) {
      errors.push(
        "altContact must contain only digits, spaces, and the characters: + - ( ) .",
      );
    } else {
      altContact = rawAlt;
    }
  }

  // altEmail — optional, valid email format, max 191
  const rawAltEmail = sanitizeString(body.altEmail);
  let altEmail: string | null = null;
  if (rawAltEmail !== null) {
    if (rawAltEmail.length > 191) {
      errors.push("altEmail must not exceed 191 characters.");
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawAltEmail)) {
      errors.push("altEmail must be a valid email address.");
    } else {
      altEmail = rawAltEmail.toLowerCase();
    }
  }

  // activationStatus — optional, allow-list validated
  const rawStatus = sanitizeString(body.activationStatus);
  let activationStatus: BizCardUpdateInput["activationStatus"] = null;
  if (rawStatus !== null) {
    if (
      !(ALLOWED_ACTIVATION_STATUSES as readonly string[]).includes(rawStatus)
    ) {
      errors.push(
        `activationStatus must be one of: ${ALLOWED_ACTIVATION_STATUSES.join(", ")}.`,
      );
    } else {
      activationStatus = rawStatus as BizCardUpdateInput["activationStatus"];
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    data: {
      customUri,
      vcardName,
      profTitle,
      jobPosition,
      about,
      contact,
      altContact,
      altEmail,
      activationStatus,
    },
  };
}

// ──────────────────────────────────────────────────────────────
// E-Marketplace Validators
// ──────────────────────────────────────────────────────────────

const ITEM_TYPES = new Set(["merchandise", "template", "subscription"]);
const BILLING_CYCLES = new Set(["monthly", "yearly"]);
 
const LICENSE_TYPES = new Set(["personal", "commercial", "extended"]);

/**
 * Validate add-to-cart request body.
 * Price is never accepted from the client — it is always resolved server-side.
 */
export function validateAddToCartInput(body: Record<string, unknown>): {
  valid: boolean;
  errors: string[];
  data: {
    itemType: "merchandise" | "template" | "subscription";
    itemId: bigint;
    quantity: number;
    customData: Record<string, unknown> | null;
  };
} {
  const errors: string[] = [];

  const rawType = sanitizeString(body.item_type ?? body.itemType);
  if (!rawType || !ITEM_TYPES.has(rawType)) {
    errors.push(
      "item_type must be one of: merchandise, template, subscription.",
    );
  }

  const rawId = body.item_id ?? body.itemId;
  let itemId: bigint | null = null;
  try {
    const parsed = BigInt(String(rawId));
    if (parsed <= BigInt(0)) throw new Error();
    itemId = parsed;
  } catch {
    errors.push("item_id must be a positive integer.");
  }

  const rawQty = Number(body.quantity ?? 1);
  const quantity =
    Number.isInteger(rawQty) && rawQty >= 1 && rawQty <= 10000 ? rawQty : null;
  if (quantity === null)
    errors.push("quantity must be an integer between 1 and 10,000.");

  let customData: Record<string, unknown> | null = null;
  if (body.custom_data !== undefined && body.custom_data !== null) {
    if (
      typeof body.custom_data === "object" &&
      !Array.isArray(body.custom_data)
    ) {
      customData = body.custom_data as Record<string, unknown>;
    } else {
      errors.push("custom_data must be a JSON object when provided.");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    data: {
      itemType:
        (rawType as "merchandise" | "template" | "subscription") ??
        "merchandise",
      itemId: itemId ?? BigInt(0),
      quantity: quantity ?? 1,
      customData,
    },
  };
}

/**
 * Validate update-cart-item request body.
 */
export function validateUpdateCartInput(body: Record<string, unknown>): {
  valid: boolean;
  errors: string[];
  data: {
    quantity?: number;
    customData?: Record<string, unknown> | null;
    note?: string | null;
  };
} {
  const errors: string[] = [];
  const data: {
    quantity?: number;
    customData?: Record<string, unknown> | null;
    note?: string | null;
  } = {};

  if ("quantity" in body) {
    const rawQty = Number(body.quantity);
    if (!Number.isInteger(rawQty) || rawQty < 1 || rawQty > 10000) {
      errors.push("quantity must be an integer between 1 and 10,000.");
    } else {
      data.quantity = rawQty;
    }
  }

  if ("custom_data" in body) {
    if (body.custom_data === null) {
      data.customData = null;
    } else if (
      typeof body.custom_data === "object" &&
      !Array.isArray(body.custom_data)
    ) {
      data.customData = body.custom_data as Record<string, unknown>;
    } else {
      errors.push("custom_data must be a JSON object or null.");
    }
  }

  // Optional note field (per-cart-item user note)
  if ("note" in body) {
    const rawNote = sanitizeString(
      (body as Record<string, unknown>).note ?? null,
    );
    if (rawNote === null) {
      // allow explicit null to clear note
      data.note = null;
    } else {
      // limit note length to 500 characters
      data.note = rawNote.substring(0, 500);
    }
  }

  if (!("quantity" in body) && !("custom_data" in body)) {
    errors.push(
      "At least one field (quantity or custom_data) must be provided.",
    );
  }

  return { valid: errors.length === 0, errors, data };
}

/**
 * Validate checkout request body.
 */
export function validateCheckoutInput(body: Record<string, unknown>): {
  valid: boolean;
  errors: string[];
  data: {
    paymentMethodId: string | null;
    shippingAddress: Record<string, unknown> | null;
    billingAddress: Record<string, unknown> | null;
    savePaymentMethod: boolean;
    notes: string | null;
    promoCode: string | null;
    selectedItemIds: string[] | null;
  };
} {
  const errors: string[] = [];

  const paymentMethodId = sanitizeString(
    body.payment_method_id ?? body.paymentMethodId,
  );
  if (paymentMethodId && paymentMethodId.length > 255) {
    errors.push("payment_method_id must not exceed 255 characters.");
  }

  let shippingAddress: Record<string, unknown> | null = null;
  if (
    body.shipping_address &&
    typeof body.shipping_address === "object" &&
    !Array.isArray(body.shipping_address)
  ) {
    shippingAddress = body.shipping_address as Record<string, unknown>;
  }

  let billingAddress: Record<string, unknown> | null = null;
  const rawBilling = body.billing_address;
  if (
    rawBilling &&
    typeof rawBilling === "object" &&
    !Array.isArray(rawBilling)
  ) {
    const ba = rawBilling as Record<string, unknown>;
    billingAddress = ba.same_as_shipping === true ? shippingAddress : ba;
  }

  const savePaymentMethod = body.save_payment_method === true;
  const rawNotes = sanitizeString(body.notes);
  const notes = rawNotes ? rawNotes.substring(0, 500) : null;
  const promoCode = sanitizeString(body.promo_code ?? body.promoCode);

  let selectedItemIds: string[] | null = null;
  if (body.selectedItemIds && Array.isArray(body.selectedItemIds)) {
    selectedItemIds = body.selectedItemIds
      .map((id) => String(id))
      .filter((id) => id.length > 0);
  }

  return {
    valid: errors.length === 0,
    errors,
    data: {
      paymentMethodId,
      shippingAddress,
      billingAddress,
      savePaymentMethod,
      notes,
      promoCode,
      selectedItemIds,
    },
  };
}

/**
 * Validate subscription upgrade request body.
 */
export function validateSubscriptionUpgradeInput(
  body: Record<string, unknown>,
): {
  valid: boolean;
  errors: string[];
  data: {
    planId: bigint;
    billingCycle: "monthly" | "yearly";
    paymentMethodId: string | null;
    prorate: boolean;
    couponCode: string | null;
  };
} {
  const errors: string[] = [];

  let planId: bigint | null = null;
  try {
    const raw = BigInt(String(body.plan_id ?? body.planId ?? "0"));
    if (raw <= BigInt(0)) throw new Error();
    planId = raw;
  } catch {
    errors.push("plan_id must be a positive integer.");
  }

  const rawCycle =
    sanitizeString(body.billing_cycle ?? body.billingCycle) ?? "monthly";
  if (!BILLING_CYCLES.has(rawCycle)) {
    errors.push("billing_cycle must be 'monthly' or 'yearly'.");
  }

  const paymentMethodId = sanitizeString(
    body.payment_method_id ?? body.paymentMethodId,
  );
  if (paymentMethodId && paymentMethodId.length > 255) {
    errors.push("payment_method_id must not exceed 255 characters.");
  }

  const prorate = body.prorate !== false;
  const couponCode = sanitizeString(body.coupon_code ?? body.couponCode);

  return {
    valid: errors.length === 0,
    errors,
    data: {
      planId: planId ?? BigInt(0),
      billingCycle: (BILLING_CYCLES.has(rawCycle) ? rawCycle : "monthly") as
        | "monthly"
        | "yearly",
      paymentMethodId,
      prorate,
      couponCode,
    },
  };
}

/**
 * Validate subscription downgrade request body.
 */
export function validateSubscriptionDowngradeInput(
  body: Record<string, unknown>,
): {
  valid: boolean;
  errors: string[];
  data: { planId: bigint; reason: string | null };
} {
  const errors: string[] = [];

  let planId: bigint | null = null;
  try {
    const raw = BigInt(String(body.plan_id ?? body.planId ?? "0"));
    if (raw <= BigInt(0)) throw new Error();
    planId = raw;
  } catch {
    errors.push("plan_id must be a positive integer.");
  }

  const reason = sanitizeString(body.reason);

  return {
    valid: errors.length === 0,
    errors,
    data: {
      planId: planId ?? BigInt(0),
      reason: reason ? reason.substring(0, 100) : null,
    },
  };
}

/**
 * Validate subscription cancel request body.
 */
export function validateSubscriptionCancelInput(
  body: Record<string, unknown>,
): {
  valid: boolean;
  errors: string[];
  data: { reason: string | null; feedback: string | null };
} {
  const reason = sanitizeString(body.reason);
  const rawFeedback = sanitizeString(body.feedback);
  return {
    valid: true,
    errors: [],
    data: {
      reason: reason ? reason.substring(0, 100) : null,
      feedback: rawFeedback ? rawFeedback.substring(0, 500) : null,
    },
  };
}

/**
 * Validate promo-code validation request body.
 */
export function validatePromoCodeInput(body: Record<string, unknown>): {
  valid: boolean;
  errors: string[];
  data: {
    promoCode: string;
    cartSubtotal: number;
    items: unknown[];
  };
} {
  const errors: string[] = [];

  const promoCode = sanitizeString(body.promo_code ?? body.promoCode);
  if (!promoCode) errors.push("promo_code is required.");
  if (promoCode && promoCode.length > 100)
    errors.push("promo_code must not exceed 100 characters.");

  const cartSubtotal = Number(body.cart_subtotal ?? body.cartSubtotal ?? 0);
  if (!Number.isFinite(cartSubtotal) || cartSubtotal < 0) {
    errors.push("cart_subtotal must be a non-negative number.");
  }

  const items = Array.isArray(body.items) ? body.items : [];

  return {
    valid: errors.length === 0,
    errors,
    data: { promoCode: promoCode ?? "", cartSubtotal, items },
  };
}

// ──────────────────────────────────────────────────────────────
// Subscription Plan Change Validators
// ──────────────────────────────────────────────────────────────

/**
 * Validate change-plan request body.
 */
export function validateChangePlanInput(body: Record<string, unknown>): {
  valid: boolean;
  errors: string[];
  data: {
    planId: string;
    action: "upgrade" | "downgrade";
    bizcardSerialId: string | null;
  };
} {
  const errors: string[] = [];

  const planId = sanitizeString(body.planId);
  if (!planId) {
    errors.push("planId is required.");
  } else if (planId.length > 255) {
    errors.push("planId must not exceed 255 characters.");
  }

  const rawAction = sanitizeString(body.action)?.toLowerCase();
  const action =
    rawAction === "upgrade" || rawAction === "downgrade" ? rawAction : null;
  if (!action) {
    errors.push("action must be either 'upgrade' or 'downgrade'.");
  }

  const bizcardSerialId = sanitizeString(body.bizcardSerialId);
  if (bizcardSerialId && !/^[A-Za-z0-9_-]{4,64}$/.test(bizcardSerialId)) {
    errors.push("bizcardSerialId has invalid format.");
  }

  return {
    valid: errors.length === 0,
    errors,
    data: {
      planId: planId ?? "",
      action: action ?? "upgrade",
      bizcardSerialId: bizcardSerialId ?? null,
    },
  };
}

/**
 * Validate cancel-immediate request body.
 */
export function validateCancelImmediateInput(body: Record<string, unknown>): {
  valid: boolean;
  errors: string[];
  data: {
    bizcardSerialId: string | null;
  };
} {
  const errors: string[] = [];

  const bizcardSerialId = sanitizeString(body.bizcardSerialId);
  if (bizcardSerialId && !/^[A-Za-z0-9_-]{4,64}$/.test(bizcardSerialId)) {
    errors.push("bizcardSerialId has invalid format.");
  }

  return {
    valid: errors.length === 0,
    errors,
    data: {
      bizcardSerialId: bizcardSerialId ?? null,
    },
  };
}

// --------------------------------------------------------------
// Direct Checkout Validator
// --------------------------------------------------------------

export interface DirectCheckoutInput {
  customer: {
    email: string;
    given_names: string;
    last_name?: string; // not null
    phone?: string; // not null
  };
  item: {
    itemId: bigint;
    quantity: number;
    custom_data?: Record<string, unknown> | null; // not null
  };
  promoCode: string | null;
  referralCode: string | null;
  shipping_address: Record<string, unknown> | null;
  billing_address: Record<string, unknown> | null;
  shipping_method: string | null;
  notes: string | null;
}

export function validateDirectCheckoutInput(body: Record<string, unknown>): {
  valid: boolean;
  errors: string[];
  data: DirectCheckoutInput;
} {
  const errors: string[] = [];

  // ----- customer -----
  const customer = body.customer;
  if (!customer || typeof customer !== "object" || Array.isArray(customer)) {
    errors.push("customer must be an object.");
  } else {
    const cust = customer as Record<string, unknown>;

    // email - required, valid format
    const email = sanitizeEmail(cust.email);
    if (!email)
      errors.push("customer.email is required and must be a valid email.");
    else if (email.length > 191)
      errors.push("customer.email must not exceed 191 characters.");

    // given_names - required
    const givenNames = sanitizeString(cust.given_names);
    if (!givenNames) errors.push("customer.given_names is required.");
    else if (givenNames.length > 100)
      errors.push("customer.given_names must not exceed 100 characters.");

    // last_name - optional
    const lastName = sanitizeString(cust.last_name);
    if (lastName && lastName.length > 100)
      errors.push("customer.last_name must not exceed 100 characters.");

    // phone - optional, basic format (accept mobile_number alias from checkout form)
    const phone = sanitizeString(cust.phone ?? cust.mobile_number);
    if (phone && !/^[\d\s+\-()]{5,20}$/.test(phone)) {
      errors.push(
        "customer.phone must contain only digits, spaces, and + - ( ) .",
      );
    }

    // store validated fields in temp object for later assignment
    // We'll assign after item validation.
  }

  // ----- item -----
  const item = body.item;
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    errors.push("item must be an object.");
  } else {
    const it = item as Record<string, unknown>;

    // itemId - required, positive integer
    let itemId: bigint | null = null;
    try {
      const parsed = BigInt(String(it.itemId));
      if (parsed <= 0) throw new Error();
      itemId = parsed;
    } catch {
      errors.push("item.itemId must be a positive integer.");
    }

    // quantity - required, integer 1..10000
    const rawQty = Number(it.quantity);
    const quantity =
      Number.isInteger(rawQty) && rawQty >= 1 && rawQty <= 10000
        ? rawQty
        : null;
    if (quantity === null)
      errors.push("item.quantity must be an integer between 1 and 10,000.");

    // custom_data - optional, must be object or null
    let customData: Record<string, undefined> | undefined = undefined;
    if (it.custom_data !== undefined && it.custom_data !== null) {
      if (
        typeof it.custom_data === "object" &&
        !Array.isArray(it.custom_data)
      ) {
        customData = (it.custom_data as Record<string, undefined>) || undefined;
      } else {
        errors.push("item.custom_data must be a JSON object when provided.");
      }
    }

    // store fields for later
  }

  // ----- promoCode -----
  const promoCode = sanitizeString(body.promoCode);

  // ----- referralCode -----
  const referralCode = sanitizeString(body.referral_code ?? body.referralCode);

  // ----- shipping_address -----
  let shippingAddress: Record<string, unknown> | null = null;
  if (
    body.shipping_address &&
    typeof body.shipping_address === "object" &&
    !Array.isArray(body.shipping_address)
  ) {
    shippingAddress = body.shipping_address as Record<string, unknown>;
  }

  // ----- billing_address -----
  let billingAddress: Record<string, unknown> | null = null;
  if (
    body.billing_address &&
    typeof body.billing_address === "object" &&
    !Array.isArray(body.billing_address)
  ) {
    billingAddress = body.billing_address as Record<string, unknown>;
  }

  // ----- shipping_method -----
  const shippingMethod = sanitizeString(body.shipping_method);

  // ----- notes -----
  const notes = sanitizeString(body.notes);

  // Now assemble the final data object, re-fetching the validated fields from the body.
  // Since we already validated and stored in temp variables, we need to re‑extract cleanly.
  // For simplicity, we'll re‑extract and re‑validate inside the final data creation.

  // We'll rebuild from scratch to avoid duplication.
  return buildDirectCheckoutData(body, errors);
}

// Helper to build the data object after all validations
function buildDirectCheckoutData(
  body: Record<string, unknown>,
  errors: string[],
): {
  valid: boolean;
  errors: string[];
  data: DirectCheckoutInput;
} {
  // customer extraction
  let customerEmail = "";
  let customerGivenNames = "";
  let customerLastName: string | undefined = undefined;
  let customerPhone: string | undefined = undefined;

  const customer = body.customer;
  if (customer && typeof customer === "object" && !Array.isArray(customer)) {
    const c = customer as Record<string, unknown>;
    const email = sanitizeEmail(c.email);
    if (email) customerEmail = email;
    const given = sanitizeString(c.given_names);
    if (given) customerGivenNames = given;
    const last = sanitizeString(c.last_name);
    if (last) customerLastName = last;
    const phone = sanitizeString(c.phone ?? c.mobile_number);
    if (phone) customerPhone = phone;
  }

  // item extraction
  let itemId = BigInt(0);
  let quantity = 1;
  let customData: Record<string, unknown> | null = null;

  const item = body.item;
  if (item && typeof item === "object" && !Array.isArray(item)) {
    const it = item as Record<string, unknown>;
    try {
      const parsed = BigInt(String(it.itemId));
      if (parsed > 0) itemId = parsed;
    } catch {}
    const rawQty = Number(it.quantity);
    if (Number.isInteger(rawQty) && rawQty >= 1 && rawQty <= 10000)
      quantity = rawQty;
    if (
      it.custom_data &&
      typeof it.custom_data === "object" &&
      !Array.isArray(it.custom_data)
    ) {
      customData = (it.custom_data as Record<string, undefined>) || undefined;
    }
  }

  const promoCode = sanitizeString(body.promoCode);
  const referralCode = sanitizeString(body.referral_code ?? body.referralCode);

  let shippingAddress: Record<string, unknown> | null = null;
  if (
    body.shipping_address &&
    typeof body.shipping_address === "object" &&
    !Array.isArray(body.shipping_address)
  ) {
    shippingAddress = body.shipping_address as Record<string, unknown>;
  }

  let billingAddress: Record<string, unknown> | null = null;
  if (
    body.billing_address &&
    typeof body.billing_address === "object" &&
    !Array.isArray(body.billing_address)
  ) {
    billingAddress = body.billing_address as Record<string, unknown>;
  }

  const shippingMethod = sanitizeString(body.shipping_method);
  const notes = sanitizeString(body.notes);

  // Ensure required fields are present
  if (!customerEmail) errors.push("customer.email is required.");
  if (!customerGivenNames) errors.push("customer.given_names is required.");
  if (itemId === BigInt(0)) errors.push("item.itemId is required.");
  // quantity already validated

  return {
    valid: errors.length === 0,
    errors,
    data: {
      customer: {
        email: customerEmail,
        given_names: customerGivenNames,
        last_name: customerLastName || undefined, // or null
        phone: customerPhone || undefined, // or null
      },
      item: {
        itemId,
        quantity,
        custom_data: customData || undefined, // or null
      },
      promoCode,
      referralCode,
      shipping_address: shippingAddress,
      billing_address: billingAddress,
      shipping_method: shippingMethod,
      notes,
    },
  };
}
