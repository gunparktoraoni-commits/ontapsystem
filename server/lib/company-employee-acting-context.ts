import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";

export const COMPANY_ACTING_COOKIE_NAME = "company_employee_acting_token";
export const COMPANY_ACTING_HANDOFF_COOKIE_NAME = "company_employee_acting_handoff";
export const COMPANY_ACTING_HEADER_NAME = "x-company-acting-token";

const DEFAULT_TTL_MINUTES = 60;
const MIN_TTL_MINUTES = 5;
const MAX_TTL_MINUTES = 120;

export type CompanyActingTokenSource = "header" | "cookie";

export type CompanyActingPayload = {
  actorUserId: number;
  companyId: string;
  employeeId: string;
  employeeUserId: number;
  expiresAt: Date;
  source: CompanyActingTokenSource;
};

type TokenBody = {
  actorUserId: number;
  companyId: string;
  employeeId: string;
  employeeUserId: number;
  exp: number;
};

function getSigningSecret(): string {
  return process.env.JWT_SECRET || process.env.AFFILIATE_ENCRYPTION_KEY || "default-pepper";
}

function clampTtlMinutes(ttlMinutes?: number): number {
  if (!Number.isInteger(ttlMinutes)) return DEFAULT_TTL_MINUTES;
  return Math.max(MIN_TTL_MINUTES, Math.min(MAX_TTL_MINUTES, Number(ttlMinutes)));
}

function isProductionDeployment(): boolean {
  if (process.env.COOKIE_SECURE?.trim().toLowerCase() === "true") return true;
  if (process.env.NODE_ENV === "production") return true;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.FRONTEND_URL ?? "";
  return appUrl.trim().startsWith("https://");
}

function shouldUsePartitionedCookies(): boolean {
  const value = process.env.COOKIE_PARTITIONED?.trim().toLowerCase();
  if (value === "false") return false;
  if (value === "true") return isProductionDeployment();
  return isProductionDeployment();
}

function getActingCookieOptions(maxAgeSeconds: number) {
  const isProduction = isProductionDeployment();
  const options: {
    httpOnly: boolean;
    secure: boolean;
    sameSite: "none" | "lax";
    path: string;
    maxAge: number;
    partitioned?: boolean;
  } = {
    httpOnly: true,
    secure: true,
    sameSite: isProduction ? "none" : "lax",
    path: "/",
    maxAge: maxAgeSeconds,
  };

  if (shouldUsePartitionedCookies()) {
    options.partitioned = true;
  }

  return options;
}

function getHandoffCookieOptions(maxAgeSeconds: number) {
  return {
    ...getActingCookieOptions(maxAgeSeconds),
    httpOnly: false,
  };
}

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(encodedPayload: string): string {
  return crypto.createHmac("sha256", getSigningSecret()).update(encodedPayload).digest("base64url");
}

export function createCompanyActingToken(input: {
  actorUserId: number;
  companyId: bigint | string;
  employeeId: bigint | string;
  employeeUserId: number;
  ttlMinutes?: number;
}): { rawToken: string; expiresAt: Date } {
  const ttlMinutes = clampTtlMinutes(input.ttlMinutes);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
  const body: TokenBody = {
    actorUserId: input.actorUserId,
    companyId: String(input.companyId),
    employeeId: String(input.employeeId),
    employeeUserId: input.employeeUserId,
    exp: expiresAt.getTime(),
  };
  const encodedPayload = toBase64Url(JSON.stringify(body));
  const signature = signPayload(encodedPayload);
  return { rawToken: `${encodedPayload}.${signature}`, expiresAt };
}

