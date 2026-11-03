"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import {
  LuCheck,
  LuMinus,
  LuPhilippinePeso,
  LuPlus,
  LuTrash,
  LuShoppingBag,
  LuChevronDown,
} from "react-icons/lu";
import { getFrontendApiBaseUrl } from "../apiBase";
import { resolveProductImageSrc } from "@/lib/product-image";
import { showToast } from "../Toast";
import { USER_NOTICES } from "@/lib/user-notices";
import { InlineLoader, SectionLoader } from "../Loader";
import { ModalPortal } from "../ModalPortal";
import {
  resolvePersistedReferralCode,
  setStoredReferralCode,
} from "@/app/lib/referralStorage";

type CartItem = {
  id: string;
  itemId: string;
  itemType: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  image?: string;
  category?: string;
  available: boolean;
  customData?: Record<string, any> | null;
};

type MarketplaceTab =
  | "purchase"
  | "subscription"
  | "customize-templates"
  | "limited"
  | "productInfo"
  | "cart"
  | "checkout";

type CartTabProps = {
  setActiveTab?: (tab: MarketplaceTab) => void;
  setSelectedItemIds?: (ids: string[] | undefined) => void;
};

const API = getFrontendApiBaseUrl();
const CSRF_COOKIE_NAME = "csrf-token";
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const cookies = document.cookie ? document.cookie.split("; ") : [];
  for (const cookie of cookies) {
    const [rawKey, ...rest] = cookie.split("=");
    const key = decodeURIComponent(rawKey || "").trim();
    if (key !== name) continue;
    return decodeURIComponent(rest.join("=") || "").trim() || null;
  }
  return null;
}

async function ensureCsrfToken(forceFetch = false): Promise<string | null> {
  const fromCookie = readCookie(CSRF_COOKIE_NAME);
  if (!forceFetch && fromCookie) {
    console.debug(
      "[CartTab] ensureCsrfToken: found cookie",
      CSRF_COOKIE_NAME,
      fromCookie.slice?.(0, 6) || fromCookie,
    );
    return fromCookie;
  }
  try {
    const res = await fetch(`${API}/api/csrf-token`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });
    if (!res.ok) return readCookie(CSRF_COOKIE_NAME);
    const payload = (await res.json().catch(() => null)) as any;
    console.debug(
      "[CartTab] ensureCsrfToken: /api/csrf-token payload",
      payload,
    );
    const data =
      payload?.data && typeof payload.data === "object" ? payload.data : null;
    const token =
      payload?.csrfToken ||
      payload?.csrf_token ||
      payload?.token ||
      (data && (data.csrfToken || data.csrf_token)) ||
      null;
    try {
      console.debug(
        "[CartTab] ensureCsrfToken: document.cookie after fetch",
        typeof document !== "undefined" ? document.cookie : "[no document]",
      );
    } catch {}
    return typeof token === "string" && token.trim()
      ? token.trim()
      : readCookie(CSRF_COOKIE_NAME);
  } catch (err) {
    console.debug("[CartTab] ensureCsrfToken: error", err);
    return readCookie(CSRF_COOKIE_NAME);
  }
}

async function getCsrfHeaders(forceFetch = false): Promise<Headers | null> {
  try {
    const token = await ensureCsrfToken(forceFetch);
    if (!token) return null;
    const h = new Headers();
    h.set("X-CSRF-Token", token);
    h.set("x-csrf-token", token);
    h.set("X-XSRF-TOKEN", token);
    h.set("x-xsrf-token", token);
    h.set("csrf-token", token);
    return h;
  } catch (err) {
    console.debug("[CartTab] getCsrfHeaders error", err);
    return null;
  }
}

