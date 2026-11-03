/**
 * Contact detail detection, formatting, validation, and field mapping
 * for bizcard setup / edit (email, mobile phone, telephone/landline).
 */

export type ContactKind = 'email' | 'phone' | 'telephone';

export type ContactEntry = {
  id: string;
  value: string;
};

export type ContactFieldValues = {
  email: string;
  alternativeEmail: string;
  contactNumber: string;
  secondaryNumber: string;
  telephoneNumber: string;
  altTelephoneNumber: string;
};

export const MAX_CONTACTS_PER_KIND = 2;
export const MAX_CONTACT_ENTRIES = MAX_CONTACTS_PER_KIND * 3;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function createContactEntryId(): string {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function nationalDigits(digits: string): string {
  if (digits.startsWith('63') && digits.length >= 11) return digits.slice(2);
  if (digits.startsWith('0') && digits.length >= 8) return digits.slice(1);
  return digits;
}

/** Digits only, used for phone / telephone comparison and storage helpers. */
export function contactDigitsOnly(value: string): string {
  return String(value ?? '').replace(/\D/g, '');
}

/**
 * Auto-detect whether input is email, mobile phone, or telephone.
 * Returns null while the value is empty or still ambiguous.
 */
export function detectContactKind(input: string): ContactKind | null {
  const trimmed = String(input ?? '').trim();
  if (!trimmed) return null;

  // Letters / @ → email (even mid-typing: "john", "john@")
  if (/[a-zA-Z@]/.test(trimmed)) {
    return 'email';
  }

  const digits = contactDigitsOnly(trimmed);
  if (!digits) return null;

  const national = nationalDigits(digits);

  // PH mobile national numbers start with 9
  if (national.startsWith('9') || digits.startsWith('09') || (digits.startsWith('639') && digits.length >= 3)) {
    return 'phone';
  }

  return 'telephone';
}

export function formatPhoneInput(raw: string): string {
  let digits = contactDigitsOnly(raw);
  if (digits.startsWith('63') && digits.length >= 3) digits = digits.slice(2);
  if (digits.startsWith('0') && digits.length >= 2) digits = digits.slice(1);
  if (digits.length > 0 && digits[0] !== '9') {
    // Keep only if still empty / correcting; drop invalid leading digit
    digits = digits.replace(/^[^9]+/, '');
  }
  digits = digits.slice(0, 10);
  return digits.replace(/(\d{3})(\d{0,3})(\d{0,4})/, (_, a: string, b: string, c: string) =>
    [a, b, c].filter(Boolean).join(' '),
  );
}

export function formatTelephoneInput(raw: string): string {
  const digits = contactDigitsOnly(raw).slice(0, 12);
  if (!digits) return '';

  // Metro Manila style: 02 XXXX XXXX
  if (digits.startsWith('02')) {
    const rest = digits.slice(2);
    const parts = [rest.slice(0, 4), rest.slice(4, 8)].filter(Boolean);
    return parts.length ? `02 ${parts.join(' ')}`.trim() : '02';
  }

  // Leading trunk 0 + area code (03X / 0XX)
  if (digits.startsWith('0') && digits.length >= 3) {
    const area = digits.slice(0, 3);
    const rest = digits.slice(3);
    const parts = [rest.slice(0, 3), rest.slice(3, 7)].filter(Boolean);
    return parts.length ? `${area} ${parts.join(' ')}`.trim() : area;
  }

  // Local / other: groups of 3–4
  return digits.replace(/(\d{3,4})(?=\d)/g, '$1 ').trim();
}

export function formatContactInput(kind: ContactKind | null, raw: string): string {
  if (kind === 'phone') return formatPhoneInput(raw);
  if (kind === 'telephone') return formatTelephoneInput(raw);
  if (kind === 'email') return raw.replace(/\s+/g, '');
  // Unknown: allow digits/spaces/+()- or free text toward email
  return raw;
}

export function normalizeContactKey(kind: ContactKind, value: string): string {
  if (kind === 'email') return value.trim().toLowerCase();
  return nationalDigits(contactDigitsOnly(value));
}

export function validateContactValue(
  kind: ContactKind | null,
  value: string,
  opts?: { allowIncomplete?: boolean },
): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!kind) return 'Enter an email, phone, or telephone number.';

  if (kind === 'email') {
    if (opts?.allowIncomplete && !trimmed.includes('@')) return null;
    if (!EMAIL_RE.test(trimmed.toLowerCase())) return 'Enter a valid email address.';
    if (trimmed.length > 255) return 'Email must not exceed 255 characters.';
    return null;
  }

  const digits = contactDigitsOnly(trimmed);
  const national = nationalDigits(digits);

  if (kind === 'phone') {
    if (opts?.allowIncomplete && national.length < 10) {
      if (national.length > 0 && !national.startsWith('9')) {
        return 'Mobile numbers must start with 9.';
      }
      return null;
    }
    if (!national.startsWith('9') || national.length !== 10) {
      return 'Enter a valid 10-digit mobile number starting with 9.';
    }
    return null;
  }

  // telephone
  if (opts?.allowIncomplete && digits.length < 7) return null;
  if (digits.length < 7 || digits.length > 12) {
    return 'Enter a valid telephone number (7–12 digits).';
  }
  return null;
}

export function countKinds(entries: ContactEntry[]): Record<ContactKind, number> {
  const counts: Record<ContactKind, number> = { email: 0, phone: 0, telephone: 0 };
  for (const entry of entries) {
    const kind = detectContactKind(entry.value);
    if (kind) counts[kind] += 1;
  }
  return counts;
}

