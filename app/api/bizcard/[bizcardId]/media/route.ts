import { NextRequest, NextResponse } from "next/server";

function goneResponse(request: NextRequest): NextResponse {
  const location = request.nextUrl.pathname.replace("/media", "/gallery");
  return NextResponse.json(
    {
      success: false,
      error: {
        code: "SYSTEM_1503",
        message: "This endpoint has been replaced. Use /api/bizcard/[bizcardId]/gallery.",
      },
      meta: {
        migratedTo: location,
      },
    },
    {
      status: 410,
      headers: {
        "X-API-Migrated-To": location,
      },
    }
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return goneResponse(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return goneResponse(request);
}
