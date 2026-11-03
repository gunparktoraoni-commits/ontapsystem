import { NextRequest } from "next/server";
import { POST as createCompanyRequest } from "@/app/api/company/create/route";

// Backward-compatible alias for legacy clients.
// New clients should call POST /api/company/create directly.
export async function POST(request: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    // Let create route validator produce canonical error response.
  }

  const normalizedBody: Record<string, unknown> = {
    company_name: body.company_name ?? body.name,
    description: body.description,
    logo_url: body.logo_url ?? body.logoUrl,
    subscription_tier: body.subscription_tier ?? "premium",
  };

  const normalizedRequest = new NextRequest(request.url, {
    method: request.method,
    headers: request.headers,
    body: JSON.stringify(normalizedBody),
  });

  return createCompanyRequest(normalizedRequest);
}
