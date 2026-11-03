'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getFrontendApiBaseUrl } from '../apiBase';
import { resolveProductImageSrc } from '@/lib/product-image';

const API = getFrontendApiBaseUrl();
const CSRF_COOKIE_NAME = 'csrf-token';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

type ApiEnvelope<T> = {
  success?: boolean;
  data?: T;
  message?: string;
  error?: unknown;
};

type PromotionItem = {
  id: string;
  name: string;
  description: string;
  code: string | null;
  discountType: string;
  discountValue: number;
  expiresAt: string | null;
  maxUses: number | null;
  currentUses: number;
  usageRemainingGlobal: number | null;
};

type ProductItem = {
  id: string;
  name: string;
  category: string;
  description: string;
  price: number;
  imgUrl: string | null;
  stockQuantity: number;
  inStock: boolean;
};

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const cookies = document.cookie ? document.cookie.split('; ') : [];
  for (const cookie of cookies) {
    const [rawKey, ...rest] = cookie.split('=');
    const key = decodeURIComponent(rawKey || '').trim();
    if (key !== name) continue;
    return decodeURIComponent(rest.join('=') || '').trim() || null;
  }
  return null;
}

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const raw = payload as Record<string, unknown>;
  if (typeof raw.error === 'string' && raw.error.trim()) return raw.error;
  if (raw.error && typeof raw.error === 'object') {
    const nested = raw.error as Record<string, unknown>;
    if (typeof nested.message === 'string' && nested.message.trim()) return nested.message;
  }
  if (typeof raw.message === 'string' && raw.message.trim()) return raw.message;
  return fallback;
}

