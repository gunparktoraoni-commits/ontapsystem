/**
 * useCartOperations Hook
 * - Adds to cart with automatic merging of identical items
 * - Retries failed operations
 * - Handles CSRF and authentication
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getFrontendApiBaseUrl } from "@/app/components/apiBase";

// ==================== CONSTANTS ====================
const CSRF_COOKIE_NAME = "csrf-token";
const MAX_RETRIES = 3;
const RETRY_DELAY_BASE = 1000;
const PENDING_OPS_STORAGE_KEY = "ontap_pending_cart_ops";
const OPTIMISTIC_UPDATES_KEY = "ontap_optimistic_updates";

// ==================== AUTH HELPERS ====================
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

async function fetchFreshCsrfToken(apiBaseUrl: string): Promise<string | null> {
  try {
    const response = await fetch(`${apiBaseUrl}/api/csrf-token`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
    });
    if (!response.ok) return readCookie(CSRF_COOKIE_NAME);
    const payload = (await response.json()) as Record<string, unknown>;
    const token =
      (typeof payload.csrfToken === "string" && payload.csrfToken) ||
      (typeof payload.csrf_token === "string" && payload.csrf_token) ||
      (typeof payload.token === "string" && payload.token) ||
      null;
    return token?.trim() || readCookie(CSRF_COOKIE_NAME);
  } catch {
    return readCookie(CSRF_COOKIE_NAME);
  }
}

// ==================== TYPES ====================
export interface CartOperationPayload {
  itemType: string;
  itemId: string | number;
  quantity: number;
  variant?: string | null;
  subscriptionTier?: string | null;
  logoType?: string | null;
  logoUrl?: string | null;
  note?: string | null;
  customData?: Record<string, unknown>;
}

interface CartItem {
  id: string;
  itemId: string;
  quantity: number;
  customData?: Record<string, unknown> | null;
}

interface PendingOperation {
  id: string;
  payload: CartOperationPayload;
  timestamp: number;
  retries: number;
}

type ErrorCategory =
  | "NETWORK_ERROR"
  | "VALIDATION_ERROR"
  | "AUTH_ERROR"
  | "SERVER_ERROR"
  | "UNKNOWN_ERROR";

export interface CartError {
  category: ErrorCategory;
  message: string;
  statusCode?: number;
  retryable: boolean;
  tag: string;
}

export interface CartOperationResult {
  success: boolean;
  error?: CartError;
  retrying?: boolean;
}

// ==================== HELPER: FETCH CART ITEMS ====================
async function getCartItems(apiBaseUrl: string): Promise<CartItem[]> {
  try {
    const csrfToken = await fetchFreshCsrfToken(apiBaseUrl);
    const headers: Record<string, string> = {};
    if (csrfToken) {
      headers["X-CSRF-Token"] = csrfToken;
      headers["csrf-token"] = csrfToken;
    }
    const response = await fetch(`${apiBaseUrl}/api/marketplace/cart`, {
      method: "GET",
      credentials: "include",
      headers,
      cache: "no-store",
    });
    if (!response.ok) return [];
    const json = await response.json();
    const items = json?.data?.items || json?.items || [];
    return items.map((it: any) => ({
      id: it.id,
      itemId: String(it.itemId ?? it.itemID ?? it.productId ?? ""),
      quantity: it.quantity,
      customData: it.customData || it.details?.customData || null,
    }));
  } catch {
    return [];
  }
}

// ==================== HELPER: NORMALISE CUSTOM DATA FOR COMPARISON ====================
function normalizeCustomData(payload: CartOperationPayload): Record<string, unknown> {
  // Start with the payload's customData (if any)
  const base = { ...(payload.customData || {}) };
  // Also include top‑level configuration fields that might affect customisation
  if (payload.variant) base.variant = payload.variant;
  if (payload.subscriptionTier) base.subscriptionTier = payload.subscriptionTier;
  if (payload.logoType) base.logoType = payload.logoType;
  if (payload.logoUrl) base.logoUrl = payload.logoUrl;
  if (payload.note) base.note = payload.note;
  // Remove keys that are not part of product identity (e.g., quantity, timestamps)
  const ignoreKeys = ["quantity", "lineTotal", "id", "timestamp", "retries"];
  const normalized: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(base)) {
    if (!ignoreKeys.includes(k) && v !== undefined && v !== null) {
      normalized[k] = v;
    }
  }
  return normalized;
}

// ==================== HOOK ====================
export function useCartOperations() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<CartError | null>(null);
  const retryTimerRef = useRef<NodeJS.Timeout | null>(null);
  const apiBaseUrl = getFrontendApiBaseUrl();

  // ---------- Error categorization ----------
  const categorizeError = useCallback(
    (err: unknown, statusCode?: number): CartError => {
      if (
        err instanceof TypeError &&
        (err.message.includes("fetch") || err.message.includes("Failed to fetch"))
      ) {
        return {
          category: "NETWORK_ERROR",
          message: "Network connection failed. Please check your internet and try again.",
          statusCode,
          retryable: true,
          tag: "[CART_OP_NETWORK]",
        };
      }
      if (statusCode === 401 || statusCode === 403) {
        return {
          category: "AUTH_ERROR",
          message: "Your session expired or CSRF validation failed. Please refresh and try again.",
          statusCode,
          retryable: true,
          tag: "[CART_OP_AUTH]",
        };
      }
      if (statusCode === 400) {
        const message = err instanceof Error ? err.message : "Please check your input and try again.";
        return {
          category: "VALIDATION_ERROR",
          message,
          statusCode,
          retryable: false,
          tag: "[CART_OP_VALIDATION]",
        };
      }
      if (statusCode && statusCode >= 500) {
        return {
          category: "SERVER_ERROR",
          message: "Server error. Please try again in a moment.",
          statusCode,
          retryable: true,
          tag: "[CART_OP_SERVER]",
        };
      }
      return {
        category: "UNKNOWN_ERROR",
        message: err instanceof Error ? err.message : "An unexpected error occurred. Please try again.",
        statusCode,
        retryable: true,
        tag: "[CART_OP_UNKNOWN]",
      };
    },
    []
  );

  // ---------- Persistence ----------
  const getPendingOps = useCallback((): PendingOperation[] => {
    if (typeof window === "undefined") return [];
    try {
      const stored = sessionStorage.getItem(PENDING_OPS_STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }, []);

  const savePendingOps = useCallback((ops: PendingOperation[]): void => {
    if (typeof window === "undefined") return;
    try {
      if (ops.length === 0) {
        sessionStorage.removeItem(PENDING_OPS_STORAGE_KEY);
      } else {
        sessionStorage.setItem(PENDING_OPS_STORAGE_KEY, JSON.stringify(ops));
      }
    } catch {}
  }, []);

  const recordOptimisticUpdate = useCallback((payload: CartOperationPayload): void => {
    if (typeof window === "undefined") return;
    try {
      const existing = sessionStorage.getItem(OPTIMISTIC_UPDATES_KEY);
      const updates = existing ? JSON.parse(existing) : [];
      updates.push({
        id: `opt_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        payload,
        timestamp: Date.now(),
      });
      sessionStorage.setItem(OPTIMISTIC_UPDATES_KEY, JSON.stringify(updates.slice(-50)));
    } catch {}
  }, []);

  // ---------- Core operation (with merge) ----------
  const executeCartOperation = useCallback(
    async (
      payload: CartOperationPayload,
      shouldBuyNow: boolean = false,
      operationId?: string,
      merge: boolean = true // 👈 new parameter, default true for "add to cart"
    ): Promise<CartOperationResult> => {
      setLoading(true);
      setError(null);

      const opId = operationId || `op_${Date.now()}_${Math.random().toString(36).slice(2)}`;

      try {
        // Validation
        if (!payload.itemId) {
          const err = categorizeError(new Error("Missing item ID"), 400);
          setError(err);
          setLoading(false);
          return { success: false, error: err };
        }
        if (typeof payload.quantity !== "number" || payload.quantity < 1) {
          const err = categorizeError(new Error("Invalid quantity"), 400);
          setError(err);
          setLoading(false);
          return { success: false, error: err };
        }

        recordOptimisticUpdate(payload);

        // ---------- MERGE LOGIC (only if merge=true and not buy now) ----------
        if (merge && !shouldBuyNow) {
          const cartItems = await getCartItems(apiBaseUrl);
          const normalizedNew = normalizeCustomData(payload);

          const matchingItem = cartItems.find((item) => {
            if (String(item.itemId) !== String(payload.itemId)) return false;
            const normalizedExisting = normalizeCustomData({
              ...payload,
              customData: item.customData || undefined,
            });
            // Compare normalized objects (shallow compare)
            const keys = new Set([...Object.keys(normalizedNew), ...Object.keys(normalizedExisting)]);
            for (const k of keys) {
              if (normalizedNew[k] !== normalizedExisting[k]) return false;
            }
            return true;
          });

          if (matchingItem) {
            // Update existing item: new quantity = old + payload.quantity
            const newQuantity = matchingItem.quantity + payload.quantity;
            const csrfToken = await fetchFreshCsrfToken(apiBaseUrl);
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (csrfToken) {
              headers["X-CSRF-Token"] = csrfToken;
              headers["csrf-token"] = csrfToken;
            }
            const updateUrl = `${apiBaseUrl}/api/marketplace/cart/update/${matchingItem.id}`;
            const updateRes = await fetch(updateUrl, {
              method: "PUT",
              credentials: "include",
              headers,
              body: JSON.stringify({ quantity: newQuantity }),
            });
            const updateData = await updateRes.json().catch(() => null);
            if (!updateRes.ok) {
              throw new Error(updateData?.error || "Failed to update quantity");
            }
            // Successfully merged
            const pending = getPendingOps();
            const updated = pending.filter((op) => op.id !== opId);
            savePendingOps(updated);
            setLoading(false);
            return { success: true };
          }
        }

        // ---------- No match or merge disabled → add as new item ----------
        const csrfToken = await fetchFreshCsrfToken(apiBaseUrl);
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (csrfToken) {
          headers["X-CSRF-Token"] = csrfToken;
          headers["csrf-token"] = csrfToken;
        }

        const addUrl = `${apiBaseUrl}/api/marketplace/cart/add`;
        const response = await fetch(addUrl, {
          method: "POST",
          credentials: "include",
          headers,
          body: JSON.stringify(payload),
        });
        const data = await response.json().catch(() => null);

        // Retry on 403 with fresh token
        if (response.status === 403 && csrfToken) {
          const newToken = await fetchFreshCsrfToken(apiBaseUrl);
          if (newToken && newToken !== csrfToken) {
            const retryHeaders: Record<string, string> = {
              "Content-Type": "application/json",
              "X-CSRF-Token": newToken,
              "csrf-token": newToken,
            };
            const retryResponse = await fetch(addUrl, {
              method: "POST",
              credentials: "include",
              headers: retryHeaders,
              body: JSON.stringify(payload),
            });
            if (retryResponse.ok) {
              const pending = getPendingOps();
              const updated = pending.filter((op) => op.id !== opId);
              savePendingOps(updated);
              setLoading(false);
              return { success: true };
            }
          }
        }

        if (!response.ok) {
          const errorMsg = data?.error || data?.message || `HTTP ${response.status}: Operation failed`;
          const error = new Error(errorMsg) as Error & { statusCode?: number };
          error.statusCode = response.status;
          throw error;
        }

        // Success
        const pending = getPendingOps();
        const updated = pending.filter((op) => op.id !== opId);
        savePendingOps(updated);
        setLoading(false);
        return { success: true };
      } catch (err: unknown) {
        const statusCode = (err as any)?.statusCode;
        const cartError = categorizeError(err, statusCode);

        if (cartError.retryable) {
          const pending = getPendingOps();
          const existing = pending.find((op) => op.id === opId);
          if (!existing) {
            pending.push({ id: opId, payload, timestamp: Date.now(), retries: 0 });
          } else if (existing.retries < MAX_RETRIES) {
            existing.retries += 1;
          }
          savePendingOps(pending);
        }

        setError(cartError);
        setLoading(false);
        return {
          success: false,
          error: cartError,
          retrying: cartError.retryable && cartError.category !== "VALIDATION_ERROR",
        };
      }
    },
    [categorizeError, recordOptimisticUpdate, getPendingOps, savePendingOps, apiBaseUrl]
  );

  // ---------- Retry logic (unchanged) ----------
  const retryPendingOperations = useCallback(async (): Promise<void> => {
    const pending = getPendingOps();
    for (const op of pending) {
      if (op.retries >= MAX_RETRIES) continue;
      const delay = RETRY_DELAY_BASE * Math.pow(2, op.retries);
      await new Promise((resolve) => setTimeout(resolve, delay));
      await executeCartOperation(op.payload, false, op.id);
    }
  }, [getPendingOps, executeCartOperation]);

  const setupAutoRetry = useCallback(() => {
    const checkAndRetry = async () => {
      const pending = getPendingOps();
      if (pending.length > 0) await retryPendingOperations();
    };
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    retryTimerRef.current = setTimeout(checkAndRetry, 5000);
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [getPendingOps, retryPendingOperations]);

  useEffect(() => {
    const cleanup = setupAutoRetry();
    return cleanup;
  }, [setupAutoRetry]);

  useEffect(() => {
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, []);

  return {
    loading,
    error,
    executeCartOperation,
    retryPendingOperations,
    setupAutoRetry,
    getPendingOps,
  };
}