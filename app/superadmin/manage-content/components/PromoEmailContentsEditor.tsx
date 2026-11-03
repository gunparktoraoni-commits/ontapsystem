"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { AlignCenter, Bold, Italic } from "lucide-react";
import { cn } from "@/lib/utils";

type PromoEmailContentsEditorProps = {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
};

function syncToolbarState() {
  try {
    return {
      bold: document.queryCommandState("bold"),
      italic: document.queryCommandState("italic"),
      center: document.queryCommandState("justifyCenter"),
    };
  } catch {
    return { bold: false, italic: false, center: false };
  }
}

export default function PromoEmailContentsEditor({
  value,
  onChange,
  placeholder = "Optional supporting message…",
  className,
}: PromoEmailContentsEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState({ bold: false, italic: false, center: false });
  const [isEmpty, setIsEmpty] = useState(true);

  // Seed editor when value is cleared externally (e.g. form reset) without fighting typing.
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (value === "" && el.innerHTML !== "") {
      el.innerHTML = "";
      setIsEmpty(true);
    } else if (value && el.innerHTML === "" && value !== "<br>") {
      el.innerHTML = value;
      setIsEmpty(!el.textContent?.trim());
    }
  }, [value]);

  const refreshToolbar = useCallback(() => {
    setActive(syncToolbarState());
  }, []);

  useEffect(() => {
    const onSelectionChange = () => {
      const el = editorRef.current;
      if (!el) return;
      const sel = document.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const node = sel.anchorNode;
      if (!node || !el.contains(node)) return;
      refreshToolbar();
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [refreshToolbar]);

  const emitChange = () => {
    const el = editorRef.current;
    if (!el) return;
    const html = el.innerHTML;
    setIsEmpty(!el.textContent?.replace(/\u00a0/g, " ").trim());
    onChange(html);
    refreshToolbar();
  };

  const runCommand = (command: string) => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    try {
      document.execCommand(command, false);
    } catch {
      // Older browsers may throw; ignore.
    }
    emitChange();
  };

  return (
    <div className={cn("overflow-hidden rounded-xl border border-gray-200", className)}>
      <div className="flex items-center gap-1 border-b border-gray-100 bg-gray-50/80 px-2 py-1.5">
        <ToolbarButton
          label="Bold"
          active={active.bold}
          onMouseDown={(e) => {
            e.preventDefault();
            runCommand("bold");
          }}
        >
          <Bold className="h-3.5 w-3.5" strokeWidth={2.5} />
        </ToolbarButton>
        <ToolbarButton
          label="Italic"
          active={active.italic}
          onMouseDown={(e) => {
            e.preventDefault();
            runCommand("italic");
          }}
        >
          <Italic className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          label="Center align"
          active={active.center}
          onMouseDown={(e) => {
            e.preventDefault();
            runCommand("justifyCenter");
          }}
        >
          <AlignCenter className="h-3.5 w-3.5" />
        </ToolbarButton>
      </div>
      <div className="relative">
        {isEmpty ? (
          <p className="pointer-events-none absolute left-3 top-2 text-sm text-gray-400">
            {placeholder}
          </p>
        ) : null}
        <div
          ref={editorRef}
          role="textbox"
          aria-multiline="true"
          aria-label="Email contents"
          contentEditable
          suppressContentEditableWarning
          className="min-h-[120px] w-full resize-none px-3 py-2 text-sm text-gray-900 outline-none focus:ring-0 [&_p]:m-0 [&_p]:mb-2 last:[&_p]:mb-0"
          onInput={emitChange}
          onBlur={emitChange}
          onKeyUp={refreshToolbar}
          onMouseUp={refreshToolbar}
        />
      </div>
    </div>
  );
}

function ToolbarButton({
  children,
  label,
  active,
  onMouseDown,
}: {
  children: ReactNode;
  label: string;
  active: boolean;
  onMouseDown: (e: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onMouseDown={onMouseDown}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-600 transition",
        active
          ? "bg-primary/15 text-primary"
          : "hover:bg-white hover:text-gray-900"
      )}
    >
      {children}
    </button>
  );
}
