import { NextRequest, NextResponse } from "next/server";
import { resolveRequestSession, resolveEffectiveUserId } from "@/server/lib/auth";

export const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, value) => (typeof value === "bigint" ? value.toString() : value)));

export async function requireSession(request: NextRequest): Promise<
  | { ok: true; userId: bigint }
  | { ok: false; response: NextResponse }
> {
  const resolved = await resolveRequestSession(request, { tryRefresh: true });
  if (!resolved.session) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: "Authentication required.", requiresAuth: true },
        { status: 401 }
      ),
    };
  }

  return { ok: true, userId: BigInt(resolveEffectiveUserId(resolved)) };
}
