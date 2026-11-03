'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Mail, Phone, PhoneCall, Plus, X } from 'lucide-react';
import {
  type ContactEntry,
  type ContactFieldValues,
  type ContactKind,
  MAX_CONTACT_ENTRIES,
  MAX_CONTACTS_PER_KIND,
  contactFieldsFromEntries,
  contactKindLabel,
  countKinds,
  createContactEntryId,
  detectContactKind,
  entriesFromContactFields,
  entryError,
  formatContactInput,
  validateContactEntries,
} from '@/app/lib/contactDetails';
import { showConfirmDialog } from './ConfirmDialog';

type ContactDetailsEditorProps = {
  values: ContactFieldValues;
  onChange: (next: ContactFieldValues) => void;
  /** When true, submit-time validation requires ≥1 email. */
  requireEmail?: boolean;
  /** Optional external error (e.g. from parent form submit). */
  error?: string | null;
  className?: string;
  /** Visual density for setup wizard vs edit tab. */
  variant?: 'setup' | 'edit';
};

function KindIcon({ kind }: { kind: ContactKind | null }) {
  if (kind === 'email') return <Mail className="h-4 w-4 text-orange-500" />;
  if (kind === 'phone') return <Phone className="h-4 w-4 text-green-600" />;
  if (kind === 'telephone') return <PhoneCall className="h-4 w-4 text-blue-600" />;
  return <Phone className="h-4 w-4 text-gray-400" />;
}

function inputModeFor(kind: ContactKind | null): 'email' | 'tel' | 'text' {
  if (kind === 'email') return 'email';
  if (kind) return 'tel';
  return 'text';
}

function autoCompleteFor(kind: ContactKind | null): string {
  if (kind === 'email') return 'email';
  if (kind === 'phone') return 'tel';
  return 'off';
}

function placeholderFor(kind: ContactKind | null): string {
  if (kind === 'email') return 'email@example.com';
  if (kind === 'phone') return '9XX XXX XXXX';
  if (kind === 'telephone') return '02 XXXX XXXX';
  return 'Email, phone, or telephone…';
}

function syncKey(values: ContactFieldValues): string {
  return [
    values.email,
    values.alternativeEmail,
    values.contactNumber,
    values.secondaryNumber,
    values.telephoneNumber,
    values.altTelephoneNumber,
  ].join('\u0001');
}

