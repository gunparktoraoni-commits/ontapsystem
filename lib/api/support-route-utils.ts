import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { AppError } from "@/lib/errors/types";
import { getRequestId } from "@/lib/errors/http";
import {
  SupportMessagingErrorCode,
  toSupportMessagingErrorResponse,
} from "@/lib/errors/support-messaging-errors";

function isPrismaSchemaError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P2021" || error.code === "P2022";
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /does not exist|Unknown table|support_conversations/i.test(message);
}

export function supportErrorResponse(error: unknown, requestId: string): NextResponse<{ requestId: string }> {
  if (error instanceof AppError) {
    const code = String(error.code) as SupportMessagingErrorCode;
    return NextResponse.json(
      toSupportMessagingErrorResponse(code, error.message, requestId, error.details),
      { status: error.statusCode },
    );
  }
  if (isPrismaSchemaError(error)) {
    console.error("[SUPPORT_MSG] database schema not ready:", error);
    return NextResponse.json(
      toSupportMessagingErrorResponse(
        SupportMessagingErrorCode.INTERNAL_ERROR,
        "Support messaging is not initialized. Run database migration.",
        requestId,
      ),
      { status: 503 },
    );
  }
  console.error("[SUPPORT_MSG] unexpected error:", error);
  return NextResponse.json(
    toSupportMessagingErrorResponse(
      SupportMessagingErrorCode.INTERNAL_ERROR,
      "An unexpected error occurred.",
      requestId,
    ),
    { status: 500 },
  );
}

export function getSupportRequestId(headers: Headers): string {
  return getRequestId(headers);
}
