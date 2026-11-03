import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { AppError } from "@/lib/errors/types";
import { getRequestId } from "@/lib/errors/http";
import {
  ConnectionMessagingErrorCode,
  toConnectionMessagingErrorResponse,
} from "@/lib/errors/connection-messaging-errors";

function isPrismaSchemaError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P2021" || error.code === "P2022";
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /does not exist|Unknown table|direct_conversations/i.test(message);
}

export function connectionMessagingErrorResponse(
  error: unknown,
  requestId: string,
): NextResponse<{ requestId: string }> {
  if (error instanceof AppError) {
    const code = String(error.code) as ConnectionMessagingErrorCode;
    return NextResponse.json(
      toConnectionMessagingErrorResponse(code, error.message, requestId, error.details),
      { status: error.statusCode },
    );
  }
  if (isPrismaSchemaError(error)) {
    console.error("[CONN_MSG_API] database schema not ready:", error);
    return NextResponse.json(
      toConnectionMessagingErrorResponse(
        ConnectionMessagingErrorCode.INTERNAL_ERROR,
        "Direct messaging is not initialized. Run database migration.",
        requestId,
      ),
      { status: 503 },
    );
  }
  console.error("[CONN_MSG_API] unexpected error:", error);
  return NextResponse.json(
    toConnectionMessagingErrorResponse(
      ConnectionMessagingErrorCode.INTERNAL_ERROR,
      "An unexpected error occurred.",
      requestId,
    ),
    { status: 500 },
  );
}

export function getConnectionMessagingRequestId(headers: Headers): string {
  return getRequestId(headers);
}
