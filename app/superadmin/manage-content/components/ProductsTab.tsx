"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  PortalBadge,
  PortalEmptyState,
  PortalModal,
  PortalPanel,
} from "../../components/ui";
import {
  fmtCurrency,
  manageContentRequest,
  safeNumber,
  safeString,
} from "./manage-content-shared";
import { toServableMediaSrc } from "@/app/lib/portfolioDisplay";
import {
  filterProductImageUrls,
  isPlaceholderProductImageUrl,
  MAX_PRODUCT_IMAGES,
  uniqueProductImageUrls,
} from "@/lib/product-image";
import { InlineLoader } from "@/app/components/Loader";

export interface Product {
  id: number;
  name: string;
  category: string;
  description: string;
  defaultPrice: number;
  customPrice?: number;
  image: string;
  images: string[];
  isActive: boolean;
}

const DEFAULT_CATEGORIES = [
  "business_card",
  "dog_tag",
  "id_card",
  "nfc_card",
  "merchandise",
  "subscription",
];

function collectProductImages(raw: Record<string, unknown>): string[] {
  if (Array.isArray(raw.images) && raw.images.length > 0) {
    return uniqueProductImageUrls(
      raw.images.map((item) => (typeof item === "string" ? toServableMediaSrc(item) || item : "")),
    );
  }
  const candidates = [
    raw.img_url,
    raw.imgUrl,
    raw.image_url,
    raw.image,
    raw.frontUrl,
    raw.front_url,
    raw.backUrl,
    raw.back_url,
    raw.variableFrontImg,
    raw.variable_front_img,
    raw.variableBackImg,
    raw.variable_back_img,
    raw.customImg,
    raw.custom_img,
    raw.customVariableImg,
    raw.custom_variable_img,
  ];
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const url = safeString(candidate);
    if (!url || seen.has(url) || isPlaceholderProductImageUrl(url)) continue;
    seen.add(url);
    urls.push(toServableMediaSrc(url) || url);
  }
  return filterProductImageUrls(urls);
}

function mapApiProductToUi(raw: Record<string, unknown>): Product | null {
  const id = safeNumber(raw.productID ?? raw.product_id ?? raw.productId ?? raw.id);
  if (!id) return null;
  const name = safeString(raw.name ?? raw.product_name ?? raw.title) || "Untitled Product";
  const category = safeString(raw.category) || "General";
  const description = safeString(raw.description ?? raw.details) || "—";
  const price = safeNumber(raw.price ?? raw.default_price ?? raw.defaultPrice) ?? 0;
  const customRaw = raw.custom_price ?? raw.customPrice ?? raw.override_price;
  const customPrice =
    customRaw === null || customRaw === undefined ? undefined : safeNumber(customRaw) ?? undefined;
  const images = collectProductImages(raw);
  const isActive = raw.isActive !== false && raw.is_active !== false;

  return {
    id,
    name,
    category,
    description,
    defaultPrice: price,
    customPrice,
    image: images[0] || "",
    images,
    isActive,
  };
}

function dataUrlToFile(dataUrl: string, filename: string): File | null {
  if (!dataUrl.startsWith("data:")) return null;
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], filename, { type: match[1] });
}

function extractUploadedImageUrl(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const record = data as Record<string, unknown>;
  const mainImage =
    record.mainImage && typeof record.mainImage === "object"
      ? (record.mainImage as Record<string, unknown>)
      : null;
  return safeString(
    mainImage?.url ||
      mainImage?.secure_url ||
      record.mainImageUrl ||
      record.imageUrl ||
      record.imgUrl ||
      record.url,
  );
}

function extractUploadedImageUrls(data: unknown): string[] {
  if (!data || typeof data !== "object") return [];
  const record = data as Record<string, unknown>;
  if (Array.isArray(record.images) && record.images.length > 0) {
    return uniqueProductImageUrls(record.images.map((item) => safeString(item)));
  }
  const single = extractUploadedImageUrl(data);
  return single ? [single] : [];
}

