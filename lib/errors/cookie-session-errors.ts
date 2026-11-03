/**
 * Cookie & Session Error Codes (27000-27399 range)
 * Used for consistent error handling and frontend coordination
 */

export enum CookieSessionErrorCode {
  // Cookie preference errors (27000-27099)
  PREFERENCE_NOT_FOUND = 'COOKIE_27000',
  INVALID_PREFERENCE_DATA = 'COOKIE_27001',
  PREFERENCE_SAVE_FAILED = 'COOKIE_27002',
  PREFERENCE_EXPIRED = 'COOKIE_27003',
  INVALID_CATEGORY_SLUG = 'COOKIE_27004',
  CATEGORY_NOT_FOUND = 'COOKIE_27005',
  PREFERENCE_MIGRATION_FAILED = 'COOKIE_27006',

  // Session errors (27100-27199)
  SESSION_NOT_FOUND = 'COOKIE_27100',
  SESSION_EXPIRED = 'COOKIE_27101',
  SESSION_CREATION_FAILED = 'COOKIE_27102',
  SESSION_VALIDATION_FAILED = 'COOKIE_27103',
  SESSION_REVOCATION_FAILED = 'COOKIE_27104',
  TOKEN_INVALID = 'COOKIE_27105',
  TOKEN_REFRESH_FAILED = 'COOKIE_27106',

  // System health errors (27200-27299)
  HEALTH_ANALYSIS_FAILED = 'COOKIE_27200',
  DATA_UNAVAILABLE = 'COOKIE_27201',
  ANALYTICS_CALCULATION_FAILED = 'COOKIE_27202',
  UNAUTHORIZED_HEALTH_ACCESS = 'COOKIE_27203',

  // Rate limiting (27300-27399)
  RATE_LIMIT_EXCEEDED = 'COOKIE_27300',
  RATE_LIMIT_PREFERENCE_GET = 'COOKIE_27301',
  RATE_LIMIT_PREFERENCE_SET = 'COOKIE_27302',
  RATE_LIMIT_SYSTEM_HEALTH = 'COOKIE_27303',
}

/**
 * CookieSessionError class
 * Custom error class for cookie & session operations with structured error tagging
 */
export class CookieSessionError extends Error {
  public readonly code: CookieSessionErrorCode;
  public readonly statusCode: number;
  public readonly context?: Record<string, any>;
  public readonly tags: string[];

  constructor(
    code: CookieSessionErrorCode,
    message: string,
    statusCode: number = 400,
    context?: Record<string, any>,
    tags: string[] = []
  ) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.context = context;
    this.tags = ['cookie-session', ...tags];
    this.name = 'CookieSessionError';

    // Maintain proper stack trace
    Object.setPrototypeOf(this, CookieSessionError.prototype);
  }

  /**
   * Convert error to JSON for API responses
   */
  toJSON() {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        statusCode: this.statusCode,
        tags: this.tags,
        ...(this.context && { context: this.context }),
      },
    };
  }

  /**
   * Get appropriate HTTP status code
   */
  getStatusCode(): number {
    const codeNumber = parseInt(this.code.split('_').pop() || '400');

    if (codeNumber >= 27000 && codeNumber < 27100) {
      return this.statusCode || 400; // Preference errors
    }
    if (codeNumber >= 27100 && codeNumber < 27200) {
      return this.statusCode || 401; // Session errors
    }
    if (codeNumber >= 27200 && codeNumber < 27300) {
      return this.statusCode || 500; // Health errors
    }
    if (codeNumber >= 27300 && codeNumber < 27400) {
      return 429; // Rate limit errors
    }

    return this.statusCode || 400;
  }
}

/**
 * Helper functions for common error scenarios
 */

export function createPreferenceNotFoundError(context?: Record<string, any>) {
  return new CookieSessionError(
    CookieSessionErrorCode.PREFERENCE_NOT_FOUND,
    'Cookie preferences not found',
    404,
    context,
    ['preference-not-found']
  );
}