function pricePhp(value: number): string {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatLabel(raw: string): string {
  return raw
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatDiscount(promotion: PromotionItem): string {
  if (promotion.discountType === 'percentage') {
    return `${promotion.discountValue}% off`;
  }
  return `₱${promotion.discountValue.toLocaleString()} off`;
}

async function ensureCsrfToken(): Promise<string | null> {
  const fromCookie = readCookie(CSRF_COOKIE_NAME);
  if (fromCookie) return fromCookie;

  try {
    const response = await fetch(`${API}/api/csrf-token`, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    });

    if (!response.ok) return readCookie(CSRF_COOKIE_NAME);

    const payload = (await response.json()) as Record<string, unknown>;
    const data = payload.data && typeof payload.data === 'object'
      ? (payload.data as Record<string, unknown>)
      : null;

    const token =
      (typeof payload.csrfToken === 'string' && payload.csrfToken) ||
      (typeof payload.csrf_token === 'string' && payload.csrf_token) ||
      (typeof payload.token === 'string' && payload.token) ||
      (data && typeof data.csrfToken === 'string' && data.csrfToken) ||
      null;

    return token?.trim() || readCookie(CSRF_COOKIE_NAME);
  } catch {
    return readCookie(CSRF_COOKIE_NAME);
  }
}

async function authFetch(url: string, init: RequestInit = {}, canRetry = true): Promise<Response> {
  const method = String(init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers ?? undefined);

  if (MUTATING_METHODS.has(method)) {
    const csrfToken = await ensureCsrfToken();
    if (csrfToken) headers.set('X-CSRF-Token', csrfToken);
  }

  const requestInit: RequestInit = {
    credentials: 'include',
    cache: 'no-store',
    ...init,
    method,
    headers,
  };

  const response = await fetch(url, requestInit);
  if (canRetry && (response.status === 401 || response.status === 403)) {
    const refreshHeaders = new Headers();
    const refreshCsrf = await ensureCsrfToken();
    if (refreshCsrf) refreshHeaders.set('X-CSRF-Token', refreshCsrf);

    const refreshResponse = await fetch(`${API}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: refreshHeaders,
    });

    if (refreshResponse.ok) {
      return fetch(url, requestInit);
    }
  }

  return response;
}

export default function LimitedTab() {
  const [promotions, setPromotions] = useState<PromotionItem[]>([]);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [busyProductId, setBusyProductId] = useState<string | null>(null);

  const loadLimitedData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [promoResponse, productsResponse] = await Promise.all([
        authFetch(`${API}/api/marketplace/promotions?limit=4`),
        authFetch(`${API}/api/marketplace/products?limit=12&in_stock=true&sort_by=catalog`),
      ]);

      const promoPayload = (await promoResponse.json().catch(() => null)) as ApiEnvelope<{
        promotions?: PromotionItem[];
      }> | null;
      const productsPayload = (await productsResponse.json().catch(() => null)) as ApiEnvelope<{
        products?: ProductItem[];
      }> | null;

      if (!promoResponse.ok || !promoPayload?.success) {
        throw new Error(extractErrorMessage(promoPayload, 'Unable to load active promotions.'));
      }

      if (!productsResponse.ok || !productsPayload?.success) {
        throw new Error(extractErrorMessage(productsPayload, 'Unable to load limited products.'));
      }

      const productItems = Array.isArray(productsPayload.data?.products) ? productsPayload.data.products : [];
      const lowStockItems = productItems
        .filter((item) => item.inStock)
        .sort((left, right) => left.stockQuantity - right.stockQuantity)
        .slice(0, 4);

      setPromotions(Array.isArray(promoPayload.data?.promotions) ? promoPayload.data.promotions : []);
      setProducts(lowStockItems.length > 0 ? lowStockItems : productItems.slice(0, 4));
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Unable to load limited marketplace content.';
      setError(message);
      setPromotions([]);
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLimitedData();
  }, [loadLimitedData]);

  const handleAddToCart = async (product: ProductItem) => {
    setActionError(null);
    setActionMessage(null);
    setBusyProductId(product.id);

    try {
      const response = await authFetch(`${API}/api/marketplace/cart/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemType: 'merchandise',
          itemId: product.id,
          quantity: 1,
        }),
      });
      const payload = (await response.json().catch(() => null)) as ApiEnvelope<Record<string, unknown>> | null;

      if (!response.ok || !payload?.success) {
        throw new Error(extractErrorMessage(payload, 'Unable to add this limited item to cart.'));
      }

      setActionMessage(`"${product.name}" was added to your cart.`);
      try {
        if (typeof window !== 'undefined') {
          // notify other components/tabs to refresh cart
          window.localStorage.setItem('ontap_cart_updated_at', String(Date.now()));
          window.dispatchEvent(new Event('ontap_cart_updated'));
        }
      } catch {}
    } catch (actionLoadError) {
      const message = actionLoadError instanceof Error ? actionLoadError.message : 'Unable to add this limited item to cart.';
      setActionError(message);
    } finally {
      setBusyProductId(null);
    }
  };

  const hasContent = useMemo(() => promotions.length > 0 || products.length > 0, [products.length, promotions.length]);

  return (
    <div className="rounded-2xl border border-[#d4dbec] bg-white p-6 shadow-sm sm:p-8 flex items-center justify-center min-h-[50vh]">
      {/* <div className="text-center">
        <Sparkles className="mx-auto h-10 w-10 text-[#4f70d8]" />
        <h3 className="mt-3 text-lg font-bold text-[#1f2d57]">Limited</h3>
        <p className="mt-1 text-sm text-[#7c88ab]">Fresh promo campaigns and low-stock cards are shown in real-time.</p>
      </div>

      <div className="mt-6 space-y-4">
        {actionError && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {actionError}
          </div>
        )}

        {actionMessage && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {actionMessage}
          </div>
        )}

        {loading ? (
          <div className="flex min-h-55 items-center justify-center rounded-xl border border-dashed border-[#d4dbec] bg-[#f8faff]">
            <span className="inline-flex items-center gap-2 text-sm text-[#5b678f]">
              <InlineLoader />
              Loading limited marketplace offers...
            </span>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-5 text-center">
            <p className="text-sm font-medium text-red-700">{error}</p>
            <button
              type="button"
              onClick={() => void loadLimitedData()}
              className="mt-3 rounded-lg border border-red-200 bg-white px-4 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-50"
            >
              Retry
            </button>
          </div>
        ) : !hasContent ? (
          <div className="flex min-h-55 items-center justify-center rounded-xl border border-dashed border-[#d4dbec] bg-[#f8faff] text-sm text-[#7c88ab]">
            No limited offers are active right now.
          </div>
        ) : (
          <>
            <section className="space-y-2">
              <h4 className="text-sm font-bold uppercase tracking-wide text-[#2a4792]">Limited-Time Promotions</h4>
              {promotions.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[#d4dbec] bg-[#f8faff] px-4 py-5 text-center text-sm text-[#7c88ab]">
                  No active promotions at the moment.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {promotions.map((promotion) => (
                    <article key={promotion.id} className="rounded-xl border border-[#dfe5f3] bg-white p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <h5 className="text-sm font-bold text-[#1f2d57]">{promotion.name}</h5>
                        <span className="rounded-md bg-[#edf2ff] px-2 py-1 text-[11px] font-semibold text-[#2a4792]">
                          {formatDiscount(promotion)}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-[#7280a7]">{promotion.description || 'Exclusive marketplace offer.'}</p>

                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                        {promotion.code ? (
                          <span className="rounded-md border border-[#d4dbec] bg-[#f8faff] px-2 py-1 text-[11px] font-semibold text-[#1f2d57]">
                            Code: {promotion.code}
                          </span>
                        ) : (
                          <span className="text-[11px] font-semibold text-[#7280a7]">Auto-applied promo</span>
                        )}

                        <span className="text-[11px] font-semibold text-[#7280a7]">
                          {promotion.expiresAt ? `Ends ${new Date(promotion.expiresAt).toLocaleDateString()}` : 'No expiry set'}
                        </span>
                      </div>

                      {typeof promotion.usageRemainingGlobal === 'number' && promotion.maxUses !== null && (
                        <p className="mt-2 text-[11px] text-[#5b678f]">
                          Remaining uses: {Math.max(0, promotion.usageRemainingGlobal)} of {promotion.maxUses}
                        </p>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-2">
              <h4 className="text-sm font-bold uppercase tracking-wide text-[#2a4792]">Limited Stock Cards</h4>
              {products.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[#d4dbec] bg-[#f8faff] px-4 py-5 text-center text-sm text-[#7c88ab]">
                  No low-stock cards found right now.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {products.map((product) => {
                    const busy = busyProductId === product.id;
                    const productImageSrc = resolveProductImageSrc(product.imgUrl);
                    return (
                      <article key={product.id} className="overflow-hidden rounded-xl border border-[#dfe5f3] bg-white shadow-sm">
                        <div className="aspect-video bg-[#edf2ff]">
                          {productImageSrc ? (
                            <img src={productImageSrc} alt={product.name} className="h-full w-full object-cover" />
                          ) : null}
                        </div>

                        <div className="space-y-3 p-3">
                          <div>
                            <p className="text-sm font-bold text-[#1f2d57]">{product.name}</p>
                            <p className="text-xs text-[#7280a7]">
                              {formatLabel(product.category)} • {product.stockQuantity} remaining
                            </p>
                          </div>

                          <div className="flex items-center justify-between">
                            <span className="text-sm font-bold text-[#1f2d57]">{pricePhp(product.price)}</span>
                            <button
                              type="button"
                              onClick={() => void handleAddToCart(product)}
                              disabled={busy || !product.inStock}
                              className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60"
                              style={{ background: 'linear-gradient(135deg, #2A4792, #4785B8)' }}
                            >
                              {busy ? <InlineLoader className="text-white" /> : <ShoppingCart className="h-4 w-4" />}
                              {busy ? 'Adding...' : 'Add'}
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </div> */}
      <h2 className="text-2xl font-bold text-primary">Coming Soon</h2>
    </div>
  );
}