export function findDuplicateContactError(
  entries: ContactEntry[],
  index: number,
): string | null {
  const current = entries[index];
  if (!current) return null;
  const kind = detectContactKind(current.value);
  if (!kind) return null;
  const key = normalizeContactKey(kind, current.value);
  if (!key) return null;

  for (let i = 0; i < entries.length; i += 1) {
    if (i === index) continue;
    const other = entries[i];
    const otherKind = detectContactKind(other.value);
    if (otherKind !== kind) continue;
    if (normalizeContactKey(otherKind, other.value) === key) {
      return `This ${kind === 'email' ? 'email' : kind === 'phone' ? 'phone number' : 'telephone number'} is already added.`;
    }
  }
  return null;
}

export function entryError(entries: ContactEntry[], index: number, opts?: { strict?: boolean }): string | null {
  const entry = entries[index];
  if (!entry) return null;
  const value = entry.value.trim();
  if (!value) return opts?.strict ? 'This field is empty. Remove it or enter a contact.' : null;

  const kind = detectContactKind(value);
  const dup = findDuplicateContactError(entries, index);
  if (dup) return dup;

  const counts = countKinds(entries);
  if (kind && counts[kind] > MAX_CONTACTS_PER_KIND) {
    const label = kind === 'email' ? 'emails' : kind === 'phone' ? 'phone numbers' : 'telephone numbers';
    return `You can add up to ${MAX_CONTACTS_PER_KIND} ${label}.`;
  }

  return validateContactValue(kind, value, { allowIncomplete: !opts?.strict });
}

export function validateContactEntries(
  entries: ContactEntry[],
  opts?: { requireEmail?: boolean },
): string | null {
  const filled = entries.filter((e) => e.value.trim());
  for (let i = 0; i < entries.length; i += 1) {
    if (!entries[i].value.trim()) {
      if (entries.length > 0 && filled.length < entries.length) {
        // Allow empty drafts only if we don't require strict empty check on all —
        // treat empty rows as removable noise on submit.
        continue;
      }
    }
    if (!entries[i].value.trim()) continue;
    const err = entryError(entries, i, { strict: true });
    if (err) return err;
  }

  const counts = countKinds(filled);
  if (counts.email > MAX_CONTACTS_PER_KIND) return `You can add up to ${MAX_CONTACTS_PER_KIND} emails.`;
  if (counts.phone > MAX_CONTACTS_PER_KIND) return `You can add up to ${MAX_CONTACTS_PER_KIND} phone numbers.`;
  if (counts.telephone > MAX_CONTACTS_PER_KIND) {
    return `You can add up to ${MAX_CONTACTS_PER_KIND} telephone numbers.`;
  }

  if (opts?.requireEmail && counts.email < 1) {
    return 'Add at least one email address.';
  }

  return null;
}

export function stripPhoneCountryPrefix(value: string): string {
  return String(value ?? '')
    .replace(/^\+63/, '')
    .replace(/^63/, '')
    .trim();
}

export function entriesFromContactFields(values: ContactFieldValues): ContactEntry[] {
  const entries: ContactEntry[] = [];
  const push = (raw: string, kindHint?: ContactKind) => {
    const value = String(raw ?? '').trim();
    if (!value) return;
    let display = value;
    if (kindHint === 'phone' || (!kindHint && detectContactKind(stripPhoneCountryPrefix(value)) === 'phone')) {
      display = formatPhoneInput(stripPhoneCountryPrefix(value));
    } else if (kindHint === 'telephone' || detectContactKind(value) === 'telephone') {
      display = formatTelephoneInput(value);
    } else if (kindHint === 'email' || detectContactKind(value) === 'email') {
      display = value;
    }
    entries.push({ id: createContactEntryId(), value: display });
  };

  push(values.email, 'email');
  push(values.alternativeEmail, 'email');
  push(values.contactNumber, 'phone');
  push(values.secondaryNumber, 'phone');
  push(values.telephoneNumber, 'telephone');
  push(values.altTelephoneNumber, 'telephone');
  return entries;
}

export function contactFieldsFromEntries(entries: ContactEntry[]): ContactFieldValues {
  const emails: string[] = [];
  const phones: string[] = [];
  const telephones: string[] = [];

  for (const entry of entries) {
    const value = entry.value.trim();
    if (!value) continue;
    const kind = detectContactKind(value);
    if (kind === 'email') emails.push(value.toLowerCase());
    else if (kind === 'phone') phones.push(formatPhoneInput(value));
    else if (kind === 'telephone') telephones.push(formatTelephoneInput(value));
  }

  return {
    email: emails[0] ?? '',
    alternativeEmail: emails[1] ?? '',
    contactNumber: phones[0] ?? '',
    secondaryNumber: phones[1] ?? '',
    telephoneNumber: telephones[0] ?? '',
    altTelephoneNumber: telephones[1] ?? '',
  };
}

/** Persist mobile as +63XXXXXXXXXX */
export function normalizeMobileForApi(value: string): string {
  const national = formatPhoneInput(value).replace(/\s+/g, '');
  if (!national) return '';
  return `+63${national}`;
}

/** Persist telephone as compact digits (keep leading 0 when present). */
export function normalizeTelephoneForApi(value: string): string {
  return contactDigitsOnly(value).slice(0, 12);
}

export function contactKindLabel(kind: ContactKind | null): string {
  if (kind === 'email') return 'Email';
  if (kind === 'phone') return 'Phone';
  if (kind === 'telephone') return 'Telephone';
  return 'Contact';
}