async function authFetch(
  url: string,
  init: RequestInit = {},
  canRetry = true,
): Promise<Response> {
  const method = String(init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers ?? undefined);

  const existingCsrf =
    headers.get("x-csrf-token") ||
    headers.get("X-CSRF-Token") ||
    headers.get("x-xsrf-token") ||
    headers.get("X-XSRF-TOKEN") ||
    headers.get("csrf-token");

  if (MUTATING_METHODS.has(method) && !existingCsrf) {
    const csrfHeaders = await getCsrfHeaders();
    if (csrfHeaders) {
      try {
        for (const [k, v] of csrfHeaders.entries()) headers.set(k, v);
      } catch {}
    }
  }

  const requestInit: RequestInit = {
    credentials: "include",
    cache: "no-store",
    ...init,
    method,
    headers,
  };
  try {
    console.debug(
      "[CartTab] authFetch:",
      method,
      url,
      "cookie",
      typeof document !== "undefined" ? document.cookie : "[no document]",
    );
  } catch {}
  try {
    console.debug(
      "[CartTab] authFetch: headers",
      Object.fromEntries(headers.entries()),
    );
  } catch {}
  const res = await fetch(url, requestInit);

  if (canRetry && (res.status === 401 || res.status === 403)) {
    const refreshHeaders = new Headers();
    const refreshCsrf = await getCsrfHeaders();
    if (refreshCsrf) {
      for (const [k, v] of refreshCsrf.entries()) refreshHeaders.set(k, v);
    }

    const refreshRes = await fetch(`${API}/api/auth/refresh`, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: refreshHeaders,
    });

    if (refreshRes.ok) {
      return fetch(url, requestInit);
    }
    try {
      const text = await res.text().catch(() => null);
      console.debug(
        "[CartTab] authFetch: initial response status",
        res.status,
        "bodyText",
        text,
      );
    } catch {}

    try {
      const freshHeaders = await getCsrfHeaders(true);
      if (freshHeaders) {
        try {
          for (const [k, v] of freshHeaders.entries()) headers.set(k, v);
        } catch {}
        const retryInit: RequestInit = { ...requestInit, headers };
        const retryRes = await fetch(url, retryInit);
        if (retryRes.ok) return retryRes;
        try {
          console.debug(
            "[CartTab] authFetch: retry response status",
            retryRes.status,
            await retryRes.text().catch(() => null),
          );
        } catch {}
      }
    } catch (err) {
      console.debug("[CartTab] authFetch: token refresh fallback failed", err);
    }

    try {
      const clone = res.clone();
      const body = (await clone.json().catch(() => null)) as any;
      const code = body?.code || body?.error_code || body?.error || null;
      const message = body?.error || body?.message || null;
      if (
        code === "CSRF_TOKEN_INVALID" ||
        (typeof message === "string" && message.toLowerCase().includes("csrf"))
      ) {
        const fresh2 = await getCsrfHeaders(true);
        if (fresh2) {
          try {
            for (const [k, v] of fresh2.entries()) headers.set(k, v);
          } catch {}
          const retryInit2: RequestInit = { ...requestInit, headers };
          const retryRes2 = await fetch(url, retryInit2);
          if (retryRes2.ok) return retryRes2;
          try {
            console.debug(
              "[CartTab] authFetch: explicit-CSRF retry response status",
              retryRes2.status,
              await retryRes2.text().catch(() => null),
            );
          } catch {}
        }
      }
    } catch (err) {
      console.debug(
        "[CartTab] authFetch: explicit-CSRF retry parse failed",
        err,
      );
    }
  }

  return res;
}