function ProductImageSlider({
  images,
  alt,
  className = "h-44",
}: {
  images: string[];
  alt: string;
  className?: string;
}) {
  const [index, setIndex] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const slides = filterProductImageUrls(images);
  const hasMultiple = slides.length > 1;
  const current = slides[Math.min(index, slides.length - 1)] ?? "";

  useEffect(() => {
    setIndex(0);
    setImageFailed(false);
  }, [images]);

  useEffect(() => {
    setImageFailed(false);
  }, [index]);

  const go = (direction: -1 | 1) => {
    setIndex((prev) => (prev + direction + slides.length) % slides.length);
  };

  return (
    <div className={`relative overflow-hidden bg-gray-100 ${className}`}>
      {current && !imageFailed ? (
        <img
          src={current}
          alt={alt}
          className="h-full w-full object-contain transition-opacity duration-300"
          onError={() => {
            setImageFailed(true);
          }}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center px-4 text-center text-xs font-medium text-gray-400">
          No product image available
        </div>
      )}
      {hasMultiple ? (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              go(-1);
            }}
            aria-label="Previous image"
            className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/45 p-1.5 text-white backdrop-blur-sm hover:bg-black/60"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              go(1);
            }}
            aria-label="Next image"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/45 p-1.5 text-white backdrop-blur-sm hover:bg-black/60"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1.5">
            {slides.map((_, i) => (
              <button
                key={`dot-${i}`}
                type="button"
                aria-label={`Show image ${i + 1}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setIndex(i);
                }}
                className={`h-1.5 rounded-full transition-all ${
                  i === index ? "w-4 bg-white" : "w-1.5 bg-white/55 hover:bg-white/80"
                }`}
              />
            ))}
          </div>
          <span className="absolute left-2 top-2 rounded-md bg-black/45 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
            {index + 1}/{slides.length}
          </span>
        </>
      ) : null}
    </div>
  );
}

type ProductForm = {
  name: string;
  defaultPrice: string;
  customPrice: string;
  description: string;
  category: string;
  imagePreviews: string[];
};

const EMPTY_FORM: ProductForm = {
  name: "",
  defaultPrice: "",
  customPrice: "",
  description: "",
  category: DEFAULT_CATEGORIES[0],
  imagePreviews: [],
};

type ProductsTabProps = {
  onNotice: (type: "success" | "error", message: string) => void;
};

function readFilesAsDataUrls(files: File[]): Promise<string[]> {
  return Promise.all(
    files.map(
      (file) =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? ""));
          reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
          reader.readAsDataURL(file);
        }),
    ),
  );
}

export default function ProductsTab({ onNotice }: ProductsTabProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<string[]>(DEFAULT_CATEGORIES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<{ mode: "add" | "edit"; product?: Product } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [form, setForm] = useState<ProductForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await manageContentRequest(
        "/api/superadmin/products?limit=100&include_inactive=true"
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(safeString(payload?.message) || "Failed to load products");
      }
      const raw =
        payload?.data?.products ??
        payload?.data?.items ??
        payload?.products ??
        [];
      const mapped = Array.isArray(raw)
        ? raw.map((item: Record<string, unknown>) => mapApiProductToUi(item)).filter(Boolean)
        : [];
      setProducts(mapped as Product[]);
      const apiCategories = payload?.data?.categories ?? payload?.categories;
      if (Array.isArray(apiCategories) && apiCategories.length) {
        setCategories(apiCategories.map((c: unknown) => safeString(c)).filter(Boolean));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load products");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  const openAdd = () => {
    setForm({ ...EMPTY_FORM, category: categories[0] ?? DEFAULT_CATEGORIES[0] });
    setModal({ mode: "add" });
  };

  const openEdit = (product: Product) => {
    setForm({
      name: product.name,
      defaultPrice: String(product.defaultPrice),
      customPrice: product.customPrice !== undefined ? String(product.customPrice) : "",
      description: product.description,
      category: product.category,
      imagePreviews: product.images.length
        ? product.images
        : product.image
          ? [product.image]
          : [],
    });
    setModal({ mode: "edit", product });
  };

  const removeImageAt = (index: number) => {
    setForm((f) => ({
      ...f,
      imagePreviews: f.imagePreviews.filter((_, i) => i !== index),
    }));
  };

  const handleImageFilesSelected = async (fileList: FileList | null) => {
    if (!fileList?.length) return;
    const remaining = MAX_PRODUCT_IMAGES - form.imagePreviews.length;
    if (remaining <= 0) {
      onNotice("error", `You can upload up to ${MAX_PRODUCT_IMAGES} images per product.`);
      return;
    }

    const selected = Array.from(fileList)
      .filter((file) => file.type.startsWith("image/"))
      .slice(0, remaining);

    if (!selected.length) {
      onNotice("error", "Please choose image files only.");
      return;
    }

    if (fileList.length > remaining) {
      onNotice(
        "error",
        `Only ${remaining} more image${remaining === 1 ? "" : "s"} can be added (max ${MAX_PRODUCT_IMAGES}).`,
      );
    }

    try {
      const dataUrls = (await readFilesAsDataUrls(selected)).filter(Boolean);
      setForm((f) => ({
        ...f,
        imagePreviews: uniqueProductImageUrls([...f.imagePreviews, ...dataUrls]).slice(
          0,
          MAX_PRODUCT_IMAGES,
        ),
      }));
    } catch {
      onNotice("error", "Failed to read one or more selected images.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const uploadImages = async (images: string[], productName: string): Promise<string[]> => {
    const existingUrls = images.filter((url) => url && !url.startsWith("data:"));
    const dataUrls = images.filter((url) => url.startsWith("data:"));
    if (dataUrls.length === 0) return uniqueProductImageUrls(existingUrls);

    const formData = new FormData();
    formData.append("productName", productName || "Product");

    let appended = 0;
    dataUrls.forEach((dataUrl, index) => {
      const file = dataUrlToFile(
        dataUrl,
        `${productName || "product"}-${Date.now()}-${index + 1}.png`,
      );
      if (!file) return;
      formData.append("images", file);
      appended += 1;
    });

    if (appended === 0) return uniqueProductImageUrls(existingUrls);

    const response = await manageContentRequest("/api/superadmin/products/upload-images", {
      method: "POST",
      body: formData,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(safeString(payload?.message) || "Failed to upload product images.");
    }

    const uploaded = extractUploadedImageUrls(payload?.data);
    return uniqueProductImageUrls([...existingUrls, ...uploaded]).slice(0, MAX_PRODUCT_IMAGES);
  };

  const handleSave = async () => {
    if (!modal || !form.name.trim() || !form.defaultPrice || saving) return;
    setSaving(true);
    try {
      const uploadedImages = await uploadImages(form.imagePreviews, form.name.trim());
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        price: parseFloat(form.defaultPrice) || 0,
        category: form.category,
        description: form.description.trim() || form.name.trim(),
        customPrice: form.customPrice ? parseFloat(form.customPrice) : null,
      };
      if (uploadedImages.length > 0) {
        payload.imgUrl = uploadedImages[0];
        payload.images = uploadedImages;
      } else if (modal.mode === "edit") {
        payload.imgUrl = "";
        payload.images = [];
      }

      const response =
        modal.mode === "add"
          ? await manageContentRequest("/api/superadmin/products", {
              method: "POST",
              body: JSON.stringify(payload),
            })
          : await manageContentRequest(`/api/superadmin/products/${modal.product!.id}`, {
              method: "PUT",
              body: JSON.stringify(payload),
            });
      if (!response.ok) {
        onNotice("error", "Failed to save product.");
        return;
      }
      onNotice(
        "success",
        modal.mode === "add" ? "Product added successfully." : "Product updated successfully."
      );
      setModal(null);
      await loadProducts();
    } catch (err) {
      onNotice(
        "error",
        err instanceof Error ? err.message : "Failed to save product.",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const response = await manageContentRequest(
        `/api/superadmin/products/${deleteTarget.id}`,
        { method: "DELETE" }
      );
      if (!response.ok) {
        onNotice("error", "Failed to delete product.");
        return;
      }
      onNotice("success", "Product removed from catalog.");
      setDeleteTarget(null);
      await loadProducts();
    } catch {
      onNotice("error", "Failed to delete product.");
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          Manage marketplace products. Deleted products are hidden from the portal and web app.
        </p>
        <button
          type="button"
          onClick={openAdd}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover"
        >
          <Plus className="h-4 w-4" />
          Add New Product
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading products…</p>
      ) : error ? (
        <p className="text-sm text-rose-600">{error}</p>
      ) : products.length === 0 ? (
        <PortalEmptyState
          title="No products yet"
          description="Add your first product to populate the marketplace catalog."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((product) => {
            const displayPrice =
              product.customPrice !== undefined ? product.customPrice : product.defaultPrice;
            return (
              <PortalPanel key={product.id} padding="sm" className="overflow-hidden !p-0">
                <div className="relative">
                  <ProductImageSlider images={product.images} alt={product.name} />
                  <div className="absolute right-2 top-2 z-10 flex gap-1">
                    {!product.isActive ? (
                      <PortalBadge variant="warning">Archived</PortalBadge>
                    ) : null}
                    <PortalBadge variant="neutral">{product.category}</PortalBadge>
                  </div>
                </div>
                <div className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-gray-900">{product.name}</h3>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(product)}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-primary"
                        aria-label="Edit product"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(product)}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-rose-50 hover:text-rose-600"
                        aria-label="Delete product"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <p className="line-clamp-2 text-xs text-gray-500">{product.description}</p>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-base font-bold text-gray-900">{fmtCurrency(displayPrice)}</p>
                    {product.images.length > 1 ? (
                      <p className="text-[11px] font-medium text-gray-400">
                        {product.images.length} images
                      </p>
                    ) : null}
                  </div>
                </div>
              </PortalPanel>
            );
          })}
        </div>
      )}

      <PortalModal
        open={Boolean(modal)}
        onClose={() => setModal(null)}
        title={modal?.mode === "add" ? "Add New Product" : "Edit Product"}
        description="Fill in product details for the marketplace catalog."
        size="lg"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setModal(null)}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!form.name.trim() || !form.defaultPrice || saving}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
            >
              {saving ? <InlineLoader /> : null}
              {modal?.mode === "add" ? "Add Product" : "Save Changes"}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label className="block text-sm font-semibold text-gray-700">
                Product Images
              </label>
              <span className="text-xs text-gray-400">
                {form.imagePreviews.length}/{MAX_PRODUCT_IMAGES}
              </span>
            </div>
            <p className="mb-2 text-xs text-gray-500">
              Select one or more images. The first image is used as the main product photo.
            </p>

            {form.imagePreviews.length > 0 ? (
              <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {form.imagePreviews.map((preview, index) => (
                  <div
                    key={`${preview.slice(0, 48)}-${index}`}
                    className="group relative overflow-hidden rounded-xl border border-gray-200 bg-gray-50"
                  >
                    <img
                      src={preview}
                      alt={`Product image ${index + 1}`}
                      className="h-28 w-full object-contain"
                    />
                    {index === 0 ? (
                      <span className="absolute left-2 top-2 rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        Main
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => removeImageAt(index)}
                      className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 bg-white/95 text-gray-600 opacity-100 shadow-sm transition hover:bg-rose-50 hover:text-rose-600 sm:opacity-0 sm:group-hover:opacity-100"
                      aria-label={`Remove image ${index + 1}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={form.imagePreviews.length >= MAX_PRODUCT_IMAGES}
              className="flex h-28 w-full items-center justify-center rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 text-sm text-gray-500 hover:border-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {form.imagePreviews.length >= MAX_PRODUCT_IMAGES
                ? `Maximum of ${MAX_PRODUCT_IMAGES} images reached`
                : form.imagePreviews.length > 0
                  ? "Click to add more images"
                  : "Click to upload images"}
            </button>

            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                void handleImageFilesSelected(e.target.files);
              }}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold text-gray-700">Product Name</label>
            <input
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold text-gray-700">Category</label>
            <select
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-semibold text-gray-700">Default Price</label>
              <input
                type="number"
                min="0"
                step="0.01"
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                value={form.defaultPrice}
                onChange={(e) => setForm((f) => ({ ...f, defaultPrice: e.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold text-gray-700">
                Custom Price (optional)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                value={form.customPrice}
                onChange={(e) => setForm((f) => ({ ...f, customPrice: e.target.value }))}
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold text-gray-700">Description</label>
            <textarea
              rows={3}
              className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>
        </div>
      </PortalModal>

      <PortalModal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Delete Product"
        description={`Remove "${deleteTarget?.name}" from the catalog? It will no longer appear in the portal or web app.`}
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeleteTarget(null)}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDelete}
              className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700"
            >
              Delete
            </button>
          </div>
        }
      >
        <p className="text-sm text-gray-600">
          This performs a soft delete. The product record is archived and hidden from end users.
        </p>
      </PortalModal>
    </div>
  );
}
