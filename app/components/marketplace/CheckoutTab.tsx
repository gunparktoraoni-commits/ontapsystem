"use client";

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import {
  LuChevronDown,
  LuPhilippinePeso,
  LuMapPin,
  LuPackage,
  LuStore,
} from "react-icons/lu";
import { getFrontendApiBaseUrl } from "../apiBase";
import { resolveProductImageSrc } from "@/lib/product-image";
import { showToast } from "../Toast";
import { USER_NOTICES } from "@/lib/user-notices";

// ---------- Import the DirectCheckoutItem type from ProductModal ----------
// This ensures the same type is used across the application
import type { DirectCheckoutItem } from "./ProductModal";
import { InlineLoader, SectionLoader } from "../Loader";
import {
  resolvePersistedReferralCode,
  setStoredReferralCode,
} from "@/app/lib/referralStorage";

// ---------- Types ----------
type ShippingMethod = "" | "Pick Up at Store" | "Deliver at my Address";

interface CartItem {
  id: string;
  itemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  image?: string;
  customData?: Record<string, string | number | boolean | null> | null;
}

interface CheckoutFormValues {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  brgy: string;
  village: string;
  unitInfo: string;
  postal: string;
}

type FormField = keyof CheckoutFormValues | "shippingMethod" | "region" | "city";
type FieldErrors = Partial<Record<FormField, string>>;

export interface CheckoutTabProps {
  selectedItemIds?: string[];
  directItem?: DirectCheckoutItem | null;
  onSuccess?: () => void;
  onBack?: () => void;
}

// ---------- Constants & Helpers ----------
const API = getFrontendApiBaseUrl();

const regions = [
  "NCR",
  "Region 1 (Ilocos Region)",
  "Region 2 (Cagayan Valley)",
  "Region 3 (Central Luzon)",
  "Region 4A (Calabarzon)",
  "Region 4B (Mimaropa)",
  "Region 5 (Bicol Region)",
  "Region 6 (Western Visayas)",
  "Region 7 (Central Visayas)",
  "Region 8 (Eastern Visayas)",
  "Region 9 (Zamboanga Peninsula)",
  "Region 10 (Northern Mindanao)",
  "Region 11 (Davao Region)",
  "Region 12 (Soccsksargen)",
  "Region 13 (Caraga)",
  "CAR",
  "BARMM",
];

const cities: Record<string, string[]> = {
  "Region 1 (Ilocos Region)": [
    "Alaminos", "Batac", "Candon", "Dagupan", "Ilagan", "Laoag",
    "San Carlos", "San Fernando", "Urdaneta", "Vigan",
  ],
  "Region 2 (Cagayan Valley)": ["Cauayan", "Ilagan", "Santiago", "Tuguegarao"],
  "Region 3 (Central Luzon)": [
    "Angeles", "Balanga", "Cabanatuan", "Gapan", "Mabalacat", "Malolos",
    "Meycauayan", "Muñoz", "Olongapo", "Palayan", "San Fernando", "San Jose",
    "San Jose del Monte", "Tarlac",
  ],
  "Region 4A (Calabarzon)": [
    "Antipolo", "Bacoor", "Batangas City", "Biñan", "Cabuyao", "Calamba",
    "Cavite City", "Dasmariñas", "General Trias", "Imus", "Lipa", "Lucena",
    "San Pablo", "San Pedro", "Santa Rosa", "Santo Tomas", "Tagaytay",
    "Tanauan", "Tayabas", "Trece Martires",
  ],
  "Region 4B (Mimaropa)": ["Calapan", "Puerto Princesa"],
  "Region 5 (Bicol Region)": [
    "Iriga", "Legazpi", "Ligao", "Masbate City", "Naga", "Sorsogon City", "Tabaco",
  ],
  "Region 6 (Western Visayas)": [
    "Bacolod", "Bago", "Cadiz", "Escalante", "Himamaylan", "Iloilo City",
    "Kabankalan", "La Carlota", "Passi", "Roxas", "Sagay", "San Carlos",
    "Silay", "Sipalay", "Talisay", "Victorias",
  ],
  "Region 7 (Central Visayas)": [
    "Bais", "Bayawan", "Bogo", "Canlaon", "Carcar", "Cebu City", "Danao",
    "Dumaguete", "Guihulngan", "Lapu-Lapu", "Mandaue", "Naga", "Tagbilaran",
    "Talisay", "Tanjay", "Toledo",
  ],
  "Region 8 (Eastern Visayas)": [
    "Baybay", "Borongan", "Calbayog", "Catbalogan", "Maasin", "Ormoc", "Tacloban",
  ],
  "Region 9 (Zamboanga Peninsula)": [
    "Dapitan", "Dipolog", "Isabela", "Pagadian", "Zamboanga City",
  ],
  "Region 10 (Northern Mindanao)": [
    "Cagayan de Oro", "El Salvador", "Gingoog", "Iligan", "Malaybalay",
    "Oroquieta", "Ozamiz", "Tangub", "Valencia",
  ],
  "Region 11 (Davao Region)": [
    "Davao City", "Digos", "Mati", "Panabo", "Samal", "Tagum",
  ],
  "Region 12 (Soccsksargen)": [
    "General Santos", "Kidapawan", "Koronadal", "Tacurong",
  ],
  "Region 13 (Caraga)": [
    "Bislig", "Butuan", "Cabadbaran", "Surigao City", "Tandag",
  ],
  NCR: [
    "Caloocan", "Las Piñas", "Makati", "Malabon", "Mandaluyong", "Manila",
    "Marikina", "Muntinlupa", "Navotas", "Parañaque", "Pasay", "Pasig",
    "Quezon City", "San Juan", "Taguig", "Valenzuela",
  ],
  CAR: ["Baguio", "Tabuk"],
  BARMM: ["Cotabato City", "Lamitan", "Marawi"],
};

