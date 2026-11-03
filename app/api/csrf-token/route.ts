import { NextResponse } from "next/server";
import { generateCsrfToken, setCsrfCookie } from "@/lib/csrf";

export async function GET() {
  const token = generateCsrfToken();
  const response = NextResponse.json({ token, csrfToken: token });
  setCsrfCookie(response, token);
  return response;
}
