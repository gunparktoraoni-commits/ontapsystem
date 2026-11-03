"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";
import {
  LuPhilippinePeso,
  LuCircleAlert,
  LuShoppingCart,
  LuCreditCard,
  LuImage,
  LuChevronLeft,
  LuChevronRight,
} from "react-icons/lu";
import { motion } from "framer-motion";
import { getFrontendApiBaseUrl } from "../apiBase";
import {
  filterProductImageUrls,
  isPlaceholderProductImageUrl,
  resolveProductImageSrc,
} from "@/lib/product-image";
import { showToast } from "../Toast";
import { FastAverageColor } from "fast-average-color";
import { useCartOperations } from "@/hooks/useCartOperations";
import { InlineLoader } from "../Loader";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------
interface FullProduct {
  productID: number;
  name: string;
  price: number;
  description: string;
  imgUrl: string;
  frontUrl: string | null;
  backUrl: string | null;
  category: string;
  dateAdded: string;
  customPrice: number | null;
  variableFrontImg: string | null;
  variableBackImg: string | null;
  isActive: boolean;
  customImg: string | null;
  customVariableImg: string | null;
}

type SubscriptionTier = "basic" | "standard" | "premium";
type VariantOption = "light" | "dark";
type LogoType = "default" | "custom";

type ProductPriceQuote = {
  unitPrice: number;
  breakdown: {
    basePrice: number;
    subscriptionAddon: number;
    logoAddon: number;
    variantAddon: number;
    unitPrice: number;
  };
};

export interface DirectCheckoutItem {
  id: string;
  itemId: string | number;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  image?: string;
  customData?: Record<string, unknown>;
}

const planInclusions = {
  basic: [
    "Basic Info and Social Media Links",
    "Products and Services Display",
    "Real-Time Analytics",
    "5 Portfolio Themes",
    "30 Associate Connects",
  ],
  standard: [
    "All in Basic",
    "Gallery Showcase",
    "Company Management",
    "7 Portfolio Themes",
    "50 Associate Connects",
  ],
  premium: [
    "All in Standard",
    "Inquiry Management",
    "Free Custom Bizcard Logo Design",
    "10 Portfolio Themes",
    "Unlimited Associate Connects",
  ],
};

