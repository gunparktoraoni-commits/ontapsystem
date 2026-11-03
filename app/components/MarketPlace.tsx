"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import PurchaseTab from "./marketplace/PurchaseTab";
import SubscriptionTab from "./marketplace/SubscriptionTab";
import CustomizeTemplatesTab from "./marketplace/CustomizeTemplatesTab";
import LimitedTab from "./marketplace/LimitedTab";
import { getFrontendApiBaseUrl } from "./apiBase";
import { fetchSubscriptionSummary, shouldRestrictMarketplaceTabs } from "./subscriptionAccess";
import { LuArrowLeft, LuShoppingCart } from "react-icons/lu";
import CartTab from "./marketplace/CartTab";
import CheckoutTab from "./marketplace/CheckoutTab";
import { resolvePersistedReferralCode } from "@/app/lib/referralStorage";
import ProductModal from "./marketplace/ProductModal";
import type { DirectCheckoutItem } from './marketplace/ProductModal';
import Link from "next/link";

// Define MarketplaceProduct type locally (matches the one used in PurchaseTab and ProductModal)
type MarketplaceProduct = {
  id: string;
  name: string;
  category: string;
  price: number;
  imgUrl: string | null;
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

const TABS: Array<{ id: MarketplaceTab; label: string }> = [
  { id: "purchase", label: "Purchase Cards" },
  { id: "subscription", label: "Subscription" },
  { id: "customize-templates", label: "Paid Templates" },
  { id: "limited", label: "Limited" },
  { id: "cart", label: "Cart" },
];

interface MarketPlaceProps {
  initialTab?: MarketplaceTab;
  reason?: string;
  referralCode?: string;
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

async function ensureCsrfToken(url: string): Promise<string | null> {
  const fromCookie = readCookie("csrf-token");
  if (fromCookie) return fromCookie;

  try {
    const origin = typeof url === "string" ? new URL(url).origin : "";
    const csrfUrl = origin ? `${origin}/api/csrf-token` : "/api/csrf-token";
    const res = await fetch(csrfUrl, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });
    if (!res.ok) return readCookie("csrf-token");
    const payload = (await res.json().catch(() => null)) as any;
    const token = payload?.csrfToken || payload?.csrf_token || payload?.token || null;
    return token?.trim() || readCookie("csrf-token");
  } catch {
    return readCookie("csrf-token");
  }
}

async function authFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const method = String(init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers ?? undefined);
  if (method !== "GET" && method !== "HEAD") {
    const csrfToken = await ensureCsrfToken(url);
    if (csrfToken) headers.set("X-CSRF-Token", csrfToken);
  }
  return fetch(url, {
    credentials: "include",
    cache: "no-store",
    ...init,
    method,
    headers,
  });
}

