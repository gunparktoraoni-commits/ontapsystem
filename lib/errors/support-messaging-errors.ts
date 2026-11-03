import { AppError, ErrorCode } from "@/lib/errors/types";

export enum SupportMessagingErrorCode {
  UNAUTHORIZED = "SUPPORT_MSG_1000",
  FORBIDDEN = "SUPPORT_MSG_1001",
  CONVERSATION_NOT_FOUND = "SUPPORT_MSG_1002",
  MESSAGE_NOT_FOUND = "SUPPORT_MSG_1003",
  INVALID_PAYLOAD = "SUPPORT_MSG_1004",
  MESSAGE_TOO_LONG = "SUPPORT_MSG_1005",
  TOO_MANY_ATTACHMENTS = "SUPPORT_MSG_1006",
  INVALID_ATTACHMENT = "SUPPORT_MSG_1007",
  CONVERSATION_CLOSED = "SUPPORT_MSG_1008",
  ESCALATION_NOT_ALLOWED = "SUPPORT_MSG_1009",
  RESOLUTION_NOT_ALLOWED = "SUPPORT_MSG_1010",
  RATE_LIMIT_EXCEEDED = "SUPPORT_MSG_1011",
  INTERNAL_ERROR = "SUPPORT_MSG_1012",
}

export function createSupportMessagingError(
  code: SupportMessagingErrorCode,
  message: string,
  statusCode: number,
  requestId?: string,
  details?: Record<string, unknown>,
): AppError {
  return new AppError(code as unknown as ErrorCode, message, statusCode, details, requestId);
}

export function toSupportMessagingErrorResponse(
  code: SupportMessagingErrorCode,
  message: string,
  requestId: string,
  details?: Record<string, unknown>,
) {
  return {
    success: false as const,
    requestId,
    error: {
      code,
      tag: "[SUPPORT_MSG]",
      message,
      details,
      requestId,
      timestamp: new Date().toISOString(),
    },
  };
}
