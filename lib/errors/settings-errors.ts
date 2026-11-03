import { AppError, ErrorCode } from "@/lib/errors/types";

export enum SettingsErrorCode {
  // Authorization errors (18000-18099)
  UNAUTHORIZED_ACCESS = "SETTINGS_18000",
  SUPERADMIN_REQUIRED = "SETTINGS_18001",

  // Profile errors (18100-18199)
  PROFILE_NOT_FOUND = "SETTINGS_18100",
  INVALID_EMAIL = "SETTINGS_18101",
  INVALID_PHONE = "SETTINGS_18102",
  INVALID_REQUEST_PAYLOAD = "SETTINGS_18103",

  // Password errors (18200-18299)
  INCORRECT_CURRENT_PASSWORD = "SETTINGS_18200",
  PASSWORD_TOO_WEAK = "SETTINGS_18201",
  PASSWORD_SAME_AS_OLD = "SETTINGS_18202",

  // 2FA errors (18300-18399)
  INVALID_TWO_FACTOR_CODE = "SETTINGS_18300",
  TWO_FACTOR_ALREADY_ENABLED = "SETTINGS_18301",
  TWO_FACTOR_NOT_ENABLED = "SETTINGS_18302",
  QR_CODE_GENERATION_FAILED = "SETTINGS_18303",

  // Security settings errors (18400-18499)
  INVALID_AUTO_LOGOUT_VALUE = "SETTINGS_18400",
  INVALID_PASSWORD_ROTATION_DAYS = "SETTINGS_18401",
  INVALID_IP_BLOCK_LIST = "SETTINGS_18402",

  // Notification errors (18500-18599)
  INVALID_NOTIFICATION_PREFERENCE = "SETTINGS_18500",
  INVALID_FREQUENCY = "SETTINGS_18501",

  // Payment channel errors (18600-18699)
  PAYMENT_CHANNEL_NOT_FOUND = "SETTINGS_18600",
  INVALID_BANK_DETAILS = "SETTINGS_18601",
  ENCRYPTION_FAILED = "SETTINGS_18602",
  DECRYPTION_FAILED = "SETTINGS_18603",

  // Login history errors (18700-18799)
  SESSION_NOT_FOUND = "SETTINGS_18700",
  LOGIN_HISTORY_EXPORT_FAILED = "SETTINGS_18701",

  // Rate limiting (18800-18899)
  RATE_LIMIT_EXCEEDED = "SETTINGS_18800",
  INTERNAL_ERROR = "SETTINGS_18801",
}

export interface SettingsErrorResponse {
  success: false;
  error: {
    code: SettingsErrorCode;
    message: string;
    details?: Record<string, unknown>;
    requestId: string;
    timestamp: string;
  };
  meta?: {
    requestId: string;
    responseTime?: number;
  };
}

export function toSettingsErrorCode(code: SettingsErrorCode): ErrorCode {
  return code as unknown as ErrorCode;
}

export function createSettingsError(
  code: SettingsErrorCode,
  message: string,
  statusCode: number,
  requestId: string,
  details?: Record<string, unknown>
): AppError {
  return new AppError(toSettingsErrorCode(code), message, statusCode, details, requestId);
}

export function toSettingsErrorResponse(
  code: SettingsErrorCode,
  message: string,
  requestId: string,
  details?: Record<string, unknown>,
  responseTime?: number
): SettingsErrorResponse {
  return {
    success: false,
    error: {
      code,
      message,
      details,
      requestId,
      timestamp: new Date().toISOString(),
    },
    meta: {
      requestId,
      ...(responseTime !== undefined ? { responseTime } : {}),
    },
  };
}

export function extractSettingsErrorCode(error: AppError): SettingsErrorCode | null {
  const value = String(error.code);
  if (value.startsWith("SETTINGS_")) {
    return value as SettingsErrorCode;
  }
  return null;
}