function parseAndVerifyTokenSignature(rawToken: string): TokenBody | null {
  const trimmed = rawToken.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(".");
  if (parts.length !== 2) return null;
  const [encodedPayload, signature] = parts;
  if (!encodedPayload || !signature) return null;

  const expected = signPayload(encodedPayload);
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const parsed = JSON.parse(fromBase64Url(encodedPayload)) as TokenBody;
    if (
      !Number.isFinite(parsed.actorUserId) ||
      !Number.isFinite(parsed.employeeUserId) ||
      !Number.isFinite(parsed.exp) ||
      typeof parsed.companyId !== "string" ||
      typeof parsed.employeeId !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function getCompanyActingTokenFromRequest(
  request: NextRequest,
): { token: string | null; source: CompanyActingTokenSource | null } {
  const headerValue = request.headers.get(COMPANY_ACTING_HEADER_NAME)?.trim();
  if (headerValue) {
    return { token: headerValue, source: "header" };
  }

  const cookieValue = request.cookies.get(COMPANY_ACTING_COOKIE_NAME)?.value?.trim();
  if (cookieValue) {
    return { token: cookieValue, source: "cookie" };
  }

  return { token: null, source: null };
}

export async function validateCompanyActingToken(params: {
  rawToken: string;
  actorUserId: number;
  source: CompanyActingTokenSource;
}): Promise<CompanyActingPayload | null> {
  const body = parseAndVerifyTokenSignature(params.rawToken);
  if (!body) return null;
  if (body.exp <= Date.now()) return null;
  if (body.actorUserId !== params.actorUserId) return null;

  let companyId: bigint;
  let employeeId: bigint;
  try {
    companyId = BigInt(body.companyId);
    employeeId = BigInt(body.employeeId);
  } catch {
    return null;
  }

  const employee = await prisma.companyEmployee.findFirst({
    where: {
      employee_id: employeeId,
      company_id: companyId,
      user_id: BigInt(body.employeeUserId),
    },
    select: {
      employee_id: true,
      user_id: true,
      role: true,
    },
  });

  if (!employee) return null;

  const actorMembership = await prisma.companyEmployee.findFirst({
    where: {
      company_id: companyId,
      user_id: BigInt(params.actorUserId),
      is_active: true,
      role: { in: ["admin", "manager"] },
    },
    select: { employee_id: true },
  });

  // Primary company admin may be company.admin_id without a matching role row in some edge cases.
  if (!actorMembership) {
    const company = await prisma.company.findUnique({
      where: { company_id: companyId },
      select: { admin_id: true, created_by: true },
    });
    const isPrimary =
      company?.admin_id === BigInt(params.actorUserId) ||
      (company?.admin_id == null && company?.created_by === BigInt(params.actorUserId));
    if (!isPrimary) return null;
  }

  return {
    actorUserId: body.actorUserId,
    companyId: body.companyId,
    employeeId: body.employeeId,
    employeeUserId: Number(employee.user_id),
    expiresAt: new Date(body.exp),
    source: params.source,
  };
}

export function attachCompanyActingCookie(
  response: NextResponse,
  rawToken: string,
  expiresAt: Date,
): void {
  const maxAgeSeconds = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  response.cookies.set(
    COMPANY_ACTING_COOKIE_NAME,
    rawToken,
    getActingCookieOptions(maxAgeSeconds),
  );
  response.cookies.set(
    COMPANY_ACTING_HANDOFF_COOKIE_NAME,
    rawToken,
    getHandoffCookieOptions(maxAgeSeconds),
  );
}

export function clearCompanyActingCookie(response: NextResponse): void {
  response.cookies.set(COMPANY_ACTING_COOKIE_NAME, "", getActingCookieOptions(0));
  response.cookies.set(COMPANY_ACTING_HANDOFF_COOKIE_NAME, "", getHandoffCookieOptions(0));
}

/** Clear acting cookies via Next.js `cookies()` store (logout path). */
export async function clearCompanyActingCookiesFromStore(
  cookieStore: Awaited<ReturnType<typeof import("next/headers").cookies>>,
): Promise<void> {
  cookieStore.set(COMPANY_ACTING_COOKIE_NAME, "", getActingCookieOptions(0));
  cookieStore.set(COMPANY_ACTING_HANDOFF_COOKIE_NAME, "", getHandoffCookieOptions(0));
}
