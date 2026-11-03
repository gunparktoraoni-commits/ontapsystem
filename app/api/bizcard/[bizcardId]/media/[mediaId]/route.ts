import { NextRequest, NextResponse } from "next/server";

function goneResponse(request: NextRequest): NextResponse {
  const location = request.nextUrl.pathname.replace("/media/", "/gallery/");
  return NextResponse.json(
    {
      success: false,
      error: {
        code: "SYSTEM_1503",
        message: "This endpoint has been replaced. Use /api/bizcard/[bizcardId]/gallery/[mediaId].",
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

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  return goneResponse(request);
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  return goneResponse(request);
}
