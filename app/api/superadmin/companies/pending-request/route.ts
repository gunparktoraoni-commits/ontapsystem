// Back-compat alias: older clients called /pending-request (singular),
// which incorrectly matched /companies/[companyId] and returned 400.
export { GET } from "../pending-requests/route";