const CustomSelect: React.FC<{
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}> = ({ options, value, onChange }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, []);
  const selected = options.find((o) => o.value === value);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="w-full px-4 py-2 rounded-xl border border-gray-200 bg-white text-sm text-gray-700 flex items-center justify-between"
      >
        <span>{selected?.label ?? "Select"}</span>
        <LuChevronDown className="text-sm" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 mt-2 bg-white border border-gray-100 rounded-xl shadow-md z-40">
          {options.map((o) => (
            <button
              key={o.value}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={`w-full text-left px-4 py-2 text-sm ${o.value === value ? "bg-primary-light text-white" : "hover:bg-gray-50"}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const CartItemRow: React.FC<{
  item: CartItem;
  onRemove: (id: string) => Promise<void>;
  onUpdateQty: (id: string, qty: number) => Promise<void>;
  selected: boolean;
  onToggle: (id: string) => void;
}> = ({ item, onRemove, onUpdateQty, selected, onToggle }) => {
  const [qty, setQty] = useState(item.quantity);
  const debounceRef = useRef<number | null>(null);
  useEffect(() => setQty(item.quantity), [item.quantity]);
  const schedule = (next: number) => {
    if (next < 1 || next > 99) return;
    setQty(next);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void onUpdateQty(item.id, next);
      debounceRef.current = null;
    }, 600);
  };
  useEffect(
    () => () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    },
    [],
  );

  const itemImageSrc = resolveProductImageSrc(item.image);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      className="bg-white rounded-2xl border border-gray-100 p-4 flex items-center gap-4 relative"
    >
      <button
        onClick={() => onToggle(item.id)}
        className="shrink-0 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary rounded"
        aria-label={selected ? "Deselect item" : "Select item"}
        role="checkbox"
        aria-checked={selected}
      >
        <div
          className={`w-6 h-6 rounded-md flex items-center justify-center transition-colors duration-150 ${selected ? "bg-primary border-2 border-primary" : "border-2 border-gray-300 bg-white hover:bg-gray-50"}`}
        >
          <LuCheck
            className={`${selected ? "text-white" : "text-transparent"} text-sm`}
          />
        </div>
      </button>
      <div className="w-20 h-20 rounded-xl overflow-hidden bg-gray-50">
        {itemImageSrc ? (
          <Image
            src={itemImageSrc}
            alt={item.name}
            height={80}
            width={80}
            className="object-contain h-full w-full"
            unoptimized
            draggable={false}
          />
        ) : null}
      </div>
      <div className="flex-1 min-w-0">
        <Link
          href={`/products/${item.itemId}`}
          className="font-semibold text-gray-800 line-clamp-1"
        >
          {item.name}
        </Link>
        <p className="text-xs text-gray-400 mt-1">
          {item.category || item.itemType}
        </p>
        {item.customData && (
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {item.customData.variant && (
              <span className="px-2 py-1 rounded-full bg-sky-50 text-sky-700">
                Variant: {String(item.customData.variant)}
              </span>
            )}
            {item.customData.subscriptionTier && (
              <span className="px-2 py-1 rounded-full bg-amber-50 text-amber-700">
                Subscription: {String(item.customData.subscriptionTier)}
              </span>
            )}
          </div>
        )}

        {/* Note UI */}
        <div className="mt-3">
          <NoteBlock item={item} />
        </div>
      </div>

      <div className="h-full flex flex-col gap-5 items-end justify-between">
        <button
          onClick={() => void onRemove(item.id)}
          className="text-lg stroke-2 p-2 text-gray-400 hover:text-red-500"
        >
          <LuTrash />
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => schedule(qty - 1)}
            className="w-8 h-8 rounded-lg border text-gray-600 flex items-center justify-center"
          >
            {" "}
            <LuMinus />{" "}
          </button>
          <input
            className="w-7 text-center"
            value={qty}
            onChange={(e) => {
              const v = parseInt(e.target.value || "", 10);
              if (!Number.isNaN(v)) schedule(v);
            }}
          />
          <button
            onClick={() => schedule(qty + 1)}
            className="w-8 h-8 rounded-lg border text-gray-600 flex items-center justify-center"
          >
            {" "}
            <LuPlus />{" "}
          </button>
        </div>
        <div className="text-right min-w-[88px]">
          <div className="flex items-center justify-end text-primary">
            <LuPhilippinePeso className="text-sm" />{" "}
            <span className="text-lg font-bold">
              {item.lineTotal.toLocaleString()}
            </span>
          </div>
          {item.quantity > 1 && (
            <div className="text-xs text-gray-400">
              {item.unitPrice.toLocaleString()} each
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};

// NoteBlock component: shows, edits, deletes note for an item
const NoteBlock: React.FC<{ item: CartItem }> = ({ item }) => {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState<string>(() =>
    item.customData?.note ? String(item.customData.note) : "",
  );
  useEffect(() => {
    setText(item.customData?.note ? String(item.customData.note) : "");
  }, [item.customData?.note]);

  const save = async () => {
    const event = new CustomEvent("ontap:cart:saveNote", {
      detail: { id: item.id, note: text.trim() ? text.trim() : null },
    });

    window.dispatchEvent(event);
    setEditing(false);
  };

  

  const remove = async () => {
    const event = new CustomEvent("ontap:cart:deleteNote", {
      detail: { id: item.id },
    });
    window.dispatchEvent(event);
  };


  return (
    <div className="mt-2">
      {!editing ? (
        <div className="flex flex-col items-start gap-3">
          <div className="flex-1">
            {item.customData?.note ? (
              <p className="text-sm text-gray-700 bg-gray-50 p-2 rounded-md">
                {String(item.customData.note)}
              </p>
            ) : (
              <p className="text-sm text-gray-400">No note added</p>

            )}

          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditing(true)}
              className="text-xs px-3 py-1 rounded-md border"
            >
              {item.customData?.note ? "Edit" : "Add"}
            </button>
            {item.customData?.note && (
              <button
                onClick={remove}
                className="text-xs px-3 py-1 rounded-md border text-red-600"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex gap-2 w-full">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="flex-1 rounded-md border p-2 text-sm h-20"
          />
          <div className="flex flex-col gap-2">
            <button
              onClick={save}
              className="px-3 py-1 rounded-md bg-primary-light text-white text-sm hover:bg-primary transition-all duration-200"
            >
              Save
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setText(
                  item.customData?.note ? String(item.customData.note) : "",
                );
              }}
              className="px-3 py-1 rounded-md border text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const EmptyCart: React.FC = () => (
  <div className="py-16 text-center">
    <div className="w-24 h-24 mx-auto rounded-full bg-gray-100 flex items-center justify-center mb-4">
      <LuShoppingBag className="text-4xl text-gray-400" />
    </div>
    <h3 className="text-xl font-semibold text-gray-800">Your cart is empty</h3>
    <p className="text-gray-500 mt-2">
      Add items from the marketplace to see them here.
    </p>
    <Link
      href="/products"
      className="inline-flex items-center gap-2 mt-4 px-6 py-2 rounded-xl bg-primary text-white font-medium"
    >
      Start Shopping
    </Link>
  </div>
);

export default function CartTab({
  setActiveTab,
  setSelectedItemIds,
}: CartTabProps) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [referralCode, setReferralCode] = useState("");
  const [referralValidating, setReferralValidating] = useState(false);
  const [referralValid, setReferralValid] = useState(false);
  const [referralError, setReferralError] = useState<string | null>(null);

  const [showInquiryModal, setShowInquiryModal] = useState(false);
  const [inquiryName, setInquiryName] = useState("");
  const [inquiryEmail, setInquiryEmail] = useState("");
  const [inquiryContact, setInquiryContact] = useState("");
  const [inquiryNote, setInquiryNote] = useState("");
  const [inquirySubmitting, setInquirySubmitting] = useState(false);
  const [inquiryErrors, setInquiryErrors] = useState<{
    name?: string;
    email?: string;
    contact?: string;
  }>({});

  const hasZeroPriceSelected = useMemo(() => {
    return items.some((item) => selected.has(item.id) && item.unitPrice === 0);
  }, [items, selected]);

  const fetchCart = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`${API}/api/marketplace/cart`);
      if (!res.ok) throw new Error("Failed to fetch cart");
      const json = (await res.json().catch(() => null)) as any;
      const serverItems = Array.isArray(json?.data?.items)
        ? json.data.items
        : [];
      const mapped: CartItem[] = serverItems.map((it: any) => ({
        id: it.id,
        itemId: String(it.itemId ?? it.itemID ?? it.productId ?? ""),
        itemType: it.itemType,
        name: it.name,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        lineTotal: it.lineTotal,
        image: resolveProductImageSrc(it.details?.imgUrl),
        category: it.details?.category || it.itemType,
        available: Boolean(it.available),
        customData: it.customData || it.details?.customData || null,
      }));
      setItems(mapped);
      const sel = new Set<string>();
      mapped.forEach((i) => {
        if (i.available) sel.add(i.id);
      });
      setSelected(sel);
    } catch (err: any) {
      setError(err?.message || "Unable to load cart");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchCart();
  }, [fetchCart]);

  useEffect(() => {
    void ensureCsrfToken(true);
  }, []);

  useEffect(() => {
    const stored = resolvePersistedReferralCode();
    if (stored) setReferralCode(stored);
  }, []);

  useEffect(() => {
    const code = referralCode.trim();
    if (!code) {
      setReferralValid(false);
      setReferralError(null);
      setReferralValidating(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setReferralValidating(true);
      try {
        const res = await fetch(
          `${API}/api/affiliate/validate?code=${encodeURIComponent(code)}`,
          { credentials: "include", cache: "no-store" },
        );
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        const valid = Boolean(json?.data?.valid);
        setReferralValid(valid);
        if (valid) {
          setStoredReferralCode(code);
          setReferralError(null);
        } else {
          setReferralError("Referral code is invalid.");
        }
      } catch {
        if (!cancelled) {
          setReferralValid(false);
          setReferralError("Unable to validate referral code.");
        }
      } finally {
        if (!cancelled) setReferralValidating(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [referralCode]);

  // Listen for note save/delete events from NoteBlock instances
  useEffect(() => {
    function onSave(e: Event) {
      const detail = (e as CustomEvent).detail as
        | { id: string; note: string | null }
        | undefined;
      if (!detail) return;
      void saveNote(detail.id, detail.note ?? null);
    }
    function onDelete(e: Event) {
      const detail = (e as CustomEvent).detail as { id: string } | undefined;
      if (!detail) return;
      void deleteNote(detail.id);
    }
    window.addEventListener("ontap:cart:saveNote", onSave as EventListener);
    window.addEventListener("ontap:cart:deleteNote", onDelete as EventListener);
    return () => {
      window.removeEventListener(
        "ontap:cart:saveNote",
        onSave as EventListener,
      );
      window.removeEventListener(
        "ontap:cart:deleteNote",
        onDelete as EventListener,
      );
    };
  }, [items]);

  const updateQty = async (id: string, qty: number) => {
    try {
      const headersObj: Record<string, string> = {
        "Content-Type": "application/json",
      };
      const csrf = await getCsrfHeaders(true);
      if (csrf) {
        for (const [k, v] of csrf.entries()) headersObj[k] = v;
      }
      const res = await authFetch(`${API}/api/marketplace/cart/update/${id}`, {
        method: "PUT",
        headers: headersObj,
        body: JSON.stringify({ quantity: qty }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Update failed");
      await fetchCart();
    } catch (err: any) {
      setError(err?.message || "Failed to update");
      try {
        showToast("We couldn't update the quantity. Please try again.", "error");
      } catch {}
    }
  };

  /**
   * Save note: updates the customData with the note field.
   * Sends only custom_data (no separate note field) to match backend expectations.
   */
  const saveNote = async (id: string, note: string | null) => {
    try {
      const existing = items.find((i) => i.id === id);
      // Start with existing customData or empty object
      const customData: Record<string, any> = existing?.customData
        ? { ...existing.customData }
        : {};

      if (note === null || note === "") {
        // Delete note if empty
        delete customData.note;
      } else {
        // Set the note
        customData.note = note;
      }

      // If customData becomes empty, send null
      const finalCustomData =
        Object.keys(customData).length === 0 ? null : customData;

      const headersObj: Record<string, string> = {
        "Content-Type": "application/json",
      };
      const csrf = await getCsrfHeaders(true);
      if (csrf) {
        for (const [k, v] of csrf.entries()) headersObj[k] = v;
      }

      const res = await authFetch(`${API}/api/marketplace/cart/update/${id}`, {
        method: "PUT",
        headers: headersObj,
        body: JSON.stringify({ custom_data: finalCustomData }), // ✅ only custom_data
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Failed to save note");
      await fetchCart();
      showToast(note ? "Your note was saved." : "Note removed.", "success");
    } catch (err: any) {
      showToast("We couldn't save your note. Please try again.", "error");
    }
  };

  const deleteNote = async (id: string) => {
    // Reuse saveNote with null note
    await saveNote(id, null);
  };

  const removeItem = async (id: string) => {
    try {
      const headersObj: Record<string, string> = {};
      const csrf = await getCsrfHeaders(true);
      if (csrf) {
        for (const [k, v] of csrf.entries()) headersObj[k] = v;
      }
      const res = await authFetch(`${API}/api/marketplace/cart/remove/${id}`, {
        method: "DELETE",
        headers: headersObj,
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Remove failed");
      await fetchCart();
    } catch (err: any) {
      setError(err?.message || "Failed to remove");
      try {
        showToast("We couldn't remove this item. Please try again.", "error");
      } catch {}
    }
  };

  const toggle = (id: string) => {
    const s = new Set(selected);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setSelected(s);
  };

  const subtotal = useMemo(
    () =>
      items
        .filter((i) => selected.has(i.id))
        .reduce((s, i) => s + i.lineTotal, 0),
    [items, selected],
  );

  const estimatedTotal = subtotal;

  // ------------------------------------------------------------------
  // Render: if loading, show full‑page overlay
  // ------------------------------------------------------------------
  if (loading) {
    return (
      <ModalPortal isOpen={loading} onClose={() => {}}>
        <div className="flex items-center justify-center">
          <SectionLoader text="Loading your cart..." />
        </div>
      </ModalPortal>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Shopping Cart</h2>
          <p className="text-sm text-gray-500">
            {items.length} {items.length === 1 ? "item" : "items"} in your cart
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              if (selected.size === items.length) setSelected(new Set());
              else setSelected(new Set(items.map((i) => i.id)));
            }}
            className="px-4 py-2 rounded-xl border"
          >
            {selected.size === items.length ? "Deselect All" : "Select All"}
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {items.length === 0 ? (
            <EmptyCart />
          ) : (
            <AnimatePresence>
              {items.map((it) => (
                <CartItemRow
                  key={it.id}
                  item={it}
                  onRemove={removeItem}
                  onUpdateQty={updateQty}
                  selected={selected.has(it.id)}
                  onToggle={toggle}
                />
              ))}
            </AnimatePresence>
          )}
        </div>

        {items.length > 0 && (
          <div className="bg-white rounded-2xl border p-6">
            <h3 className="text-lg font-bold mb-4">Order Summary</h3>
            <div className="space-y-3 mb-4 max-h-48 overflow-y-auto">
              {items
                .filter((i) => selected.has(i.id))
                .slice(0, 3)
                .map((i) => {
                  const summaryImageSrc = resolveProductImageSrc(i.image);
                  return (
                  <div key={i.id} className="flex items-center gap-3 text-sm">
                    <div className="w-10 h-10 rounded-md overflow-hidden">
                      {summaryImageSrc ? (
                        <Image
                          src={summaryImageSrc}
                          alt={i.name}
                          width={40}
                          height={40}
                          className="object-contain h-full w-full"
                          draggable={false}
                        />
                      ) : null}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-700 truncate">
                        {i.name}
                      </p>
                      <p className="text-xs text-gray-400">Qty: {i.quantity}</p>
                    </div>
                    <div className="flex items-center gap-0.5 text-primary">
                      <LuPhilippinePeso className="text-xs" />
                      <span className="font-semibold">
                        {i.lineTotal.toLocaleString()}
                      </span>
                    </div>
                  </div>
                  );
                })}
              {items.filter((i) => selected.has(i.id)).length > 3 && (
                <p className="text-xs text-gray-400 text-center">
                  +{items.filter((i) => selected.has(i.id)).length - 3} more
                  items
                </p>
              )}
            </div>

            <div className="space-y-3 border-t pt-4">
              <label className="block text-sm font-medium text-gray-700">
                Referral Code
              </label>
              <input
                type="text"
                value={referralCode}
                onChange={(e) => {
                  setReferralCode(e.target.value.toUpperCase());
                  setReferralError(null);
                  setReferralValid(false);
                }}
                placeholder="Enter referral code"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all bg-white text-sm uppercase"
              />
              {referralValidating && (
                <p className="text-xs text-gray-500 flex items-center gap-1.5">
                  <InlineLoader /> Validating…
                </p>
              )}
              {!referralValidating && referralValid && referralCode && (
                <p className="text-xs text-green-600">Referral code applied</p>
              )}
              {!referralValidating && referralError && (
                <p className="text-xs text-red-500">{referralError}</p>
              )}
            </div>

            <div className="mt-6 border-t pt-4 space-y-2">
              <div className="flex justify-between text-gray-600">
                <span>Subtotal</span>
                <span className="flex items-center gap-0.5">
                  <LuPhilippinePeso className="text-xs" />
                  {subtotal.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between pt-3 border-t">
                <span className="text-lg font-bold">Estimated total</span>
                <span className="text-2xl font-bold text-primary flex items-center gap-0.5">
                  <LuPhilippinePeso />
                  {estimatedTotal.toLocaleString()}
                </span>
              </div>
              <p className="text-[11px] text-gray-400">
                Tax and shipping are calculated at checkout.
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                if (hasZeroPriceSelected) {
                  // Inquiry-only selection: open inquiry form (same flow as landing)
                  setShowInquiryModal(true);
                } else {
                  const ids = Array.from(selected);
                  try {
                    if (setSelectedItemIds)
                      setSelectedItemIds(ids.length > 0 ? ids : undefined);
                    if (referralCode.trim() && referralValid) {
                      setStoredReferralCode(referralCode.trim());
                    }
                  } catch {}
                  if (setActiveTab) {
                    setActiveTab("checkout");
                  } else {
                    const href =
                      ids.length > 0
                        ? `/checkout?items=${encodeURIComponent(ids.join(","))}`
                        : "/checkout";
                    window.location.href = href;
                  }
                }
              }}
              disabled={selected.size === 0}
              className={`w-full block mt-6 py-3 text-center rounded-xl font-semibold ${selected.size > 0 ? "bg-primary-light text-white" : "bg-gray-200 text-gray-500"}`}
            >
              {hasZeroPriceSelected
                ? `Proceed to Inquiry (${selected.size})`
                : `Proceed to Checkout (${selected.size})`}
            </button>
          </div>
        )}
      </div>
      {showInquiryModal && (
        <ModalPortal isOpen={showInquiryModal} onClose={() => setShowInquiryModal(false)}>
          <div className="bg-white rounded-2xl max-w-md w-full p-6 relative max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold mb-4">Complete Your Inquiry</h3>
            <p className="text-sm text-gray-600 mb-4">
              Please provide your contact details so we can respond to your
              inquiry about the selected items.
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Full Name *
                </label>
                <input
                  type="text"
                  value={inquiryName}
                  onChange={(e) => setInquiryName(e.target.value)}
                  className="w-full mt-1 rounded-lg border px-3 py-2"
                />
                {inquiryErrors.name && (
                  <p className="text-xs text-red-500 mt-1">
                    {inquiryErrors.name}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Email Address *
                </label>
                <input
                  type="email"
                  value={inquiryEmail}
                  onChange={(e) => setInquiryEmail(e.target.value)}
                  className="w-full mt-1 rounded-lg border px-3 py-2"
                />
                {inquiryErrors.email && (
                  <p className="text-xs text-red-500 mt-1">
                    {inquiryErrors.email}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Contact Number *
                </label>
                <input
                  type="tel"
                  value={inquiryContact}
                  onChange={(e) => setInquiryContact(e.target.value)}
                  className="w-full mt-1 rounded-lg border px-3 py-2"
                  placeholder="09123456789"
                />
                {inquiryErrors.contact && (
                  <p className="text-xs text-red-500 mt-1">
                    {inquiryErrors.contact}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Note (optional)
                </label>
                <textarea
                  value={inquiryNote}
                  onChange={(e) => setInquiryNote(e.target.value)}
                  rows={3}
                  className="w-full mt-1 rounded-lg border px-3 py-2"
                  placeholder="Any special requests or information..."
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowInquiryModal(false)}
                className="flex-1 py-2 rounded-xl border border-gray-300 text-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  // Validate and submit
                  const errors: typeof inquiryErrors = {};
                  if (!inquiryName.trim()) errors.name = "Name is required";
                  if (!inquiryEmail.trim()) errors.email = "Email is required";
                  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inquiryEmail))
                    errors.email = "Invalid email";
                  if (!inquiryContact.trim())
                    errors.contact = "Contact is required";
                  else if (!/^09\d{9}$/.test(inquiryContact.replace(/\D/g, "")))
                    errors.contact = "Invalid Philippine mobile number";
                  if (Object.keys(errors).length) {
                    setInquiryErrors(errors);
                    return;
                  }
                  setInquirySubmitting(true);
                  try {
                    const selectedCartItems = items.filter((i) =>
                      selected.has(i.id),
                    );
                    const inquiryItems = selectedCartItems.map((item) => ({
                      productId: item.itemId,
                      productName: item.name,
                      quantity: item.quantity,
                      unitPrice: item.unitPrice,
                      variant: item.customData?.variant || null,
                      subscriptionTier:
                        item.customData?.subscriptionTier || null,
                      logoType: item.customData?.logoType || null,
                      note: item.customData?.note || null,
                      imageUrl: item.image || null,
                      cartItemId: item.id,
                    }));
                    const csrfToken = await ensureCsrfToken();
                    const headers: HeadersInit = {
                      "Content-Type": "application/json",
                    };
                    if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
                    const primaryName = selectedCartItems[0]?.name || "products";
                    const title =
                      selectedCartItems.length === 1
                        ? `Inquiry about ${primaryName}`
                        : `Inquiry about ${primaryName} +${selectedCartItems.length - 1} more`;
                    const res = await fetch(
                      `${API}/api/inquiries/product-inquiry`,
                      {
                        method: "POST",
                        credentials: "include",
                        headers,
                        body: JSON.stringify({
                          name: inquiryName.trim(),
                          email: inquiryEmail.trim().toLowerCase(),
                          contact: inquiryContact.replace(/\D/g, ""),
                          note: inquiryNote.trim() || null,
                          title,
                          source: "marketplace",
                          items: inquiryItems,
                          clearCartItemIds: selectedCartItems.map((item) => item.id),
                        }),
                      },
                    );
                    const data = await res.json();
                    if (!res.ok)
                      throw new Error(data.error || "Inquiry failed");
                    showToast(USER_NOTICES.inquirySent, "success");
                    setShowInquiryModal(false);
                    setInquiryName("");
                    setInquiryEmail("");
                    setInquiryContact("");
                    setInquiryNote("");
                    // Refresh cart after inquired items were cleared server-side
                    window.dispatchEvent(new Event("ontap-cart-updated"));
                    if (typeof fetchCart === "function") {
                      void fetchCart();
                    }
                  } catch (err: unknown) {
                    showToast(
                      err instanceof Error
                        ? err.message
                        : "We couldn't send your inquiry. Please try again.",
                      "error",
                    );
                  } finally {
                    setInquirySubmitting(false);
                  }
                }}
                disabled={inquirySubmitting}
                className="flex-1 py-2 rounded-xl bg-primary-light text-white font-semibold disabled:opacity-50"
              >
                {inquirySubmitting ? (
                  <InlineLoader />
                ) : (
                  "Submit Inquiry"
                )}
              </button>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
}