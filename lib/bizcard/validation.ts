import { sanitizeString } from "@/server/lib/validators";
import { htmlToPlainText, normalizeDisplayText } from "@/app/lib/plainText";

function sanitizePersonText(input: unknown): string | null {
  const raw = sanitizeString(input);
  if (!raw) return null;
  const normalized = normalizeDisplayText(raw);
  return normalized.length > 0 ? normalized : null;
}

function sanitizeAboutText(input: unknown): string | null {
  const raw = sanitizeString(input);
  if (!raw) return null;
  const plain = htmlToPlainText(raw);
  return plain.length > 0 ? plain : null;
}

const URI_ALIAS_REGEX = /^[a-z0-9][a-z0-9-]{1,98}[a-z0-9]$/;
const ALLOWED_SORT_BY = new Set(["created_at", "updated_at", "bizcard_name"]);
const ALLOWED_SORT_DIR = new Set(["asc", "desc"]);
const ALLOWED_STATUS = new Set(["active", "deactivated", "all"]);
const ALLOWED_SEARCH_IN = new Set(["name", "first_name", "last_name", "all"]);

export interface BizcardListParams {
  page: number;
  limit: number;
  sortBy: "created_at" | "updated_at" | "bizcard_name";
  sortDir: "asc" | "desc";
  status: "active" | "deactivated" | "all";
}

export interface BizcardSearchParams {
  q: string;
  page: number;
  limit: number;
  searchIn: "name" | "first_name" | "last_name" | "all";
}

export interface BizcardCreateInput {
  bizcard_name: string;
  url_alias: string | null;
  description: string | null;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  professional_title: string | null;
  email: string;
  contact_number: string;
  city: string;
  bizcard_type: "virtual" | "physical";
  copy_from: string | null;
}

export interface BizcardUpdateInput {
  bizcard_name?: string;
  url_alias?: string;
  description?: string | null;
  first_name?: string;
  middle_name?: string | null;
  last_name?: string;
  professional_title?: string | null;
  occupation?: string | null;
  post_nominal?: string | null;
  suffix?: string | null;
  area?: string | null;
  baranggay?: string | null;
  city?: string;
  zip_code?: number | null;
  region?: string | null;
  address_link?: string | null;
  bio?: string | null;
  email?: string;
  contact_number?: string;
  alt_email?: string | null;
  alt_contact_number?: string | null;
  languages?: string | null;
  profile_img?: string | null;
  cover_img?: string | null;
  bizcard_theme?: string | null;
  bizcard_type?: "virtual" | "physical";
}

export function parseBizcardListParams(params: URLSearchParams): BizcardListParams {
  const pageRaw = Number(params.get("page") ?? 1);
  const limitRaw = Number(params.get("limit") ?? 10);
  const sortByRaw = (params.get("sort_by") ?? "created_at").toLowerCase();
  const sortDirRaw = (params.get("sort_dir") ?? "desc").toLowerCase();
  const statusRaw = (params.get("status") ?? "active").toLowerCase();

  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
  const limit = Number.isFinite(limitRaw) ? Math.min(50, Math.max(1, Math.floor(limitRaw))) : 10;

  const sortBy = (ALLOWED_SORT_BY.has(sortByRaw) ? sortByRaw : "created_at") as BizcardListParams["sortBy"];
  const sortDir = (ALLOWED_SORT_DIR.has(sortDirRaw) ? sortDirRaw : "desc") as BizcardListParams["sortDir"];
  const status = (ALLOWED_STATUS.has(statusRaw) ? statusRaw : "active") as BizcardListParams["status"];

  return { page, limit, sortBy, sortDir, status };
}

export function parseBizcardSearchParams(params: URLSearchParams): { valid: boolean; errors: string[]; data: BizcardSearchParams } {
  const errors: string[] = [];
  const q = sanitizeString(params.get("q")) ?? "";
  if (!q) errors.push("q is required.");

  const pageRaw = Number(params.get("page") ?? 1);
  const limitRaw = Number(params.get("limit") ?? 20);
  const searchInRaw = (params.get("search_in") ?? "all").toLowerCase();

  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
  const limit = Number.isFinite(limitRaw) ? Math.min(50, Math.max(1, Math.floor(limitRaw))) : 20;
  const searchIn = (ALLOWED_SEARCH_IN.has(searchInRaw) ? searchInRaw : "all") as BizcardSearchParams["searchIn"];

  return { valid: errors.length === 0, errors, data: { q, page, limit, searchIn } };
}

