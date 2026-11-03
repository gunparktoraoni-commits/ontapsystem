export type BizcardValidationError = {
  field: string;
  message: string;
};

export function validateBizcardInput(input: Record<string, unknown>): BizcardValidationError[] {
  const errors: BizcardValidationError[] = [];

  const requiredStrings = [
    "bizcard_name",
    "first_name",
    "last_name",
    "email",
    "contact_number",
  ];

  for (const field of requiredStrings) {
    const value = input[field];
    if (typeof value !== "string" || value.trim().length === 0) {
      errors.push({ field, message: `${field} is required.` });
    }
  }

  const city = input.city;
  if (city !== undefined && city !== null && (typeof city !== "string" || city.trim().length === 0)) {
    errors.push({ field: "city", message: "city must be a non-empty string when provided." });
  }

  const email = typeof input.email === "string" ? input.email.trim() : "";
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push({ field: "email", message: "email format is invalid." });
  }

  const urlAlias = input.url_alias;
  if (urlAlias !== undefined && urlAlias !== null) {
    const valid = typeof urlAlias === "string" && /^[a-z0-9][a-z0-9-]{1,98}[a-z0-9]$/.test(urlAlias);
    if (!valid) {
      errors.push({ field: "url_alias", message: "url_alias must match lowercase slug format." });
    }
  }

  return errors;
}