const MarketPlace = ({
  initialTab = "purchase",
  reason = "",
  referralCode = "",
}: MarketPlaceProps) => {
  const [activeTab, setActiveTab] = useState<MarketplaceTab>(initialTab);
  const [selectedProduct, setSelectedProduct] =
    useState<MarketplaceProduct | null>(null);
  const [checkoutSelectedIds, setCheckoutSelectedIds] = useState<
    string[] | undefined
  >(undefined);
  const [directCheckoutItem, setDirectCheckoutItem] = useState<DirectCheckoutItem | null>(null);
  const [marketplaceRestricted, setMarketplaceRestricted] = useState(false);
  const [marketplaceRestrictionNotice, setMarketplaceRestrictionNotice] = useState<string | null>(null);
  const referralRoutedRef = useRef(false);
  const API = getFrontendApiBaseUrl();

  useEffect(() => {
    resolvePersistedReferralCode(referralCode);
  }, [referralCode]);

  // After affiliate-link entry (or return from login with ?ref=): cart vs shop
  useEffect(() => {
    if (referralRoutedRef.current) return;
    const stored = resolvePersistedReferralCode(referralCode);
    if (!stored) return;
    if (initialTab === "cart" || initialTab === "checkout") {
      referralRoutedRef.current = true;
      return;
    }
    referralRoutedRef.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${API}/api/marketplace/cart?countOnly=1`, {
          credentials: "include",
          cache: "no-store",
        });
        const json = await res.json().catch(() => null);
        if (cancelled || !res.ok) return;
        const count = Number(
          json?.data?.itemCount ?? json?.data?.count ?? json?.data?.total ?? 0,
        );
        setActiveTab(count > 0 ? "cart" : "purchase");
      } catch {
        // keep current tab
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [API, initialTab, referralCode]);

  // Restore persisted checkout selection
  useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      const raw = sessionStorage.getItem("marketplace.checkoutSelectedIds");
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) setCheckoutSelectedIds(parsed.map(String));
    } catch {
      // ignore
    }
  }, []);

  // Persist selection
  useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      if (checkoutSelectedIds === undefined) {
        sessionStorage.removeItem("marketplace.checkoutSelectedIds");
      } else {
        sessionStorage.setItem(
          "marketplace.checkoutSelectedIds",
          JSON.stringify(checkoutSelectedIds),
        );
      }
    } catch {
      // ignore storage errors
    }
  }, [checkoutSelectedIds]);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    let active = true;

    const loadMarketplaceAccess = async () => {
      try {
        const summary = await fetchSubscriptionSummary(API);
        if (!active) return;

        const restricted = shouldRestrictMarketplaceTabs(summary.state, summary.currentPhysicalCards);
        setMarketplaceRestricted(restricted);

        if (restricted) {
          setMarketplaceRestrictionNotice(
            summary.state.access.reason === 'free_trial'
              ? 'Your account is on a free trial. Marketplace features are limited to purchases until a paid plan is active.'
              : 'Your account requires an active physical BizCard to access additional marketplace tabs.'
          );

          if (activeTab !== 'purchase') {
            setActiveTab('purchase');
          }
        } else {
          setMarketplaceRestrictionNotice(null);
        }
      } catch (error) {
        console.error('Failed to load marketplace access state:', error);
      }
    };

    void loadMarketplaceAccess();
    return () => {
      active = false;
    };
  }, [API, activeTab]);

  // Buy Now: skip cart and open Checkout with a single direct item.
  // Customer details are collected on the CheckoutTab form (do not POST here).
  const handleBuyNow = useCallback((item: DirectCheckoutItem) => {
    setDirectCheckoutItem(item);
    setCheckoutSelectedIds(undefined);
    setActiveTab("checkout");
  }, []);

  // Clear direct item after successful checkout
  const handleCheckoutSuccess = useCallback(() => {
    setDirectCheckoutItem(null);
    // Optionally redirect to a thank-you page or refresh cart
  }, []);

  const reasonMessage = useMemo(() => {
    const normalized = reason.trim().toLowerCase();
    if (normalized === "trial" || normalized === "trial_expired") {
      return "Your free trial has ended. Subscribe to keep premium features active.";
    }
    if (normalized === "expired" || normalized === "subscription_expired") {
      return "Your subscription is expired. Choose a plan to restore access.";
    }
    return "";
  }, [reason]);

  const restrictionMessage = useMemo(() => {
    if (!marketplaceRestricted || !marketplaceRestrictionNotice) return "";
    return marketplaceRestrictionNotice;
  }, [marketplaceRestricted, marketplaceRestrictionNotice]);

  const [cartCount, setCartCount] = useState<number>(0);
  const [cartLoading, setCartLoading] = useState<boolean>(true);

  const fetchCartCount = useCallback(async () => {
    setCartLoading(true);
    try {
      const res = await fetch(`${API}/api/marketplace/cart`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) {
        setCartCount(0);
        return;
      }
      const payload = (await res.json().catch(() => null)) as any;
      const items = Array.isArray(payload?.data?.items)
        ? payload.data.items
        : (payload?.items ?? []);
      setCartCount(items.length ?? 0);
    } catch {
      setCartCount(0);
    } finally {
      setCartLoading(false);
    }
  }, [API]);

  useEffect(() => {
    void ensureCsrfToken(API);
    void fetchCartCount();
    const handler = () => void fetchCartCount();
    window.addEventListener("storage", handler);
    window.addEventListener("cart:refresh", handler);
    return () => {
      window.removeEventListener("storage", handler);
      window.removeEventListener("cart:refresh", handler);
    };
  }, [API, fetchCartCount]);

  const content = useMemo(() => {
    if (activeTab === "purchase")
      return (
        <PurchaseTab
          referralCode={referralCode}
          setActiveTab={setActiveTab}
          setSelectedProduct={setSelectedProduct}
        />
      );
    if (activeTab === "subscription") return <SubscriptionTab />;
    if (activeTab === "productInfo" && selectedProduct)
      return (
        <ProductModal
          product={selectedProduct}
          onBack={() => {
            setActiveTab("purchase");
            setSelectedProduct(null);
          }}
          onBuyNow={handleBuyNow}
        />
      );
    if (activeTab === "customize-templates")
      return (
        <CustomizeTemplatesTab />
      );
    if (activeTab === "cart")
      return (
        <CartTab
          setActiveTab={setActiveTab}
          setSelectedItemIds={setCheckoutSelectedIds}
        />
      );
    if (activeTab === "checkout")
      return (
        <CheckoutTab
          selectedItemIds={directCheckoutItem ? undefined : checkoutSelectedIds}
          directItem={directCheckoutItem}
          onBack={() => {
            setActiveTab("cart");
            setDirectCheckoutItem(null);
          }}
          onSuccess={handleCheckoutSuccess}
        />
      );
    return <LimitedTab />;
  }, [
    activeTab,
    referralCode,
    checkoutSelectedIds,
    selectedProduct,
    directCheckoutItem,
    handleBuyNow,
    handleCheckoutSuccess,
  ]);

  const [title, description] = useMemo(() => {
    switch (activeTab) {
      case "purchase":
        return ["Purchase Cards", "Browse and purchase available items"];
      case "subscription":
        return [
          "Subscription Plans",
          "Choose a subscription plan that fits your needs",
        ];
      case "customize-templates":
        return [
          "Paid Templates",
          "Browse premium paid templates, or request a fully custom theme for your brand",
        ];
      case "limited":
        return [
          "Limited Access",
          "Your access is limited. Please contact support for assistance.",
        ];
      case "cart":
        return ["Your Cart", "Review items in your cart before checkout"];
      case "checkout":
        return ["Checkout", "Fill up the details and complete your purchase"];
      case "productInfo":
        return [selectedProduct?.name || "Product Details", ""];
      default:
        return ["Product Details", ""];
    }
  }, [activeTab, selectedProduct]);
  return (
    <div className="w-full min-h-full rounded-2xl border border-[#d8deee] bg-white p-4 sm:p-6 lg:p-7 shadow-sm">
      <header className="mb-6 flex flex-wrap items-start gap-3">
        {(activeTab === "cart" ||
          activeTab === "checkout" ||
          activeTab === "productInfo") && (
          <button
            type="button"
            className="text-2xl sm:text-3xl stroke-2 text-[#1e2f65] hover:text-primary-light transition-colors duration-200 mt-1 shrink-0"
            onClick={() => {
              if (activeTab === "productInfo") {
                setActiveTab("purchase");
                setSelectedProduct(null);
              } else if (activeTab === "cart") {
                setActiveTab("purchase");
              } else if (activeTab === "checkout") {
                setActiveTab("cart");
              }
            }}
          >
            <LuArrowLeft />
          </button>
        )}

        <span className="flex flex-col min-w-0 flex-1">
          <h1 className="text-xl sm:text-2xl lg:text-[30px] font-extrabold tracking-tight text-[#1e2f65] leading-tight">
            {title}
          </h1>
          <p className="text-xs sm:text-sm text-[#7b86a8] mt-0.5">{description}</p>
        </span>

        <div className="ml-auto flex items-center gap-2 shrink-0">
          {activeTab !== "cart" &&
            activeTab !== "checkout" &&
            activeTab !== "productInfo" && (
              <button
                onClick={() => setActiveTab("cart")}
                aria-label="View cart"
                className="flex items-center gap-1.5 rounded-lg pl-3 py-1 pr-1 bg-primary-light shadow-lg hover:shadow-xl hover:bg-primary transition-all duration-200"
              >
                <LuShoppingCart className="text-lg sm:text-xl text-white" />
                <span className="text-xs text-primary bg-white h-6 w-5 sm:h-7 sm:w-5 font-bold flex items-center justify-center rounded-sm">
                  {cartLoading ? "..." : String(cartCount)}
                </span>
              </button>
            )}

          <Link
            href="/user/orders"
            aria-label="View orders"
            className="px-2.5 sm:px-3 py-2 text-xs sm:text-sm shadow-lg hover:shadow-xl text-white rounded-lg flex items-center bg-primary-light hover:bg-primary transition-all duration-200 whitespace-nowrap"
          >
            My Orders
          </Link>
        </div>
      </header>
      {reasonMessage ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
          {reasonMessage}
        </div>
      ) : null}
      {restrictionMessage ? (
        <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-medium text-sky-900">
          {restrictionMessage}
        </div>
      ) : null}

      {activeTab !== "cart" &&
        activeTab !== "checkout" &&
        activeTab !== "productInfo" && (
          <div className="mb-6 flex flex-wrap items-center gap-2">
            {TABS.filter((tab) => !marketplaceRestricted || tab.id === "purchase")
              .filter((tab) => tab.label !== "Cart")
              .map((tab) => {
                const isActive = tab.id === activeTab;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`rounded-xl px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-semibold transition-all duration-300 shadow-sm border ${
                      isActive
                        ? "border-transparent text-white"
                        : "border-[#d8deee] bg-transparent text-[#4b5563] hover:bg-gray-50"
                    }`}
                    style={
                      isActive
                        ? {
                            background:
                              "linear-gradient(135deg, #2A4792, #4785B8)",
                          }
                        : {}
                    }
                  >
                    {tab.label}
                  </button>
                );
              })}
          </div>
        )}

      <motion.div
        key={activeTab}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
      >
        {content}
      </motion.div>
    </div>
  );
};

export default MarketPlace;