export function validateBizcardCreateInput(body: Record<string, unknown>): { valid: boolean; errors: string[]; data: BizcardCreateInput } {
  const errors: string[] = [];

  const firstName = sanitizePersonText(body.first_name);
  const lastName = sanitizePersonText(body.last_name);
  const bizcardName = sanitizePersonText(body.bizcard_name);
  const email = sanitizeString(body.email)?.toLowerCase() ?? null;
  const contact = sanitizeString(body.contact_number);
  const city = sanitizePersonText(body.city) ?? "";

  if (!firstName) errors.push("first_name is required.");
  if (!lastName) errors.push("last_name is required.");
  if (!bizcardName) errors.push("bizcard_name is required.");
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("email is required and must be valid.");
  if (!contact) errors.push("contact_number is required.");

  const aliasRaw = sanitizeString(body.url_alias);
  if (aliasRaw && !URI_ALIAS_REGEX.test(aliasRaw)) {
    errors.push("url_alias must be lowercase alphanumeric and hyphen format.");
  }

  const bizcardTypeRaw = sanitizeString(body.bizcard_type)?.toLowerCase();
  const bizcardType = (bizcardTypeRaw === "physical" ? "physical" : "virtual") as "virtual" | "physical";

  const copyFrom = sanitizeString(body.copy_from);

  return {
    valid: errors.length === 0,
    errors,
    data: {
      bizcard_name: bizcardName ?? "",
      url_alias: aliasRaw ?? null,
      description: sanitizeAboutText(body.description),
      first_name: firstName ?? "",
      middle_name: sanitizePersonText(body.middle_name),
      last_name: lastName ?? "",
      professional_title: sanitizePersonText(body.professional_title),
      email: email ?? "",
      contact_number: contact ?? "",
      city,
      bizcard_type: bizcardType,
      copy_from: copyFrom,
    },
  };
}

export function validateBizcardUpdateInput(body: Record<string, unknown>): { valid: boolean; errors: string[]; data: BizcardUpdateInput } {
  const errors: string[] = [];
  const data: BizcardUpdateInput = {};

  const stringFields: Array<keyof BizcardUpdateInput> = [
    "bizcard_name",
    "description",
    "first_name",
    "middle_name",
    "last_name",
    "professional_title",
    "occupation",
    "post_nominal",
    "suffix",
    "area",
    "baranggay",
    "city",
    "region",
    "address_link",
    "bio",
    "email",
    "contact_number",
    "alt_email",
    "alt_contact_number",
    "languages",
    "profile_img",
    "cover_img",
    "bizcard_theme",
  ];

  const aboutFields = new Set<keyof BizcardUpdateInput>(["description", "bio"]);
  const personFields = new Set<keyof BizcardUpdateInput>([
    "bizcard_name",
    "first_name",
    "middle_name",
    "last_name",
    "professional_title",
    "occupation",
    "post_nominal",
    "suffix",
    "area",
    "baranggay",
    "city",
    "region",
    "languages",
  ]);

  for (const key of stringFields) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      let value: string | null;
      if (aboutFields.has(key)) value = sanitizeAboutText(body[key]);
      else if (personFields.has(key)) value = sanitizePersonText(body[key]);
      else value = sanitizeString(body[key]);
      (data as Record<string, unknown>)[key] = value ?? null;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "url_alias")) {
    const alias = sanitizeString(body.url_alias);
    if (alias && !URI_ALIAS_REGEX.test(alias)) {
      errors.push("url_alias must be lowercase alphanumeric and hyphen format.");
    }
    data.url_alias = alias ?? undefined;
  }

  if (Object.prototype.hasOwnProperty.call(body, "zip_code")) {
    if (body.zip_code === null) {
      data.zip_code = null;
    } else {
      const parsed = Number(body.zip_code);
      if (!Number.isFinite(parsed) || parsed < 0) {
        errors.push("zip_code must be a positive number.");
      } else {
        data.zip_code = Math.floor(parsed);
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "bizcard_type")) {
    const bizcardType = sanitizeString(body.bizcard_type)?.toLowerCase();
    if (bizcardType !== "virtual" && bizcardType !== "physical") {
      errors.push("bizcard_type must be virtual or physical.");
    } else {
      data.bizcard_type = bizcardType;
    }
  }

  return { valid: errors.length === 0, errors, data };
}

export function computeSimpleMatchScore(source: string, query: string): number {
  const sourceLower = source.toLowerCase();
  const queryLower = query.toLowerCase();
  if (!sourceLower || !queryLower) return 0;
  if (sourceLower === queryLower) return 1;
  if (sourceLower.startsWith(queryLower)) return 0.95;
  if (sourceLower.includes(queryLower)) return 0.85;

  let matchedChars = 0;
  for (const char of queryLower) {
    if (sourceLower.includes(char)) matchedChars += 1;
  }
  return Math.max(0, Math.min(0.8, matchedChars / queryLower.length));
}

export function buildHighlight(text: string | null | undefined, query: string): string | null {
  if (!text) return null;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!escaped) return text;
  const pattern = new RegExp(`(${escaped})`, "ig");
  return text.replace(pattern, "<mark>$1</mark>");
}
