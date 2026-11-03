import { companyAdminApiRequest } from "./companyAdminApi";
import {
  buildCompanyActingHeaders,
  clearCompanyActingHandoff,
  persistCompanyActingHandoff,
  readCompanyActingToken,
  withCompanyActingHeaders,
} from "@/app/lib/companyEmployeeActingHandoff";

export {
  buildCompanyActingHeaders,
  clearCompanyActingHandoff,
  persistCompanyActingHandoff,
  readCompanyActingToken,
  withCompanyActingHeaders,
};

export async function startCompanyEmployeeActingContext(employeeId: string): Promise<{
  token: string;
  userId: string;
  expiresAt: string;
}> {
  const payload = await companyAdminApiRequest(
    `/api/company/employees/${encodeURIComponent(employeeId)}/acting-context`,
    { method: "POST" },
  );

  const data =
    (payload as { data?: Record<string, unknown> }).data ??
    (payload as Record<string, unknown>);

  const token = String(data.token ?? "").trim();
  const userId = String(data.user_id ?? "").trim();
  const expiresAt = String(data.expires_at ?? "").trim();

  if (!token) {
    throw new Error("Failed to start employee BizCard acting context.");
  }

  persistCompanyActingHandoff(token, employeeId, userId || undefined);
  return { token, userId, expiresAt };
}

export async function clearCompanyEmployeeActingContext(employeeId: string): Promise<void> {
  try {
    await companyAdminApiRequest(
      `/api/company/employees/${encodeURIComponent(employeeId)}/acting-context`,
      { method: "DELETE" },
    );
  } catch {
    // Best-effort clear — always drop client handoff.
  } finally {
    clearCompanyActingHandoff();
  }
}
