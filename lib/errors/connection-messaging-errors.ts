import { AppError, ErrorCode } from "@/lib/errors/types";

export enum ConnectionMessagingErrorCode {
  UNAUTHORIZED = "CONN_MSG_1000",
  FORBIDDEN = "CONN_MSG_1001",
  CONVERSATION_NOT_FOUND = "CONN_MSG_1002",
  MESSAGE_NOT_FOUND = "CONN_MSG_1003",
  INVALID_PAYLOAD = "CONN_MSG_1004",
  MESSAGE_TOO_LONG = "CONN_MSG_1005",
  TOO_MANY_ATTACHMENTS = "CONN_MSG_1006",
  INVALID_ATTACHMENT = "CONN_MSG_1007",
  NOT_CONNECTED = "CONN_MSG_1008",
  BLOCKED = "CONN_MSG_1009",
  RATE_LIMIT_EXCEEDED = "CONN_MSG_1010",
  INTERNAL_ERROR = "CONN_MSG_1011",
  ENCRYPTION_KEY_MISSING = "CONN_MSG_1012",
  ENCRYPTION_FAILED = "CONN_MSG_1013",
}

export function createConnectionMessagingError(
  code: ConnectionMessagingErrorCode,
  message: string,
  statusCode: number,
  requestId?: string,
  details?: Record<string, unknown>,
): AppError {
  return new AppError(code as unknown as ErrorCode, message, statusCode, details, requestId);
}

export function toConnectionMessagingErrorResponse(
  code: ConnectionMessagingErrorCode,
  message: string,
  requestId: string,
  details?: Record<string, unknown>,
) {
  return {
    success: false as const,
    requestId,
    error: {
      code,
      tag: "[CONN_MSG_API]",
      message,
      details,
      requestId,
      timestamp: new Date().toISOString(),
    },
  };
}
