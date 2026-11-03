"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Bold, Italic, Underline } from "lucide-react";

type RichTextEditorProps = {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
};

type ToolbarButton = {
  command: "bold" | "italic" | "underline";
  label: string;
  Icon: typeof Bold;
};

const TOOLBAR: ToolbarButton[] = [
  { command: "bold", label: "Bold", Icon: Bold },
  { command: "italic", label: "Italic", Icon: Italic },
  { command: "underline", label: "Underline", Icon: Underline },
];

/**
 * Lightweight rich-text editor for portfolio About/Bio and Services details.
 * Supports bold / italic / underline and preserves spaces + line breaks.
 * Emits an HTML string; the value is sanitized to a safe allowlist on save
 * and again on render (see app/lib/richText.ts).
 */
export function RichTextEditor({
  value,
  onChange,
  placeholder,
  rows = 4,
  disabled = false,
  className,
  ariaLabel,
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef<string>(value ?? "");
  const [isEmpty, setIsEmpty] = useState(!value || !value.trim());

  // Sync external value into the editor without clobbering the caret mid-edit.
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const incoming = value ?? "";
    if (incoming === lastEmitted.current) return;
    if (typeof document !== "undefined" && document.activeElement === el) return;
    el.innerHTML = incoming;
    lastEmitted.current = incoming;
    setIsEmpty(!el.textContent?.trim() && !el.querySelector("img,br + br"));
  }, [value]);

  // Initialize once on mount.
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    el.innerHTML = value ?? "";
    setIsEmpty(!el.textContent?.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emit = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const html = el.innerHTML;
    lastEmitted.current = html;
    setIsEmpty(!el.textContent?.trim());
    onChange(html);
  }, [onChange]);

  const runCommand = useCallback(
    (command: ToolbarButton["command"]) => {
      if (disabled) return;
      const el = editorRef.current;
      el?.focus();
      try {
        document.execCommand(command, false);
      } catch {
        // execCommand unsupported — ignore; typing still works.
      }
      emit();
    },
    [disabled, emit],
  );

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      // Insert as plain text to avoid importing foreign styles/markup.
      event.preventDefault();
      const text = event.clipboardData.getData("text/plain");
      try {
        document.execCommand("insertText", false, text);
      } catch {
        /* noop */
      }
      emit();
    },
    [emit],
  );

  const minHeight = `${Math.max(2, rows) * 1.6}em`;

  return (
    <div
      className={
        className ??
        "rounded-xl border border-gray-200 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition-colors bg-white"
      }
    >
      <div className="flex items-center gap-1 border-b border-gray-100 px-2 py-1.5">
        {TOOLBAR.map(({ command, label, Icon }) => (
          <button
            key={command}
            type="button"
            aria-label={label}
            title={label}
            disabled={disabled}
            onMouseDown={(e) => {
              // Prevent the editor from losing focus/selection on click.
              e.preventDefault();
            }}
            onClick={() => runCommand(command)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Icon className="h-4 w-4" />
          </button>
        ))}
        <span className="ml-1 text-[11px] text-gray-400">Bold, italic &amp; underline supported</span>
      </div>
      <div className="relative">
        {isEmpty && placeholder && (
          <span className="pointer-events-none absolute left-3.5 top-2.5 text-sm text-gray-400">
            {placeholder}
          </span>
        )}
        <div
          ref={editorRef}
          role="textbox"
          aria-multiline="true"
          aria-label={ariaLabel ?? placeholder}
          contentEditable={!disabled}
          suppressContentEditableWarning
          onInput={emit}
          onBlur={emit}
          onPaste={handlePaste}
          style={{ minHeight, whiteSpace: "pre-wrap" }}
          className="w-full px-3.5 py-2.5 text-sm text-gray-800 focus:outline-none"
        />
      </div>
    </div>
  );
}

export default RichTextEditor;