// ------------------------------------------------------------------
// Main Component
// ------------------------------------------------------------------
export default function ProductModal({
  product: initialProduct,
  onBack,
  onBuyNow,
}: {
  product: {
    id: string;
    name: string;
    category: string;
    price: number;
    imgUrl: string | null;
  };
  onBack: () => void;
  onBuyNow?: (item: DirectCheckoutItem) => void;
}) {
  // ---- Full product data (fetched from backend) ----
  const [fullProduct, setFullProduct] = useState<FullProduct | null>(null);
  const [loadingProduct, setLoadingProduct] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ---- UI state ----
  const [quantity, setQuantity] = useState(1);
  const [subscriptionTier, setSubscriptionTier] =
    useState<SubscriptionTier>("basic");
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionTier>("basic");
  const [varOption, setVarOption] = useState<VariantOption>("light");
  const [logoType, setLogoType] = useState<LogoType>("default");
  const [note, setNote] = useState("");

  // ---- Image gallery ----
  const [activeImageIndex, setActiveImageIndex] = useState(0);

  // ---- Custom logo states ----
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadedLogoUrl, setUploadedLogoUrl] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [logoFileName, setLogoFileName] = useState<string | null>(null);
  const [logoMimeType, setLogoMimeType] = useState<string | null>(null);
  const [logoNaturalWidth, setLogoNaturalWidth] = useState<number | null>(null);
  const [logoNaturalHeight, setLogoNaturalHeight] = useState<number | null>(
    null,
  );
  const [logoQualityNotices, setLogoQualityNotices] = useState<string[]>([]);
  const [isAnalyzingLogoQuality, setIsAnalyzingLogoQuality] = useState(false);
  const [logoUploadError, setLogoUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [logoScale, setLogoScale] = useState(1);
  const [logoOffsetX, setLogoOffsetX] = useState(0);
  const [logoOffsetY, setLogoOffsetY] = useState(0);
  const [logoDisplaySize, setLogoDisplaySize] = useState(120);

  // ---- Operation states ----
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const [priceQuote, setPriceQuote] = useState<ProductPriceQuote | null>(null);
  const [priceQuoteLoading, setPriceQuoteLoading] = useState(false);

  // ---- Inquiry States ----
  const [inquiryName, setInquiryName] = useState("");
  const [inquiryEmail, setInquiryEmail] = useState("");
  const [inquiryContact, setInquiryContact] = useState("");
  const [inquiryFormErrors, setInquiryFormErrors] = useState<{
    name?: string;
    email?: string;
    contact?: string;
  }>({});

  // ---- Hooks & constants ----
  const API = getFrontendApiBaseUrl();
  const { executeCartOperation } = useCartOperations();

  const isPolyvinylBusinessCard =
    fullProduct?.name === "Polyvinyl Business Card";
  const isAutoPremiumProduct =
    fullProduct?.name === "Bamboo Digital Business Card" ||
    fullProduct?.name === "Carbon Fiber Digital Business Card";

  const effectiveSubscriptionTier = isAutoPremiumProduct
    ? "premium"
    : subscriptionTier;

  const basePrice = priceQuote?.breakdown.basePrice ?? fullProduct?.price ?? 0;
  const subscriptionAddOn = priceQuote?.breakdown.subscriptionAddon ?? 0;
  const logoAddOn = priceQuote?.breakdown.logoAddon ?? 0;
  const unitPrice = priceQuote?.unitPrice ?? basePrice;
  const totalPrice = unitPrice * quantity;

  // Logo crop constants
  const LOGO_SIZE_MIN = 60;
  const LOGO_SIZE_MAX = 220;
  const LOGO_ZOOM_MIN = 1;
  const LOGO_ZOOM_MAX = 3;
  const supportedLogoExtensions = ".png,.jpg,.jpeg,.webp,.svg,.pdf";
  const canCropLogo =
    logoMimeType === "image/jpeg" || logoMimeType === "image/png";
  const canPreviewLogo = !!previewUrl;

  const logoAspectRatio =
    logoNaturalWidth && logoNaturalHeight
      ? logoNaturalWidth / logoNaturalHeight
      : 1;
  const logoRenderWidth =
    logoAspectRatio >= 1
      ? logoDisplaySize
      : Math.round(logoDisplaySize * logoAspectRatio);
  const logoRenderHeight =
    logoAspectRatio >= 1
      ? Math.round(logoDisplaySize / logoAspectRatio)
      : logoDisplaySize;

  // ---- Derived gallery images based on variant ----
  const lightVariantImages = filterProductImageUrls([
    fullProduct?.imgUrl,
    fullProduct?.frontUrl,
    fullProduct?.backUrl,
  ]);

  const darkVariantImages = filterProductImageUrls([
    fullProduct?.variableFrontImg,
    fullProduct?.variableBackImg,
  ]);

  const fallbackImages = filterProductImageUrls([
    fullProduct?.imgUrl,
    fullProduct?.frontUrl,
    fullProduct?.backUrl,
    fullProduct?.variableFrontImg,
    fullProduct?.variableBackImg,
  ]);

  const galleryImages =
    darkVariantImages.length > 0
      ? varOption === "dark"
        ? darkVariantImages
        : lightVariantImages
      : lightVariantImages.length > 0
        ? lightVariantImages
        : fallbackImages;

  const selectedImage =
    galleryImages[activeImageIndex] ||
    galleryImages[0] ||
    null;

  const displayImageSrcRaw =
    logoType === "custom" && canPreviewLogo
      ? varOption === "light"
        ? fullProduct?.customImg || selectedImage
        : fullProduct?.customVariableImg || selectedImage
      : selectedImage;

  const displayImageSrc = displayImageSrcRaw
    ? resolveProductImageSrc(displayImageSrcRaw, null)
    : null;

  // When variant changes, reset active image index
  useEffect(() => {
    setActiveImageIndex(0);
  }, [varOption, fullProduct?.productID]);

  // ------------------------------------------------------------------
  // Fetch full product details
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!initialProduct?.id) return;

    const fetchFullProduct = async () => {
      setLoadingProduct(true);
      setError(null);
      try {
        const res = await fetch(`${API}/api/products/${initialProduct.id}`);
        if (!res.ok) throw new Error("Failed to load product details");
        const json = await res.json();
        setFullProduct(json.data);
        // Reset options when product changes
        setQuantity(1);
        setSubscriptionTier("basic");
        setSelectedPlan("basic");
        setVarOption("light");
        setLogoType("default");
        setSelectedFile(null);
        setPreviewUrl(null);
        setUploadedLogoUrl(null);
        setLogoFileName(null);
        setLogoUploadError(null);
        setLogoQualityNotices([]);
        setLogoScale(1);
        setLogoOffsetX(0);
        setLogoOffsetY(0);
        setLogoDisplaySize(120);
        setNote("");
        setActiveImageIndex(0);
        setOperationError(null);
      } catch (err: any) {
        setError(err.message);
        showToast(err.message, "error");
      } finally {
        setLoadingProduct(false);
      }
    };

    fetchFullProduct();
  }, [initialProduct.id, API]);

  useEffect(() => {
    if (!fullProduct?.productID) return;

    const controller = new AbortController();

    const fetchPriceQuote = async () => {
      setPriceQuoteLoading(true);
      try {
        const params = new URLSearchParams({
          subscriptionTier: effectiveSubscriptionTier,
          logoType,
        });
        if (isPolyvinylBusinessCard) {
          params.set("variant", varOption);
        }

        const response = await fetch(
          `${API}/api/marketplace/products/${fullProduct.productID}/quote?${params.toString()}`,
          { cache: "no-store", signal: controller.signal },
        );
        const payload = (await response.json().catch(() => null)) as {
          success?: boolean;
          data?: ProductPriceQuote;
        } | null;

        if (!response.ok || !payload?.success || !payload.data) {
          throw new Error("Failed to load product pricing.");
        }

        setPriceQuote(payload.data);
      } catch (error) {
        if (controller.signal.aborted) return;
        setPriceQuote(null);
        console.error("[ProductModal] price quote failed", error);
      } finally {
        if (!controller.signal.aborted) {
          setPriceQuoteLoading(false);
        }
      }
    };

    void fetchPriceQuote();

    return () => controller.abort();
  }, [
    API,
    fullProduct?.productID,
    effectiveSubscriptionTier,
    logoType,
    varOption,
    isPolyvinylBusinessCard,
  ]);

  // ------------------------------------------------------------------
  // Helper: CSRF token
  // ------------------------------------------------------------------
  const CSRF_COOKIE_NAME = "csrf-token";
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

  // ------------------------------------------------------------------
  // Logo upload & quality analysis
  // ------------------------------------------------------------------
  const uploadLogo = async (file: File) => {
    setIsUploading(true);
    try {
      const maxSize = 5 * 1024 * 1024;
      const allowed = [
        "image/png",
        "image/jpeg",
        "image/webp",
        "image/svg+xml",
        "application/pdf",
      ];
      if (!allowed.includes(file.type)) throw new Error("Invalid file type");
      if (file.size > maxSize) throw new Error("File too large (max 5MB)");
      const form = new FormData();
      form.append("file", file);
      const csrf = await ensureCsrfToken();
      const headers: Record<string, string> = {};
      if (csrf) {
        headers["x-csrf-token"] = csrf;
        headers["X-CSRF-Token"] = csrf;
      }
      const resp = await fetch(`${API}/api/upload/logo`, {
        method: "POST",
        credentials: "include",
        body: form,
        headers,
      });
      const json = await resp.json().catch(() => null);
      if (!resp.ok || !json?.success || !json?.url) {
        throw new Error(json?.error || "Logo upload failed");
      }
      setUploadedLogoUrl(json.url as string);
      showToast("Logo uploaded successfully", "success");
      return json.url as string;
    } catch (err: any) {
      showToast(err?.message || "Failed to upload logo", "error");
      throw err;
    } finally {
      setIsUploading(false);
    }
  };

  const analyzeLogoImageQuality = async (file: File, imageUrl: string) => {
    if (!file.type.startsWith("image/")) return [];
    const qualityNotices: string[] = [];
    const fac = new FastAverageColor();
    try {
      const avgColor = await fac.getColorAsync(imageUrl);
      const bitmap = await createImageBitmap(file);
      const maxDimension = 256;
      const scale = Math.min(
        1,
        maxDimension / Math.max(bitmap.width, bitmap.height),
      );
      const sampleWidth = Math.max(32, Math.round(bitmap.width * scale));
      const sampleHeight = Math.max(32, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = sampleWidth;
      canvas.height = sampleHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        bitmap.close();
        return qualityNotices;
      }
      ctx.drawImage(bitmap, 0, 0, sampleWidth, sampleHeight);
      const { data } = ctx.getImageData(0, 0, sampleWidth, sampleHeight);
      let hasTransparency = false;
      const grayscale = new Float32Array(sampleWidth * sampleHeight);
      let grayIndex = 0;
      for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3];
        if (alpha < 250) hasTransparency = true;
        grayscale[grayIndex] =
          0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        grayIndex++;
      }
      let laplacianSum = 0,
        laplacianSqSum = 0,
        laplacianCount = 0,
        edgeBoundary = 0,
        edgeInterior = 0;
      for (let y = 1; y < sampleHeight - 1; y++) {
        for (let x = 1; x < sampleWidth - 1; x++) {
          const idx = y * sampleWidth + x;
          const center = grayscale[idx];
          const laplacian =
            grayscale[idx - sampleWidth] +
            grayscale[idx + sampleWidth] +
            grayscale[idx - 1] +
            grayscale[idx + 1] -
            4 * center;
          laplacianSum += laplacian;
          laplacianSqSum += laplacian * laplacian;
          laplacianCount++;
          const edgeDiff =
            Math.abs(center - grayscale[idx - 1]) +
            Math.abs(center - grayscale[idx - sampleWidth]);
          if (x % 8 === 0 || y % 8 === 0) edgeBoundary += edgeDiff;
          else edgeInterior += edgeDiff;
        }
      }
      const laplacianMean =
        laplacianCount > 0 ? laplacianSum / laplacianCount : 0;
      const laplacianVariance =
        laplacianCount > 0
          ? laplacianSqSum / laplacianCount - laplacianMean * laplacianMean
          : 0;
      const minDimension = Math.min(bitmap.width, bitmap.height);
      const blockinessRatio = edgeBoundary / Math.max(1, edgeInterior);
      const isBlurred = laplacianVariance < 90;
      const isPixelated =
        minDimension < 220 || (minDimension < 420 && blockinessRatio > 1.2);
      const avgAlpha = Array.isArray(avgColor.value) ? avgColor.value[3] : 255;
      const isOpaqueAverage = typeof avgAlpha === "number" && avgAlpha >= 254;
      if (!hasTransparency && isOpaqueAverage)
        qualityNotices.push(
          "This logo appears to have no transparent background. Better results usually come from transparent PNG logos.",
        );
      if (isBlurred)
        qualityNotices.push(
          "This image appears a bit blurry. For sharper print results, use a higher-definition logo.",
        );
      if (isPixelated)
        qualityNotices.push(
          "This image may look pixelated at card size. A larger HD source file is recommended.",
        );
      bitmap.close();
      return qualityNotices;
    } catch {
      return [
        "Automatic quality checks are unavailable for this upload. A transparent HD logo is still recommended.",
      ];
    } finally {
      fac.destroy();
    }
  };

  const handleLogoFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setLogoUploadError("Logo must be 5 MB or smaller.");
      return;
    }
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/svg+xml",
      "application/pdf",
    ];
    if (!allowedTypes.includes(file.type)) {
      setLogoUploadError(
        "Unsupported file type. Use JPG, PNG, WEBP, SVG, or PDF.",
      );
      return;
    }
    if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    setLogoUploadError(null);
    setLogoQualityNotices([]);
    setIsAnalyzingLogoQuality(false);
    setLogoFileName(file.name);
    setLogoMimeType(file.type || null);
    setSelectedFile(file);
    setUploadedLogoUrl(null);
    setLogoScale(1);
    setLogoOffsetX(0);
    setLogoOffsetY(0);
    setLogoNaturalWidth(null);
    setLogoNaturalHeight(null);
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    if (file.type === "image/jpeg" || file.type === "image/png") {
      await new Promise<void>((resolve) => {
        const previewImage = document.createElement("img");
        previewImage.onload = () => {
          setLogoNaturalWidth(previewImage.naturalWidth);
          setLogoNaturalHeight(previewImage.naturalHeight);
          resolve();
        };
        previewImage.onerror = () => {
          setLogoNaturalWidth(null);
          setLogoNaturalHeight(null);
          resolve();
        };
        previewImage.src = objectUrl;
      });
    } else {
      setLogoUploadError(
        "File uploaded, but preview/crop is only available for JPG, JPEG, and PNG files.",
      );
    }
    if (file.type.startsWith("image/")) {
      setIsAnalyzingLogoQuality(true);
      const notices = await analyzeLogoImageQuality(file, objectUrl);
      setLogoQualityNotices(notices);
      setIsAnalyzingLogoQuality(false);
    }
  };

  const resetLogoAdjustments = () => {
    setLogoScale(1);
    setLogoOffsetX(0);
    setLogoOffsetY(0);
    setLogoDisplaySize(120);
  };

  const isLogoAdjustmentsDefault =
    logoScale === 1 &&
    logoOffsetX === 0 &&
    logoOffsetY === 0 &&
    logoDisplaySize === 120;

  // Cleanup blob URL
  useEffect(() => {
    return () => {
      if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // ------------------------------------------------------------------
  // Add to cart / Buy now
  // ------------------------------------------------------------------
  const handleAdd = async (shouldBuyNow = false) => {
    if (!fullProduct) return;
    setIsSubmitting(true);
    setOperationError(null);
    setCanRetry(false);
    try {
      let logoUrl: string | null = null;
      if (logoType === "custom" && selectedFile) {
        logoUrl = await uploadLogo(selectedFile);
      }
      const sanitizedNote = (note || "")
        .replace(/\0/g, "")
        .trim()
        .slice(0, 1000);
      const finalSubscriptionTier = isAutoPremiumProduct
        ? "premium"
        : subscriptionTier;

      // Build the payload (used for both cart and direct checkout)
      const payload = {
        itemType: "merchandise",
        itemId: fullProduct.productID,
        quantity,
        variant: isPolyvinylBusinessCard ? varOption : undefined,
        subscriptionTier: finalSubscriptionTier,
        logoType,
        logoUrl,
        note: sanitizedNote || null,
        customData: {
          ...(isPolyvinylBusinessCard ? { variant: varOption } : {}),
          subscriptionTier: finalSubscriptionTier,
          selectedPlan,
          logoType,
          logoUrl,
          ...(sanitizedNote ? { note: sanitizedNote } : {}),
          // Additional customisation data for cropping, etc.
          logoScale,
          logoOffsetX,
          logoOffsetY,
          logoDisplaySize,
        },
      };

      // --- BUY NOW: bypass cart, directly go to checkout ---
      if (shouldBuyNow) {
        if (unitPrice <= 0) {
          // Price zero → send inquiry instead of checkout
          await submitProductInquiry();
          return;
        }
        if (!priceQuote) {
          throw new Error(
            "Product pricing is still loading. Please try again.",
          );
        }
        if (!onBuyNow)
          throw new Error("Buy Now is not supported in this context");
        const directItem: DirectCheckoutItem = {
          id: `direct_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          itemId: fullProduct.productID,
          name: fullProduct.name,
          quantity,
          unitPrice,
          lineTotal: totalPrice,
          image:
            resolveProductImageSrc(
              fullProduct.imgUrl ||
                fullProduct.frontUrl ||
                fullProduct.variableFrontImg,
              null,
            ) ?? undefined,
          customData: payload.customData,
        };
        onBuyNow(directItem);
        return;
      }

      // --- ADD TO CART: use existing cart operation ---
      const result = await executeCartOperation(payload, false);
      if (!result.success) {
        setOperationError(result.error?.message || "Failed to add to cart");
        setCanRetry(result.retrying || false);
        showToast(result.error?.message || "Failed to add to cart", "error");
        return;
      }
      showToast({
        message: "Item added to cart successfully!",
        type: "success",
        showProgress: true,
      });
    } catch (err: any) {
      const errorMsg = err?.message || "An unexpected error occurred";
      setOperationError(errorMsg);
      setCanRetry(true);
      showToast(errorMsg, "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    setInquiryName("");
    setInquiryEmail("");
    setInquiryContact("");
    setInquiryFormErrors({});
  }, [fullProduct?.productID]);

  const validateInquiryForm = (): boolean => {
    const errors: typeof inquiryFormErrors = {};
    if (!inquiryName.trim()) errors.name = "Name is required";
    else if (inquiryName.trim().length < 2)
      errors.name = "Name must be at least 2 characters";
    if (!inquiryEmail.trim()) errors.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inquiryEmail))
      errors.email = "Invalid email address";
    if (!inquiryContact.trim()) errors.contact = "Contact number is required";
    else if (!/^09\d{9}$/.test(inquiryContact.replace(/\D/g, "")))
      errors.contact = "Must be a valid Philippine mobile number (09xxxxxxxxx)";
    setInquiryFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const submitProductInquiry = async () => {
    if (!validateInquiryForm()) return;
    setIsSubmitting(true);
    setOperationError(null);
    try {
      const items = [
        {
          productId: fullProduct!.productID,
          productName: fullProduct!.name,
          quantity,
          unitPrice: basePrice,
          variant: isPolyvinylBusinessCard ? varOption : null,
          subscriptionTier: effectiveSubscriptionTier,
          logoType: logoType,
        },
      ];

      const csrfToken = await ensureCsrfToken();
      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (csrfToken) headers["X-CSRF-Token"] = csrfToken;

      const response = await fetch(`${API}/api/inquiries/product-inquiry`, {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({
          name: inquiryName.trim(),
          email: inquiryEmail.trim().toLowerCase(),
          contact: inquiryContact.replace(/\D/g, ""),
          note: note || null,
          title: `Inquiry about ${fullProduct!.name}`,
          source: "marketplace",
          items,
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Inquiry submission failed");
      showToast(
        "Inquiry sent successfully! Our team will contact you soon.",
        "success",
      );
      // Optionally close modal or reset
      if (onBack) onBack();
    } catch (err: any) {
      setOperationError(err.message || "Failed to submit inquiry");
      showToast(err.message || "Failed to submit inquiry", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  // ------------------------------------------------------------------
  // Loading & error states
  // ------------------------------------------------------------------
  if (loadingProduct) {
    return (
      <div className="flex justify-center items-center py-20">
        <InlineLoader />
      </div>
    );
  }
  if (error || !fullProduct) {
    return (
      <div className="text-center py-10">
        <p className="text-red-500">{error || "Product not found"}</p>
        <button onClick={onBack} className="mt-4 text-primary underline">
          Go back
        </button>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  const interactiveButtonClass =
    "transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-light focus-visible:ring-offset-2 active:translate-y-0 motion-reduce:transform-none motion-reduce:transition-none";

  const rangeInputClass =
    "mt-1 w-full h-2 appearance-none rounded-full border border-primary/25 bg-primary-light/10 cursor-pointer transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-light focus-visible:ring-offset-2 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-primary [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:duration-300 hover:[&::-webkit-slider-thumb]:scale-110 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-primary [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow-md";

  const optionButtonClass = (isActive: boolean) =>
    `${interactiveButtonClass} rounded-md px-4 py-2 ${
      isActive
        ? "bg-primary text-white shadow-md"
        : "border border-primary text-primary hover:bg-primary/5"
    }`;

  return (
    <div className="w-full">
      {/* Main 2‑column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
        {/* Left column: product image gallery & options */}
        <div className="col-span-3 space-y-6">
          {/* Image gallery with slider */}
          <div className="relative w-full rounded-lg overflow-hidden border border-gray-200 bg-gray-100 flex items-center justify-center aspect-video">
            {galleryImages.length > 1 && (
              <>
                <button
                  onClick={() =>
                    setActiveImageIndex((prev) =>
                      prev === 0 ? galleryImages.length - 1 : prev - 1,
                    )
                  }
                  className="absolute left-3 top-1/2 -translate-y-1/2 bg-black/50 text-white p-2 rounded-full hover:bg-black/70 transition z-10"
                >
                  <LuChevronLeft size={20} />
                </button>
                <button
                  onClick={() =>
                    setActiveImageIndex((prev) =>
                      prev === galleryImages.length - 1 ? 0 : prev + 1,
                    )
                  }
                  className="absolute right-3 top-1/2 -translate-y-1/2 bg-black/50 text-white p-2 rounded-full hover:bg-black/70 transition z-10"
                >
                  <LuChevronRight size={20} />
                </button>
              </>
            )}
            <div className="relative w-full h-full flex items-center justify-center">
              {displayImageSrc && !isPlaceholderProductImageUrl(displayImageSrc) ? (
                <Image
                  src={displayImageSrc}
                  alt={fullProduct.name}
                  width={500}
                  height={300}
                  className={`${fullProduct.category === "other products" ? "object-contain" : "object-cover"} max-h-[300px] w-auto rounded-lg`}
                  unoptimized
                  draggable={false}
                />
              ) : null}
              {/* Custom logo overlay (only when custom logo is selected and preview available) */}
              {logoType === "custom" && canPreviewLogo && canCropLogo && (
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
                  <div
                    className="relative overflow-hidden rounded-sm"
                    style={{
                      width: `${logoRenderWidth}px`,
                      height: `${logoRenderHeight}px`,
                    }}
                  >
                    <img
                      src={previewUrl}
                      alt="Custom logo preview"
                      className="absolute left-1/2 top-1/2"
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "contain",
                        transform: `translate(calc(-50% + ${logoOffsetX}px), calc(-50% + ${logoOffsetY}px)) scale(${logoScale})`,
                        transformOrigin: "center",
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
            {galleryImages.length > 1 && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-2">
                {galleryImages.map((_, idx) => (
                  <button
                    key={idx}
                    onClick={() => setActiveImageIndex(idx)}
                    className={`h-2 rounded-full transition-all ${
                      idx === activeImageIndex
                        ? "w-6 bg-primary"
                        : "w-2 bg-white/70 hover:bg-white"
                    }`}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="max-w-lg">
            <p className="text-sm text-gray-500 mt-1">
              {fullProduct.description}
            </p>
          </div>

          <div className="space-y-4">
            {/* Variant selection (Polyvinyl only) */}
            {isPolyvinylBusinessCard && (
              <div>
                <label className="block text-xs font-semibold text-primary uppercase">
                  Variant
                </label>
                <div className="mt-2 flex gap-2 text-sm font-medium">
                  <button
                    onClick={() => setVarOption("light")}
                    className={optionButtonClass(varOption === "light")}
                  >
                    Light
                  </button>
                  <button
                    onClick={() => setVarOption("dark")}
                    className={optionButtonClass(varOption === "dark")}
                  >
                    Dark
                  </button>
                </div>
              </div>
            )}

            {fullProduct.category.toLowerCase() === "business cards" && (
              <>
                {/* Subscription selection */}
                <div>
                  <label className="block text-xs font-semibold text-primary uppercase">
                    Subscription
                  </label>
                  {isAutoPremiumProduct ? (
                    <p className="text-sm text-gray-600 mt-1">
                      Automatically set to{" "}
                      <span className="font-semibold">Premium</span> for this
                      product.
                    </p>
                  ) : (
                    <div className="mt-2 flex gap-2 text-sm font-medium">
                      <button
                        onClick={() => {
                          setSubscriptionTier("basic");
                          setSelectedPlan("basic");
                        }}
                        className={optionButtonClass(
                          subscriptionTier === "basic",
                        )}
                      >
                        Basic
                      </button>
                      <button
                        onClick={() => {
                          setSubscriptionTier("standard");
                          setSelectedPlan("standard");
                        }}
                        className={optionButtonClass(
                          subscriptionTier === "standard",
                        )}
                      >
                        Standard
                      </button>
                      <button
                        onClick={() => {
                          setSubscriptionTier("premium");
                          setSelectedPlan("premium");
                        }}
                        className={optionButtonClass(
                          subscriptionTier === "premium",
                        )}
                      >
                        Premium
                      </button>
                    </div>
                  )}
                  <div className="mt-3 space-y-1">
                    {planInclusions[selectedPlan].map((item, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2 text-xs text-gray-600"
                      >
                        <span className="text-primary">•</span> {item}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Logo type selection */}
                <div>
                  <label className="block text-xs font-semibold text-primary uppercase">
                    Logo Type
                  </label>
                  <div className="mt-2 flex gap-2 text-sm font-medium">
                    <button
                      onClick={() => {
                        setLogoType("default");
                        setSelectedFile(null);
                        setPreviewUrl(null);
                        setUploadedLogoUrl(null);
                        resetLogoAdjustments();
                      }}
                      className={optionButtonClass(logoType === "default")}
                    >
                      Default
                    </button>
                    <button
                      onClick={() => setLogoType("custom")}
                      className={optionButtonClass(logoType === "custom")}
                    >
                      Custom
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* Custom logo upload & cropping UI */}
            {logoType === "custom" && (
              <div className="mt-3 rounded-xl border border-primary/20 bg-primary-light/5 p-3 flex flex-col gap-3">
                <label
                  htmlFor="custom-logo-upload"
                  className={`${interactiveButtonClass} flex items-center justify-center gap-2 rounded-lg border border-dashed border-primary/40 bg-white px-3 py-4 text-sm text-subheader-color`}
                >
                  <LuImage className="text-lg text-primary" />
                  Upload Logo
                </label>
                <input
                  id="custom-logo-upload"
                  type="file"
                  accept={supportedLogoExtensions}
                  onChange={handleLogoFileChange}
                  className="hidden"
                />
                <p className="text-xs text-subheader-color/80">
                  Supported: PNG, JPG, JPEG, WEBP, SVG, PDF (max 5MB)
                </p>

                {uploadedLogoUrl && (
                  <div className="flex items-center gap-2 rounded-lg border border-emerald-400/30 bg-emerald-50 px-3 py-2">
                    <div className="h-8 w-8 overflow-hidden rounded-md border border-emerald-200 bg-white shrink-0">
                      <Image
                        src={uploadedLogoUrl}
                        alt="Uploaded logo"
                        width={32}
                        height={32}
                        className="h-full w-full object-contain"
                        unoptimized
                draggable={false} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-emerald-700">
                        Logo uploaded
                      </p>
                      <p className="truncate text-[10px] text-emerald-600">
                        Will be reused for cart and checkout
                      </p>
                    </div>
                  </div>
                )}

                {logoFileName && !uploadedLogoUrl && (
                  <p className="text-xs text-primary font-medium truncate">
                    {logoFileName}
                  </p>
                )}

                {logoNaturalWidth && logoNaturalHeight && (
                  <p className="text-[10px] text-subheader-color/80">
                    Detected logo size: {logoNaturalWidth} × {logoNaturalHeight}{" "}
                    pixels
                  </p>
                )}

                {logoUploadError && (
                  <p className="text-xs text-red-500">{logoUploadError}</p>
                )}
                {isAnalyzingLogoQuality && (
                  <p className="text-xs text-subheader-color/80">
                    Checking logo quality...
                  </p>
                )}
                {isAnalyzingLogoQuality && (
                  <div className="flex items-center gap-2 text-xs text-subheader-color/80">
                    <InlineLoader /> Analyzing logo quality...
                  </div>
                )}
                {logoQualityNotices.length > 0 && !isAnalyzingLogoQuality && (
                  <div className="rounded-lg border border-amber-400/40 bg-amber-50 px-3 py-2">
                    {logoQualityNotices.map((notice, idx) => (
                      <p key={idx} className="text-xs text-amber-800">
                        {notice}
                      </p>
                    ))}
                  </div>
                )}

                {canPreviewLogo && canCropLogo && (
                  <div className="rounded-lg border border-primary/20 bg-white p-3 flex flex-col gap-3">
                    <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-subheader-color">
                      <span>Crop & Resize</span>
                      <button
                        onClick={resetLogoAdjustments}
                        className={`${interactiveButtonClass} rounded-md border border-primary/25 px-2.5 py-1 text-[10px] font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-60`}
                        disabled={isLogoAdjustmentsDefault}
                      >
                        {isLogoAdjustmentsDefault
                          ? "Default"
                          : "Revert to Default"}
                      </button>
                    </div>
                    <div className="mx-auto h-28 w-28 overflow-hidden rounded-lg border border-primary/20 bg-gray-100 relative">
                      <img
                        src={previewUrl}
                        alt="Logo crop preview"
                        className="absolute left-1/2 top-1/2"
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "contain",
                          transform: `translate(calc(-50% + ${logoOffsetX}px), calc(-50% + ${logoOffsetY}px)) scale(${logoScale})`,
                          transformOrigin: "center",
                        }}
                      />
                    </div>
                    <label className="text-xs text-subheader-color">
                      Zoom
                      <input
                        type="range"
                        min={LOGO_ZOOM_MIN}
                        max={LOGO_ZOOM_MAX}
                        step={0.01}
                        value={logoScale}
                        onChange={(e) => setLogoScale(Number(e.target.value))}
                        className={rangeInputClass}
                      />
                    </label>
                    <label className="text-xs text-subheader-color">
                      Horizontal Crop
                      <input
                        type="range"
                        min={-200}
                        max={200}
                        step={1}
                        value={logoOffsetX}
                        onChange={(e) => setLogoOffsetX(Number(e.target.value))}
                        className={rangeInputClass}
                      />
                    </label>
                    <label className="text-xs text-subheader-color">
                      Vertical Crop
                      <input
                        type="range"
                        min={-200}
                        max={200}
                        step={1}
                        value={logoOffsetY}
                        onChange={(e) => setLogoOffsetY(Number(e.target.value))}
                        className={rangeInputClass}
                      />
                    </label>
                    <label className="text-xs text-subheader-color">
                      On-card logo size
                      <input
                        type="range"
                        min={LOGO_SIZE_MIN}
                        max={LOGO_SIZE_MAX}
                        step={1}
                        value={logoDisplaySize}
                        onChange={(e) =>
                          setLogoDisplaySize(Number(e.target.value))
                        }
                        className={rangeInputClass}
                      />
                    </label>
                  </div>
                )}

                {canPreviewLogo && !canCropLogo && (
                  <label className="text-xs text-subheader-color">
                    On-card logo size
                    <input
                      type="range"
                      min={LOGO_SIZE_MIN}
                      max={LOGO_SIZE_MAX}
                      step={1}
                      value={logoDisplaySize}
                      onChange={(e) =>
                        setLogoDisplaySize(Number(e.target.value))
                      }
                      className={rangeInputClass}
                    />
                  </label>
                )}
              </div>
            )}

            {/* Quantity */}
            <div>
              <label className="block text-xs font-semibold text-primary uppercase">
                Quantity
              </label>
              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  className="px-2.5 aspect-square rounded-lg border text-xl"
                >
                  -
                </button>
                <input
                  type="number"
                  value={quantity}
                  onChange={(e) =>
                    setQuantity(Math.max(1, Number(e.target.value || 1)))
                  }
                  className="w-16 text-center rounded-lg border px-2 py-1"
                />
                <button
                  onClick={() => setQuantity((q) => q + 1)}
                  className="px-2.5 aspect-square rounded-lg border text-xl"
                >
                  +
                </button>
              </div>
            </div>

            {/* Note */}
            <div className="w-full">
              <label className="block text-xs font-semibold text-primary uppercase">
                Note (optional)
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="If you have specific instructions or requests for your order, please write them here"
                className="w-full mt-2 rounded-lg border px-2 py-2 text-sm h-24 resize-none"
              />
            </div>

            {basePrice === 0 && (
              <div className="space-y-4 border-t pt-4 mt-2">
                <h3 className="text-sm font-semibold text-primary uppercase">
                  Contact Information
                </h3>
                <div>
                  <label className="block text-xs font-medium text-gray-700">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    value={inquiryName}
                    onChange={(e) => setInquiryName(e.target.value)}
                    className="w-full mt-1 rounded-lg border px-3 py-2 text-sm"
                    placeholder="Juan Dela Cruz"
                  />
                  {inquiryFormErrors.name && (
                    <p className="text-xs text-red-500 mt-1">
                      {inquiryFormErrors.name}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700">
                    Email Address *
                  </label>
                  <input
                    type="email"
                    value={inquiryEmail}
                    onChange={(e) => setInquiryEmail(e.target.value)}
                    className="w-full mt-1 rounded-lg border px-3 py-2 text-sm"
                    placeholder="juan@example.com"
                  />
                  {inquiryFormErrors.email && (
                    <p className="text-xs text-red-500 mt-1">
                      {inquiryFormErrors.email}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700">
                    Contact Number *
                  </label>
                  <input
                    type="tel"
                    value={inquiryContact}
                    onChange={(e) => setInquiryContact(e.target.value)}
                    className="w-full mt-1 rounded-lg border px-3 py-2 text-sm"
                    placeholder="09123456789"
                  />
                  {inquiryFormErrors.contact && (
                    <p className="text-xs text-red-500 mt-1">
                      {inquiryFormErrors.contact}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Error display */}
            {operationError && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="rounded-lg border border-red-200 bg-red-50 p-4"
              >
                <div className="flex items-start gap-3">
                  <LuCircleAlert className="text-red-500 mt-0.5 flex-shrink-0 text-lg" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-red-900">
                      {operationError}
                    </p>
                    <div className="flex gap-2 mt-3">
                      {canRetry && (
                        <button
                          onClick={() => handleAdd(false)}
                          disabled={isSubmitting || isUploading}
                          className="text-xs font-semibold px-3 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors disabled:opacity-50"
                        >
                          Try Again
                        </button>
                      )}
                      <button
                        onClick={() => setOperationError(null)}
                        className="text-xs font-semibold px-3 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </div>
        </div>

        {/* Right column: order summary */}
        <div className="col-span-2 bg-primary-light rounded-2xl shadow-xl p-6 flex flex-col h-fit sticky top-4">
          <h2 className="font-bold text-white text-lg mb-4">Order Summary</h2>
          <div className="space-y-3 text-white">
            {priceQuoteLoading && !priceQuote ? (
              <div className="flex items-center gap-2 text-sm text-white/80">
                <InlineLoader />
                Loading current price...
              </div>
            ) : null}
            <div className="flex justify-between">
              <span className="text-sm">Base price</span>
              <span className="text-lg font-bold flex items-center gap-1">
                <LuPhilippinePeso />
                {basePrice.toLocaleString()}
              </span>
            </div>
            {fullProduct.category.toLowerCase() === "business cards" && (
              <>
                <div className="flex justify-between">
                  <span className="text-sm ">Subscription</span>
                  <span className="text-lg font-bold flex items-center gap-1">
                    {subscriptionAddOn <= 0 ? (
                      "Included"
                    ) : (
                      <>
                        <LuPhilippinePeso />
                        {subscriptionAddOn.toLocaleString()}
                      </>
                    )}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm">Logo</span>
                  <span className="text-lg font-bold flex items-center gap-1">
                    {logoAddOn <= 0 ? (
                      "Included"
                    ) : (
                      <>
                        <LuPhilippinePeso />
                        {logoAddOn.toLocaleString()}
                      </>
                    )}
                  </span>
                </div>
              </>
            )}
            <div className="flex justify-between">
              <span className="text-sm">Quantity</span>
              <span className="text-lg font-bold">{quantity}</span>
            </div>
            <div className="border-t border-white/20 pt-3 flex justify-between">
              <span className="text-sm font-semibold">Total</span>
              <span className="text-xl font-extrabold flex items-center gap-1">
                <LuPhilippinePeso />
                {totalPrice.toLocaleString()}
              </span>
            </div>
          </div>
          <div className="flex gap-2 mt-6">
            <button
              onClick={() => void handleAdd(false)}
              disabled={
                isSubmitting || isUploading || priceQuoteLoading || !priceQuote
              }
              className="flex-1 rounded-xl bg-white border text-nowrap py-3 text-sm font-semibold flex items-center justify-center gap-2 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isUploading || isSubmitting ? (
                <>
                  <InlineLoader />
                  <span>{isUploading ? "Uploading..." : "Adding..."}</span>
                </>
              ) : (
                <>
                  <LuShoppingCart className="text-lg" />
                  <span>Add to Cart</span>
                </>
              )}
            </button>
            <button
              onClick={() => void handleAdd(true)}
              disabled={
                isSubmitting || isUploading || priceQuoteLoading || !priceQuote
              }
              className="flex-1 rounded-xl bg-primary-light text-white text-nowrap py-3 text-sm font-semibold flex items-center justify-center gap-2 hover:bg-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isUploading || isSubmitting ? (
                <>
                  <InlineLoader />
                  <span>{isUploading ? "Uploading..." : "Processing..."}</span>
                </>
              ) : (
                <>
                  <LuCreditCard className="text-lg" />
                  <span>{basePrice !== 0 ? "Buy Now" : "Send Inquiry"}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
