declare module '@/lib/middleware/roleAuth' {
  import { NextRequest, NextResponse } from 'next/server';
  export type AuthOk = { ok: true; actor: { userId: bigint; email: string }; response?: NextResponse };
  export type AuthFail = { ok: false; response: NextResponse };
  export function requireRole(request: NextRequest, allowedRoles: string[] | string): Promise<AuthOk | AuthFail>;
}