const STORE_COORDINATES = { lat: 14.4284392, lng: 120.9859646 };
const storeMapEmbedUrl = `https://www.google.com/maps?q=${encodeURIComponent(
  `${STORE_COORDINATES.lat},${STORE_COORDINATES.lng}`
)}&z=17&output=embed`;
const storeMapExternalUrl =
  "https://www.bing.com/maps/directions?ty=0&v=2&sV=1&style=r&rtp=%7Epos.14.4434814453125_120.99861907958984__Burnbox%2520Printing%2520and%2520Graphic%2520Design_&mode=d&cp=14.443546%7E120.996767&lvl=17.4";

const trimAndCollapseWhitespace = (v: string) =>
  v.trim().replace(/\s{2,}/g, " ");
const sanitizeName = (v: string, max = 60) =>
  v.replace(/[^a-zA-Z\s.'-]/g, "").replace(/\s{2,}/g, " ").slice(0, max);
const sanitizeAddress = (v: string, max = 100) =>
  v.replace(/[^a-zA-Z0-9\s.,#'/-]/g, "").replace(/\s{2,}/g, " ").slice(0, max);
const formatDigits = (v: string, max: number) =>
  v.replace(/\D/g, "").slice(0, max);
const formatPhone = (v: string) => {
  const d = formatDigits(v, 11);
  if (d.length <= 4) return d;
  if (d.length <= 7) return `${d.slice(0, 4)} ${d.slice(4)}`;
  return `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
};
const toTitleCase = (v: string) =>
  v.replace(/\b\w/g, (c) => c.toUpperCase());

const isValidName = (v: string) => /^[A-Za-z]+(?:[ '-.][A-Za-z]+)*$/.test(v);
const isValidEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
const isValidPhone = (d: string) => /^09\d{9}$/.test(d);

// ---------- CSRF Helpers ----------
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
  if (!forceFetch && fromCookie) return fromCookie;
  try {
    const res = await fetch(`${API}/api/csrf-token`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });
    if (!res.ok) return readCookie(CSRF_COOKIE_NAME);
    const payload = await res.json().catch(() => null);
    const token =
      payload?.csrfToken ||
      payload?.csrf_token ||
      payload?.token ||
      payload?.data?.csrfToken ||
      payload?.data?.csrf_token ||
      null;
    return typeof token === "string" && token.trim() ? token.trim() : readCookie(CSRF_COOKIE_NAME);
  } catch {
    return readCookie(CSRF_COOKIE_NAME);
  }
}

async function getCsrfHeaders(forceFetch = false): Promise<Headers | null> {
  const token = await ensureCsrfToken(forceFetch);
  if (!token) return null;
  const h = new Headers();
  h.set("X-CSRF-Token", token);
  h.set("x-csrf-token", token);
  h.set("X-XSRF-TOKEN", token);
  h.set("x-xsrf-token", token);
  return h;
}

async function authFetch(
  url: string,
  init: RequestInit = {},
  canRetry = true
): Promise<Response> {
  const method = String(init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers ?? undefined);
  const existingCsrf =
    headers.get("x-csrf-token") ||
    headers.get("X-CSRF-Token") ||
    headers.get("x-xsrf-token");

  if (MUTATING_METHODS.has(method) && !existingCsrf) {
    const csrfHeaders = await getCsrfHeaders();
    if (csrfHeaders) {
      for (const [k, v] of csrfHeaders.entries()) headers.set(k, v);
    }
  }

  const requestInit: RequestInit = {
    credentials: "include",
    cache: "no-store",
    ...init,
    method,
    headers,
  };
  const res = await fetch(url, requestInit);

  if (canRetry && (res.status === 401 || res.status === 403)) {
    const freshHeaders = await getCsrfHeaders(true);
    if (freshHeaders) {
      for (const [k, v] of freshHeaders.entries()) headers.set(k, v);
      const retryInit = { ...requestInit, headers };
      const retryRes = await fetch(url, retryInit);
      if (retryRes.ok) return retryRes;
    }
  }
  return res;
}

// ---------- UI Components ----------
interface DropdownProps {
  options: string[];
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  disabled?: boolean;
  error?: string;
  className?: string;
}

const CustomDropdown: React.FC<DropdownProps> = ({
  options,
  value,
  onChange,
  placeholder,
  disabled,
  error,
  className = "",
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const displayValue = value || "";

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`w-full flex items-center justify-between px-4 py-3 bg-white border rounded-xl text-sm font-medium transition-all duration-200 ${
          error
            ? "border-red-500 ring-2 ring-red-200"
            : "border-gray-200 hover:border-primary focus:ring-2 focus:ring-primary"
        } ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
      >
        <span className={!displayValue ? "text-gray-400" : "text-gray-700"}>
          {displayValue || placeholder}
        </span>
        <motion.div
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <LuChevronDown className="text-gray-400 text-sm" />
        </motion.div>
      </button>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
      <AnimatePresence>
        {isOpen && !disabled && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            className="absolute top-full left-0 right-0 mt-2 bg-white border border-gray-100 rounded-xl shadow-lg z-50 max-h-60 overflow-y-auto"
          >
            {options.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  onChange(opt);
                  setIsOpen(false);
                }}
                className={`w-full text-left px-4 py-2.5 text-sm transition-colors duration-150 ${
                  value === opt
                    ? "bg-gradient-to-r from-primary to-primary-light text-white"
                    : "text-gray-700 hover:bg-gray-50"
                }`}
              >
                {opt}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const InputField: React.FC<{
  name: keyof CheckoutFormValues;
  placeholder: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onBlur?: () => void;
  error?: string;
  inputMode?: "text" | "numeric" | "email";
  autoComplete?: string;
  containerClassName?: string;
}> = ({
  name,
  placeholder,
  value,
  onChange,
  onBlur,
  error,
  inputMode,
  autoComplete,
  containerClassName = "",
}) => (
  <div className={containerClassName}>
    <input
      type="text"
      name={name}
      id={name}
      placeholder={placeholder}
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      inputMode={inputMode}
      autoComplete={autoComplete}
      className={`w-full px-4 py-3 bg-white border rounded-xl text-sm transition-all duration-200 focus:outline-none ${
        error
          ? "border-red-500 ring-2 ring-red-200"
          : "border-gray-200 hover:border-primary focus:ring-2 focus:ring-primary"
      }`}
    />
    {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
  </div>
);

// ---------- Main CheckoutTab Component ----------
export default function CheckoutTab({ selectedItemIds, directItem, onSuccess, onBack }: CheckoutTabProps) {
  // State
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [cartLoading, setCartLoading] = useState(true);
  const [subtotal, setSubtotal] = useState(0);
  const [affiliateEligible, setAffiliateEligible] = useState(false);
  const [referralCode, setReferralCode] = useState("");
  const [referralError, setReferralError] = useState<string | null>(null);
  const [referralValidating, setReferralValidating] = useState(false);
  const [referralValid, setReferralValid] = useState(false);

  const [shippingMethod, setShippingMethod] = useState<ShippingMethod>("");
  const [selectedRegion, setSelectedRegion] = useState("");
  const [selectedCity, setSelectedCity] = useState("");
  const [formValues, setFormValues] = useState<CheckoutFormValues>({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    brgy: "",
    village: "",
    unitInfo: "",
    postal: "",
  });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitMessage, setSubmitMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Derived data
  const selectedCartItems = cartItems.filter((item) => selectedIds.has(item.id));
  const total = subtotal;
  const cityOptions = selectedRegion ? cities[selectedRegion] || [] : [];

  // ---------- Fetch data (cart or direct item) ----------
  const fetchCart = useCallback(async () => {
    setCartLoading(true);
    try {
      const res = await authFetch(`${API}/api/marketplace/cart`);
      if (!res.ok) throw new Error("Failed to fetch cart");
      const json = await res.json();
      const items = (json?.data?.items || []).map((it: any) => ({
        id: it.id,
        itemId: String(it.itemId ?? it.itemID ?? it.productId ?? ""),
        name: it.name,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        lineTotal: it.lineTotal,
        image: resolveProductImageSrc(it.details?.imgUrl),
        customData: it.customData || it.details?.customData || null,
      }));
      setCartItems(items);

      let ids: Set<string>;
      if (selectedItemIds && selectedItemIds.length > 0) {
        ids = new Set(selectedItemIds);
        const existingIds = new Set(items.map((i: CartItem) => i.id));
        ids = new Set([...ids].filter((id) => existingIds.has(id)));
      } else {
        ids = new Set(items.map((i: CartItem) => i.id));
      }
      setSelectedIds(ids);

      const selectedSub = items
        .filter((i: CartItem) => ids.has(i.id))
        .reduce((sum: number, i: CartItem) => sum + i.lineTotal, 0);
      setSubtotal(selectedSub);
    } catch (err) {
      console.error(err);
      showToast(USER_NOTICES.networkError, "error");
    } finally {
      setCartLoading(false);
    }
  }, [selectedItemIds]);

  // Handle direct item
  useEffect(() => {
    if (directItem) {
      // Convert direct item to a CartItem-like object
      const mockCartItems: CartItem[] = [{
        id: directItem.id,
        itemId: String(directItem.itemId),
        name: directItem.name,
        quantity: directItem.quantity,
        unitPrice: directItem.unitPrice,
        lineTotal: directItem.lineTotal,
        image: directItem.image,
        customData: directItem.customData as Record<string, string | number | boolean | null> | undefined,
      }];
      setCartItems(mockCartItems);
      setSelectedIds(new Set([directItem.id]));
      setSubtotal(directItem.lineTotal);
      setCartLoading(false);
    } else if (selectedItemIds !== undefined) {
      // If we have selectedItemIds but no directItem, load cart normally
      fetchCart();
    } else {
      // No direct item, no selectedItemIds → load entire cart
      fetchCart();
    }
  }, [directItem, selectedItemIds, fetchCart]);

  // Prefill referral from persistent storage and validate
  useEffect(() => {
    const stored = resolvePersistedReferralCode();
    if (stored) setReferralCode(stored);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`${API}/api/user/checkout/eligibility`, {
          credentials: "include",
          cache: "no-store",
        });
        const json = await res.json().catch(() => null);
        if (res.ok && json?.success) {
          setAffiliateEligible(Boolean(json.data?.affiliate_eligible));
        }
      } catch {
        setAffiliateEligible(false);
      }
    })();
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
      setReferralError(null);
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

  // ---------- Field handlers ----------
  const handleFieldChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    const field = name as keyof CheckoutFormValues;
    let next = value;
    if (field === "firstName" || field === "lastName") next = sanitizeName(value);
    else if (field === "email") next = value.replace(/\s/g, "").slice(0, 80).toLowerCase();
    else if (field === "phone") next = formatPhone(value);
    else if (field === "brgy" || field === "village" || field === "unitInfo") next = sanitizeAddress(value);
    else if (field === "postal") next = formatDigits(value, 4);
    setFormValues((prev) => ({ ...prev, [field]: next }));
    setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
    setSubmitMessage("");
  };

  const handleFieldBlur = (field: keyof CheckoutFormValues) => {
    setFormValues((prev) => {
      if (["firstName", "lastName", "brgy", "village"].includes(field)) {
        return { ...prev, [field]: toTitleCase(prev[field]) };
      }
      if (field === "unitInfo") return { ...prev, unitInfo: trimAndCollapseWhitespace(prev.unitInfo) };
      return prev;
    });
  };

  const handleShippingChange = (method: string) => {
    setShippingMethod(method as ShippingMethod);
    setFieldErrors((prev) => ({ ...prev, shippingMethod: undefined }));
  };

  const handleRegionChange = (region: string) => {
    setSelectedRegion(region);
    setSelectedCity("");
    setFieldErrors((prev) => ({ ...prev, region: undefined, city: undefined }));
  };

  const handleCityChange = (city: string) => {
    setSelectedCity(city);
    setFieldErrors((prev) => ({ ...prev, city: undefined }));
  };

  const validateForm = (): boolean => {
    const errors: FieldErrors = {};
    if (!shippingMethod) errors.shippingMethod = "Please select a shipping method";
    if (!formValues.firstName.trim()) errors.firstName = "First name is required";
    else if (!isValidName(formValues.firstName)) errors.firstName = "Invalid first name";
    if (!formValues.lastName.trim()) errors.lastName = "Last name is required";
    else if (!isValidName(formValues.lastName)) errors.lastName = "Invalid last name";
    if (!formValues.email.trim()) errors.email = "Email is required";
    else if (!isValidEmail(formValues.email)) errors.email = "Invalid email address";
    if (!formValues.phone.trim()) errors.phone = "Phone number is required";
    else if (!isValidPhone(formatDigits(formValues.phone, 11))) errors.phone = "Must be 09xxxxxxxxx";

    // Address validation only for "Deliver at my Address" (currently disabled, but keeping for future)
    if (shippingMethod === "Deliver at my Address") {
      if (!selectedRegion) errors.region = "Please select a region";
      if (!selectedCity) errors.city = "Please select a city";
      if (!formValues.brgy.trim()) errors.brgy = "Barangay is required";
      if (!formValues.unitInfo.trim()) errors.unitInfo = "Street / unit info is required";
      if (!formValues.postal.trim()) errors.postal = "Postal code is required";
      else if (!/^\d{4}$/.test(formValues.postal)) errors.postal = "Must be 4 digits";
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // ---------- Submit handler: selects correct endpoint ----------
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;
    if (selectedCartItems.length === 0 && !directItem) {
      showToast("Please select at least one item before checking out.", "error");
      return;
    }

    setIsSubmitting(true);
    setSubmitMessage("");

    const shippingAddress =
      shippingMethod === "Deliver at my Address"
        ? {
            region: selectedRegion,
            city: selectedCity,
            barangay: formValues.brgy,
            subdivision: formValues.village,
            street: formValues.unitInfo,
            postalCode: formValues.postal,
          }
        : null;

    const payload: any = {
      customer: {
        email: formValues.email,
        given_names: formValues.firstName.trim(),
        last_name: formValues.lastName.trim() || null,
        phone: formValues.phone.trim() || null,
        mobile_number: formValues.phone.trim() || null,
      },
      shipping_method: shippingMethod,
      shipping_address: shippingAddress,
    };

    const trimmedReferral = referralCode.trim();
    if (trimmedReferral) {
      if (!affiliateEligible) {
        setReferralError("Referral code cannot be applied to this order.");
        setIsSubmitting(false);
        return;
      }
      if (referralError || !referralValid) {
        setReferralError(referralError || "Referral code is invalid.");
        setIsSubmitting(false);
        return;
      }
      payload.referral_code = trimmedReferral;
      setStoredReferralCode(trimmedReferral);
    }

    // Decide which endpoint to call
    let url = `${API}/api/marketplace/checkout`;
    let isDirect = false;

    if (directItem) {
      // Use the direct-checkout API for a single item purchase
      url = `${API}/api/marketplace/direct-checkout`;
      isDirect = true;
      payload.item = {
        itemId: Number(directItem.itemId),
        quantity: directItem.quantity,
        custom_data: directItem.customData || null,
      };
      // Remove the customer field we added; the direct endpoint expects customer as a nested object.
      // Actually we already have customer, that's fine.
    } else {
      // Cart-based checkout: send selectedItemIds
      payload.selectedItemIds = selectedCartItems.map((item) => item.id);
    }

    try {
      const csrfHeaders = await getCsrfHeaders(true);
      const headersInit: HeadersInit = {
        "Content-Type": "application/json",
      };
      if (csrfHeaders) {
        for (const [k, v] of csrfHeaders.entries()) headersInit[k] = v;
      }
      const res = await authFetch(url, {
        method: "POST",
        headers: headersInit,
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const errorMsg =
          data?.error?.message ||
          data?.error?.details?.reason ||
          data?.error ||
          data?.message ||
          "Checkout failed";
        const msg = typeof errorMsg === "string" ? errorMsg : "Checkout failed";
        if (/referral/i.test(msg)) {
          setReferralError(msg);
        }
        throw new Error(msg);
      }

      const orderObj = data?.data?.order;
      if (!orderObj) throw new Error("No order information returned");

      if (orderObj.requiresPayment === false) {
        const orderNum = orderObj.orderNumber ?? orderObj.orderNumber ?? "";
        const msg = `Order confirmed${orderNum ? ` — ${orderNum}` : ""}. No payment is required. Our staff will contact you shortly.`;
        setSubmitMessage(msg);
        showToast(USER_NOTICES.orderPlaced, "success");
        if (onSuccess) onSuccess();
      } else if (orderObj.invoiceUrl) {
        showToast("Your payment page is ready. Redirecting you now…", "success");
        setTimeout(() => {
          window.location.href = orderObj.invoiceUrl;
        }, 1500);
      } else {
        throw new Error("Invoice created but no payment URL returned");
      }
    } catch (err: any) {
      const errorMessage = err?.message || "An unexpected error occurred";
      setSubmitMessage(errorMessage);
      showToast(errorMessage, "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  // ------------------------------------------------------------------
  // Loading: show full-page overlay
  // ------------------------------------------------------------------
  if (cartLoading) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-white/80 backdrop-blur-sm">
        <SectionLoader text="Loading checkout..." />
      </div>
    );
  }

  if (cartItems.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="w-24 h-24 mx-auto rounded-full bg-gray-100 flex items-center justify-center mb-4">
          <LuPackage className="text-4xl text-gray-400" />
        </div>
        <h3 className="text-xl font-semibold">Your cart is empty</h3>
        <p className="text-gray-500 mt-2">Add items to proceed to checkout.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left column: Form */}
        <div className="lg:col-span-2 space-y-5">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Shipping Method */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <h3 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
                <LuStore className="text-primary" /> Shipping Method
              </h3>
              <CustomDropdown
                options={["Pick Up at Store"]}
                value={shippingMethod}
                onChange={handleShippingChange}
                placeholder="Select shipping method"
                error={fieldErrors.shippingMethod}
              />
              {/* <div className="text-xs text-gray-500 mt-3 p-3 bg-gray-50 rounded-lg">
                <p className="font-medium mb-2">Available Options:</p>
                <ul className="space-y-1">
                  <li>• Pick Up at Store</li>
                  <li>• Deliver at my Address (Coming Soon)</li>
                </ul>
              </div> */}
              {shippingMethod === "Deliver at my Address" && (
                <p className="text-xs text-gray-500 mt-2">
                  *Delivery fees are not included and will be shouldered by the customer.
                </p>
              )}
            </div>

            {/* Recipient Details */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <h3 className="text-lg font-semibold text-gray-800 mb-3">Recipient Details</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <InputField
                  name="firstName"
                  placeholder="First Name"
                  value={formValues.firstName}
                  onChange={handleFieldChange}
                  onBlur={() => handleFieldBlur("firstName")}
                  error={fieldErrors.firstName}
                />
                <InputField
                  name="lastName"
                  placeholder="Last Name"
                  value={formValues.lastName}
                  onChange={handleFieldChange}
                  onBlur={() => handleFieldBlur("lastName")}
                  error={fieldErrors.lastName}
                />
                <InputField
                  name="email"
                  placeholder="Email Address"
                  value={formValues.email}
                  onChange={handleFieldChange}
                  inputMode="email"
                  autoComplete="email"
                  error={fieldErrors.email}
                />
                <InputField
                  name="phone"
                  placeholder="Phone Number"
                  value={formValues.phone}
                  onChange={handleFieldChange}
                  inputMode="numeric"
                  autoComplete="tel"
                  error={fieldErrors.phone}
                />
              </div>
            </div>

            {/* Delivery Address (conditional) */}
            <AnimatePresence mode="wait">
              {shippingMethod === "Deliver at my Address" && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5"
                >
                  <h3 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
                    <LuMapPin className="text-primary" /> Delivery Address
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <CustomDropdown
                      options={regions}
                      value={selectedRegion}
                      onChange={handleRegionChange}
                      placeholder="Select Region"
                      error={fieldErrors.region}
                    />
                    <CustomDropdown
                      options={cityOptions}
                      value={selectedCity}
                      onChange={handleCityChange}
                      placeholder="Select City"
                      disabled={!selectedRegion}
                      error={fieldErrors.city}
                    />
                    <InputField
                      name="brgy"
                      placeholder="Barangay"
                      value={formValues.brgy}
                      onChange={handleFieldChange}
                      onBlur={() => handleFieldBlur("brgy")}
                      error={fieldErrors.brgy}
                      containerClassName="sm:col-span-2"
                    />
                    <InputField
                      name="village"
                      placeholder="Subdivision/Village"
                      value={formValues.village}
                      onChange={handleFieldChange}
                      onBlur={() => handleFieldBlur("village")}
                      error={fieldErrors.village}
                    />
                    <InputField
                      name="unitInfo"
                      placeholder="Blk/Lot/Unit No. and Street"
                      value={formValues.unitInfo}
                      onChange={handleFieldChange}
                      onBlur={() => handleFieldBlur("unitInfo")}
                      error={fieldErrors.unitInfo}
                    />
                    <InputField
                      name="postal"
                      placeholder="Postal Code"
                      value={formValues.postal}
                      onChange={handleFieldChange}
                      inputMode="numeric"
                      error={fieldErrors.postal}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Store Pickup Map */}
            {shippingMethod === "Pick Up at Store" && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                <h3 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
                  <LuStore className="text-primary" /> Store Location
                </h3>
                <div className="relative h-64 w-full overflow-hidden rounded-xl group">
                  <iframe
                    title="Store map"
                    src={storeMapEmbedUrl}
                    loading="lazy"
                    className="h-full w-full transition-transform duration-500 group-hover:scale-[1.02]"
                  />
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
                  <a
                    href={storeMapExternalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="absolute bottom-3 right-3 bg-primary-light text-white text-xs px-3 py-1.5 rounded-full shadow-md hover:bg-primary transition"
                  >
                    Directions
                  </a>
                </div>
              </div>
            )}

            {submitMessage && (
              <p
                className={`text-sm text-center ${
                  Object.keys(fieldErrors).length ? "text-red-500" : "text-emerald-600"
                }`}
              >
                {submitMessage}
              </p>
            )}

            <button
              type="submit"
              disabled={isSubmitting || selectedCartItems.length === 0}
              className="w-full py-3 bg-gradient-to-r from-primary to-primary-light text-white rounded-xl font-semibold flex items-center justify-center gap-2 hover:shadow-lg transition-all duration-300 disabled:opacity-70"
            >
              {isSubmitting ? (
                <InlineLoader />
              ) : (
                `Place Order (₱${total.toLocaleString()})`
              )}
            </button>
          </form>
        </div>

        {/* Right column: Order Summary */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-5 sticky top-24">
            <h3 className="text-xl font-bold text-gray-800 mb-4">Order Summary</h3>
            {selectedCartItems.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No items selected.</p>
            ) : (
              <>
                <div className="space-y-3 max-h-80 overflow-y-auto pr-2">
                  {selectedCartItems.map((item) => {
                    const itemImageSrc = resolveProductImageSrc(item.image);
                    return (
                    <div key={item.id} className="flex gap-3 items-start border-b border-gray-100 pb-3">
                      <div className="w-16 h-16 bg-gray-100 rounded-lg overflow-hidden shrink-0">
                        {itemImageSrc ? (
                          <Image
                            src={itemImageSrc}
                            alt={item.name}
                            width={64}
                            height={64}
                            className="object-contain h-full w-full"
                            unoptimized
                            draggable={false}
                          />
                        ) : null}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-800 truncate">{item.name}</p>
                        {item.customData && (
                          <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
                            {item.customData.variant && (
                              <span className="rounded-full bg-primary-50 px-2 py-0.5 text-primary">
                                {String(item.customData.variant)}
                              </span>
                            )}
                            {item.customData.subscriptionTier && (
                              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-sky-700">
                                {String(item.customData.subscriptionTier).toUpperCase()}
                              </span>
                            )}
                          </div>
                        )}
                        <p className="text-sm text-gray-500 mt-1">Qty: {item.quantity}</p>
                      </div>
                      <div className="flex items-center gap-0.5 text-primary shrink-0">
                        <LuPhilippinePeso className="text-sm" />
                        <span className="font-semibold">{item.lineTotal.toLocaleString()}</span>
                      </div>
                    </div>
                    );
                  })}
                </div>
                <div className="mt-4 pt-4 border-t border-gray-100 space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Referral Code
                      {affiliateEligible ? (
                        <span className="ml-1 font-normal text-gray-400">
                          (optional, first order)
                        </span>
                      ) : (
                        <span className="ml-1 font-normal text-gray-400">
                          (not available for this order)
                        </span>
                      )}
                    </label>
                    <input
                      type="text"
                      value={referralCode}
                      onChange={(e) => {
                        const next = e.target.value.toUpperCase();
                        setReferralCode(next);
                        setReferralError(null);
                        setReferralValid(false);
                      }}
                      placeholder="Enter referral code"
                      disabled={!affiliateEligible && !referralCode}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all bg-white text-sm uppercase disabled:bg-gray-50 disabled:text-gray-400"
                    />
                    {referralValidating && (
                      <p className="text-xs text-gray-500 mt-1 flex items-center gap-1.5">
                        <InlineLoader /> Validating…
                      </p>
                    )}
                    {!referralValidating && referralValid && referralCode && (
                      <p className="text-xs text-green-600 mt-1">
                        Referral code applied
                      </p>
                    )}
                    {!referralValidating && referralError && (
                      <p className="text-xs text-red-500 mt-1">{referralError}</p>
                    )}
                    {!affiliateEligible && (
                      <p className="text-xs text-gray-400 mt-1">
                        Referral codes can only be applied on your first order.
                      </p>
                    )}
                  </div>
                  <div className="space-y-2 pt-1">
                    <div className="flex justify-between text-gray-600">
                      <span>Subtotal</span>
                      <span className="flex items-center gap-0.5">
                        <LuPhilippinePeso className="text-xs" /> {subtotal.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between text-gray-600">
                      <span>Delivery Fee</span>
                      <span className="text-gray-500">To be confirmed</span>
                    </div>
                  </div>
                  <div className="flex justify-between pt-3 text-lg font-bold text-gray-800 border-t">
                    <span>Total</span>
                    <span className="flex items-center gap-0.5 text-primary">
                      <LuPhilippinePeso className="text-sm" /> {total.toLocaleString()}
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}