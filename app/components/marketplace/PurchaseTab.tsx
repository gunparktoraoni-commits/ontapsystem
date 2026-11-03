"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { motion } from "framer-motion";

import { getFrontendApiBaseUrl } from "../apiBase";
import { InlineLoader } from '../Loader';
import { resolveProductImageSrc } from "@/lib/product-image";

const API = getFrontendApiBaseUrl();
const CSRF_COOKIE_NAME = "csrf-token";
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

type MarketplaceProduct = {
  id: string;
  name: string;
  category: string;
  price: number;
  imgUrl: string | null;
  image_url?: string | null;
  frontUrl?: string | null;
  front_img?: string | null;
  variable_front_img?: string | null;
  stockQuantity: number;
  inStock: boolean;
  description: string;
};

type MarketplaceTab =
  | "purchase"
  | "subscription"
  | "customize-templates"
  | "limited"
  | "productInfo"
  | "cart"
  | "checkout";

type MarketplaceCartItem = {
  id: string;
  itemType: string;
  itemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  available: boolean;
  details?: Record<string, unknown> | null;
};

type ApiEnvelope<T> = {
  success?: boolean;
  data?: T;
  message?: string;
  error?: unknown;
};

function pricePhp(value: number): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 0,
  }).format(value);
}

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

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const raw = payload as Record<string, unknown>;
  if (typeof raw.error === "string" && raw.error.trim()) return raw.error;
  if (raw.error && typeof raw.error === "object") {
    const err = raw.error as Record<string, unknown>;
    if (typeof err.message === "string" && err.message.trim())
      return err.message;
  }
  if (typeof raw.message === "string" && raw.message.trim()) return raw.message;
  return fallback;
}