export function ContactDetailsEditor({
  values,
  onChange,
  requireEmail = false,
  error = null,
  className = '',
  variant = 'edit',
}: ContactDetailsEditorProps) {
  const [entries, setEntries] = useState<ContactEntry[]>(() => entriesFromContactFields(values));
  const lastEmittedKey = useRef(syncKey(values));
  /**
   * Keyboard-affecting attributes (inputMode / autoComplete) are frozen for the focused row.
   * Mobile browsers dismiss or swap the on-screen keyboard when they change mid-typing,
   * which happens as auto-detection flips between email / phone / telephone.
   */
  const [focused, setFocused] = useState<{ id: string; kind: ContactKind | null } | null>(null);
  const inputClass =
    variant === 'setup'
      ? 'w-full pr-10 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors'
      : 'w-full border border-gray-200 rounded-xl pr-10 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors';

  // Hydrate from parent when saved values change externally (load / reset).
  useEffect(() => {
    const key = syncKey(values);
    if (key === lastEmittedKey.current) return;
    lastEmittedKey.current = key;
    // Reuse row ids so a resync never remounts (and blurs) an input that's being edited.
    setEntries((prev) =>
      entriesFromContactFields(values).map((entry, i) =>
        prev[i] ? { ...entry, id: prev[i].id } : entry,
      ),
    );
  }, [values]);

  const emit = (nextEntries: ContactEntry[]) => {
    setEntries(nextEntries);
    const nextValues = contactFieldsFromEntries(nextEntries);
    lastEmittedKey.current = syncKey(nextValues);
    onChange(nextValues);
  };

  const counts = useMemo(() => countKinds(entries.filter((e) => e.value.trim())), [entries]);
  const canAdd = entries.length < MAX_CONTACT_ENTRIES && (
    counts.email < MAX_CONTACTS_PER_KIND ||
    counts.phone < MAX_CONTACTS_PER_KIND ||
    counts.telephone < MAX_CONTACTS_PER_KIND ||
    entries.some((e) => !e.value.trim())
  );

  const addContact = () => {
    if (!canAdd) return;
    // Don't add another blank if one already exists
    if (entries.some((e) => !e.value.trim())) return;
    emit([...entries, { id: createContactEntryId(), value: '' }]);
  };

  const removeAt = async (index: number) => {
    const entry = entries[index];
    if (!entry) return;

    // Empty draft rows can be dismissed without a prompt.
    if (entry.value.trim()) {
      const kind = detectContactKind(entry.value);
      const label = contactKindLabel(kind).toLowerCase();
      const confirmed = await showConfirmDialog({
        title: 'Remove contact',
        message: `Remove this ${label} (${entry.value.trim()}) from your bizcard?`,
        confirmLabel: 'Remove',
        cancelLabel: 'Cancel',
        variant: 'danger',
      });
      if (!confirmed) return;
    }

    emit(entries.filter((_, i) => i !== index));
  };

  const updateAt = (index: number, raw: string) => {
    const kind = detectContactKind(raw);
    const formatted = formatContactInput(kind, raw);
    const next = entries.map((entry, i) => (i === index ? { ...entry, value: formatted } : entry));

    // If this would exceed the max for the detected kind, keep the value but surface error via entryError
    emit(next);
  };

  const atCapacity =
    counts.email >= MAX_CONTACTS_PER_KIND &&
    counts.phone >= MAX_CONTACTS_PER_KIND &&
    counts.telephone >= MAX_CONTACTS_PER_KIND;

  return (
    <div className={`space-y-3 ${className}`}>
      <p className="text-xs text-gray-500">
        Add up to {MAX_CONTACTS_PER_KIND} emails, {MAX_CONTACTS_PER_KIND} phone numbers, and{' '}
        {MAX_CONTACTS_PER_KIND} telephone numbers. The field detects the type as you type.
      </p>

      {entries.length === 0 && (
        <p className="text-sm text-gray-500 rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center">
          No contacts yet. Click &ldquo;Add Contact&rdquo; to get started.
        </p>
      )}

      <ul className="space-y-3">
        {entries.map((entry, index) => {
          const kind = detectContactKind(entry.value);
          const fieldError = entryError(entries, index);
          const showPrefix = kind === 'phone';
          const keyboardKind = focused?.id === entry.id ? focused.kind : kind;

          return (
            <li key={entry.id}>
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs font-semibold text-gray-600">
                  {contactKindLabel(kind)}
                  {kind ? (
                    <span className="ml-1.5 font-normal text-gray-400">detected</span>
                  ) : (
                    <span className="ml-1.5 font-normal text-gray-400">auto-detect</span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => void removeAt(index)}
                  className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                  aria-label="Remove contact"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Same element tree for every kind — only text and padding change while typing. */}
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none flex items-center gap-1.5 text-sm font-semibold text-gray-600">
                  <KindIcon kind={kind} />
                  {showPrefix ? '+63' : null}
                </span>
                <input
                  type="text"
                  inputMode={inputModeFor(keyboardKind)}
                  autoComplete={autoCompleteFor(keyboardKind)}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={entry.value}
                  onFocus={() => setFocused({ id: entry.id, kind })}
                  onBlur={() => setFocused((current) => (current?.id === entry.id ? null : current))}
                  onChange={(e) => updateAt(index, e.target.value)}
                  placeholder={placeholderFor(kind)}
                  className={`${inputClass} ${showPrefix ? 'pl-[4.5rem]' : 'pl-10'} ${
                    fieldError ? 'border-red-300 focus:border-red-400 focus:ring-red-200' : ''
                  }`}
                />
              </div>
              {fieldError && <p className="mt-1 text-xs text-red-600">{fieldError}</p>}
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={addContact}
        disabled={atCapacity || !canAdd || entries.some((e) => !e.value.trim())}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#2D3A8C] hover:text-[#243080] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <Plus className="h-4 w-4" />
        Add Contact
      </button>

      {atCapacity && (
        <p className="text-xs text-gray-500">
          Maximum reached ({MAX_CONTACTS_PER_KIND} of each type).
        </p>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

/** Validate current field values (maps through entries). For parent form submit. */
export function validateContactFieldValues(
  values: ContactFieldValues,
  opts?: { requireEmail?: boolean },
): string | null {
  return validateContactEntries(entriesFromContactFields(values), opts);
}

export default ContactDetailsEditor;