export function createInvalidCategoryError(slug: string) {
  return new CookieSessionError(
    CookieSessionErrorCode.INVALID_CATEGORY_SLUG,
    `Invalid cookie category: ${slug}`,
    400,
    { slug },
    ['invalid-category']
  );
}

export function createPreferenceSaveError(reason?: string) {
  return new CookieSessionError(
    CookieSessionErrorCode.PREFERENCE_SAVE_FAILED,
    `Failed to save cookie preferences${reason ? ': ' + reason : ''}`,
    500,
    { reason },
    ['save-failed']
  );
}

export function createRateLimitError(limitType: string, retryAfterSeconds?: number) {
  return new CookieSessionError(
    CookieSessionErrorCode.RATE_LIMIT_EXCEEDED,
    `Rate limit exceeded for ${limitType}`,
    429,
    { limitType, retryAfterSeconds },
    ['rate-limited']
  );
}

export function createSessionError(reason: string, code: CookieSessionErrorCode = CookieSessionErrorCode.SESSION_VALIDATION_FAILED) {
  return new CookieSessionError(
    code,
    `Session error: ${reason}`,
    401,
    { reason },
    ['session-error']
  );
}

export function createHealthAnalysisError(reason?: string) {
  return new CookieSessionError(
    CookieSessionErrorCode.HEALTH_ANALYSIS_FAILED,
    `Health analysis failed${reason ? ': ' + reason : ''}`,
    500,
    { reason },
    ['health-analysis-failed']
  );
}

export function createPreferenceMigrationError(reason?: string) {
  return new CookieSessionError(
    CookieSessionErrorCode.PREFERENCE_MIGRATION_FAILED,
    `Preference migration failed${reason ? ': ' + reason : ''}`,
    500,
    { reason },
    ['migration-failed']
  );
}

/**
 * Error code to HTTP status mapping
 */
export const errorCodeStatusMap: Record<CookieSessionErrorCode, number> = {
  [CookieSessionErrorCode.PREFERENCE_NOT_FOUND]: 404,
  [CookieSessionErrorCode.INVALID_PREFERENCE_DATA]: 400,
  [CookieSessionErrorCode.PREFERENCE_SAVE_FAILED]: 500,
  [CookieSessionErrorCode.PREFERENCE_EXPIRED]: 410,
  [CookieSessionErrorCode.INVALID_CATEGORY_SLUG]: 400,
  [CookieSessionErrorCode.CATEGORY_NOT_FOUND]: 404,
  [CookieSessionErrorCode.PREFERENCE_MIGRATION_FAILED]: 500,

  [CookieSessionErrorCode.SESSION_NOT_FOUND]: 404,
  [CookieSessionErrorCode.SESSION_EXPIRED]: 401,
  [CookieSessionErrorCode.SESSION_CREATION_FAILED]: 500,
  [CookieSessionErrorCode.SESSION_VALIDATION_FAILED]: 401,
  [CookieSessionErrorCode.SESSION_REVOCATION_FAILED]: 500,
  [CookieSessionErrorCode.TOKEN_INVALID]: 401,
  [CookieSessionErrorCode.TOKEN_REFRESH_FAILED]: 401,

  [CookieSessionErrorCode.HEALTH_ANALYSIS_FAILED]: 500,
  [CookieSessionErrorCode.DATA_UNAVAILABLE]: 503,
  [CookieSessionErrorCode.ANALYTICS_CALCULATION_FAILED]: 500,
  [CookieSessionErrorCode.UNAUTHORIZED_HEALTH_ACCESS]: 403,

  [CookieSessionErrorCode.RATE_LIMIT_EXCEEDED]: 429,
  [CookieSessionErrorCode.RATE_LIMIT_PREFERENCE_GET]: 429,
  [CookieSessionErrorCode.RATE_LIMIT_PREFERENCE_SET]: 429,
  [CookieSessionErrorCode.RATE_LIMIT_SYSTEM_HEALTH]: 429,
};