function formatLabel(raw: string): string {
  return raw
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getProductImageRaw(product: MarketplaceProduct): string | null {
  const candidates: Array<string | null | undefined> = [
    product.imgUrl,
    product.image_url,
    product.frontUrl,
    product.front_img,
    product.variable_front_img,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

async function ensureCsrfToken(): Promise<string | null> {
  const fromCookie = readCookie(CSRF_COOKIE_NAME);
  if (fromCookie) return fromCookie;
  try {
    const response = await fetch(`${API}/api/csrf-token`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) return readCookie(CSRF_COOKIE_NAME);
    const payload = (await response.json()) as Record<string, unknown>;
    const data =
      payload.data && typeof payload.data === "object"
        ? (payload.data as Record<string, unknown>)
        : null;
    const token =
      (typeof payload.csrfToken === "string" && payload.csrfToken) ||
      (typeof payload.csrf_token === "string" && payload.csrf_token) ||
      (typeof payload.token === "string" && payload.token) ||
      (data && typeof data.csrfToken === "string" && data.csrfToken) ||
      null;
    return token?.trim() || readCookie(CSRF_COOKIE_NAME);
  } catch {
    return readCookie(CSRF_COOKIE_NAME);
  }
}

async function authFetch(
  url: string,
  init: RequestInit = {},
  canRetry = true,
): Promise<Response> {
  const method = String(init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers ?? undefined);
  if (MUTATING_METHODS.has(method)) {
    const csrfToken = await ensureCsrfToken();
    if (csrfToken) headers.set("X-CSRF-Token", csrfToken);
  }
  const requestInit: RequestInit = {
    credentials: "include",
    cache: "no-store",
    ...init,
    method,
    headers,
  };
  const response = await fetch(url, requestInit);
  if (canRetry && (response.status === 401 || response.status === 403)) {
    const refreshHeaders = new Headers();
    const refreshToken = await ensureCsrfToken();
    if (refreshToken) refreshHeaders.set("X-CSRF-Token", refreshToken);
    const refreshResponse = await fetch(`${API}/api/auth/refresh`, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: refreshHeaders,
    });
    if (refreshResponse.ok) {
      return fetch(url, requestInit);
    }
  }
  return response;
}

import {
  resolvePersistedReferralCode,
} from "@/app/lib/referralStorage";
import { sortMerchandiseByCatalogOrder } from "@/lib/merchandise-catalog-order";

type PurchaseTabProps = {
  referralCode?: string;
  setActiveTab: (tab: MarketplaceTab) => void;
  setSelectedProduct: (product: MarketplaceProduct | null) => void;
};

export default function PurchaseTab({
  referralCode = "",
  setActiveTab,
  setSelectedProduct,
}: PurchaseTabProps) {
  const [products, setProducts] = useState<MarketplaceProduct[]>([]);
  const [cart, setCart] = useState<MarketplaceCartItem[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [cartLoading, setCartLoading] = useState(true);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [cartError, setCartError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [checkoutMessage, setCheckoutMessage] = useState<string | null>(null);
  const [activeProductId, setActiveProductId] = useState<string | null>(null);
  const router = useRouter();
  const [activeCartItemId, setActiveCartItemId] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);

  useEffect(() => {
    resolvePersistedReferralCode(referralCode);
  }, [referralCode]);

  const loadProducts = useCallback(async () => {
    setProductsLoading(true);
    setProductsError(null);
    try {
      const response = await authFetch(
        `${API}/api/products?sort_by=catalog&limit=50`,
      );
      const payload = (await response.json().catch(() => null)) as
        | { success?: boolean; data?: { products?: any[]; pagination?: any; categories?: string[] } }
        | null;
      if (!response.ok || !payload?.success) {
        throw new Error(
          extractErrorMessage(payload, "Unable to load marketplace products."),
        );
      }
      const serverProducts = Array.isArray(payload.data?.products) ? payload.data!.products! : [];
      const mapped: MarketplaceProduct[] = serverProducts.map((p: any) => ({
        id: String(p.productID ?? p.id ?? p._id ?? ""),
        name: String(p.name ?? p.title ?? ""),
        category: String(p.category ?? "uncategorized"),
        price: typeof p.price === "number" ? p.price : Number(p.price ?? 0),
        imgUrl:
          (typeof p.imgUrl === "string" && p.imgUrl) ||
          (typeof p.image_url === "string" && p.image_url) ||
          (typeof p.frontUrl === "string" && p.frontUrl) ||
          (typeof p.front_img === "string" && p.front_img) ||
          (typeof p.variableFrontImg === "string" && p.variableFrontImg) ||
          (typeof p.variable_front_img === "string" && p.variable_front_img) ||
          null,
        stockQuantity: typeof p.stockQuantity === "number" ? p.stockQuantity : Number(p.stockQuantity ?? 0),
        inStock:
          p.inStock != null
            ? Boolean(p.inStock)
            : Number(p.stockQuantity ?? 0) > 0,
        description: String(p.description ?? p.short_description ?? ""),
      }));
      setProducts(sortMerchandiseByCatalogOrder(mapped));
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to load marketplace products.";
      setProductsError(message);
      setProducts([]);
    } finally {
      setProductsLoading(false);
    }
  }, []);

  const loadCart = useCallback(async () => {
    setCartLoading(true);
    setCartError(null);
    try {
      const response = await authFetch(`${API}/api/marketplace/cart`);
      const payload = (await response.json().catch(() => null)) as ApiEnvelope<{
        items?: MarketplaceCartItem[];
      }> | null;
      if (response.status === 401) {
        setCart([]);
        setCartError("Please log in to manage your marketplace cart.");
        return;
      }
      if (!response.ok || !payload?.success) {
        throw new Error(
          extractErrorMessage(payload, "Unable to load your cart items."),
        );
      }
      const items = Array.isArray(payload.data?.items) ? payload.data.items : [];
      setCart(items);
      try {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem('ontap_cart_count', String(items.length ?? 0));
          window.dispatchEvent(new Event('ontap_cart_updated'));
        }
      } catch {}
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to load your cart items.";
      setCartError(message);
      setCart([]);
      try {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem('ontap_cart_count', '0');
          window.dispatchEvent(new Event('ontap_cart_updated'));
        }
      } catch {}
    } finally {
      setCartLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.all([loadProducts(), loadCart()]);
  }, [loadCart, loadProducts]);

  const renderProducts = () => {
    if (productsLoading) {
      return (
        <div className="flex min-h-55 items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-gray-50">
          <div className="inline-flex items-center gap-2 text-sm font-medium text-gray-500">
            <InlineLoader />
            Loading products...
          </div>
        </div>
      );
    }
    if (productsError) {
      return (
        <div className="flex min-h-55 flex-col items-center justify-center rounded-2xl border border-red-100 bg-red-50/60 px-6 text-center">
          <p className="text-sm font-medium text-red-600">{productsError}</p>
          <button
            type="button"
            onClick={() => void loadProducts()}
            className="mt-3 rounded-lg border border-red-200 bg-white px-4 py-2 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50"
          >
            Retry Products
          </button>
        </div>
      );
    }


    if (products.length === 0) {
      return (
        <div className="flex min-h-55 items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-gray-50 text-sm text-gray-500">
          No products are available right now.
        </div>
      );
    }
    
// this is the sample site that I want to use

    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((product, index) => {
          const productImageSrc = resolveProductImageSrc(getProductImageRaw(product));
          return (
          <motion.article
            key={product.id}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, delay: index * 0.06 }}
            whileHover={{ y: -6, scale: 1.01 }}
            onClick={() => {
              setSelectedProduct(product);
              setActiveTab("productInfo");
            }}
            className="group cursor-pointer h-max rounded-2xl border border-gray-100 bg-white p-4 shadow-sm transition-all duration-300 hover:border-blue-100 hover:shadow-md"
          >
            <div className={`relative mb-4 w-full aspect-video overflow-hidden rounded-xl bg-gray-50`}>
              {productImageSrc ? (
                <Image
                  src={productImageSrc}
                  alt={product.name}
                  fill
                  sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                  className={`h-full w-full ${formatLabel(product.category).toLowerCase() === "other products" ? "object-contain" : "object-cover"} transition-transform duration-500 group-hover:scale-105`}
                  unoptimized
                  draggable={false}
                />
              ) : null}
            </div>
            <div className="flex h-full flex-col">
              <div className="mb-2">
                <h3 className="text-lg font-semibold tracking-tight text-gray-900">
                  {product.name}
                </h3>
                <p className="text-xs font-medium text-gray-500 uppercase">
                  {formatLabel(product.category).toLowerCase()}
                </p>
              </div>
              <div className="ml-auto flex-1">
                <p className={`${product.price !== 0 ? "text-xl" : "text-lg"} font-bold text-primary`}>
                  {product.price !== 0 ? pricePhp(product.price) : "Upon Inquiry"}
                </p>
              </div>
            </div>
          </motion.article>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {actionError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {actionError}
        </div>
      )}
      {checkoutMessage && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
          {checkoutMessage}
        </div>
      )}
      <div className="grid grid-cols-1 gap-4">
        <section className="space-y-3">{renderProducts()}</section>
      </div>
    </div>
  );
}