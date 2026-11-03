import { Prisma } from "@prisma/client";
import { prisma } from "@/server/lib/prisma";
import { validateUploadedFile, validateMediaUrl } from "@/server/lib/media";
import { CloudinaryService } from "@/lib/services/cloudinary.service";
import {
  createProductPromoError,
  ProductPromoErrorCode,
} from "@/lib/errors/product-promo-errors";
import { resolveMerchandiseBasePrice } from "@/lib/pricing/product-pricing.service";
import {
  isPlaceholderProductImageUrl,
  MAX_PRODUCT_IMAGES,
  uniqueProductImageUrls,
} from "@/lib/product-image";
import { sortMerchandiseByCatalogOrder } from "@/lib/merchandise-catalog-order";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const ALLOWED_SORT_FIELDS = new Set(["name", "price", "dateAdded", "catalog"]);

type ProductMetadata = {
  imgUrl?: string | null;
  frontUrl?: string | null;
  backUrl?: string | null;
  variableFrontImg?: string | null;
  variableBackImg?: string | null;
  customPrice?: number | null;
  dateAdded?: string | null;
  customImg?: string | null;
  customVariableImg?: string | null;
  images?: string[] | null;
};

export interface ProductData {
  name: string;
  price: number;
  description: string;
  frontUrl?: string;
  backUrl?: string;
  imgUrl?: string;
  images?: string[];
  category: string;
  customPrice?: number | null;
  variableBackImg?: string | null;
  variableFrontImg?: string | null;
  customImg?: string | null;
  customVariableImg?: string | null;
}

export interface ProductUpdateData extends Partial<ProductData> {}

function parseImageList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueProductImageUrls(
    value.map((item) => (typeof item === "string" ? item : "")),
  ).slice(0, MAX_PRODUCT_IMAGES);
}

function parseMetadata(input: string | null): ProductMetadata {
  if (!input) return {};
  try {
    const parsed = JSON.parse(input) as ProductMetadata;
    if (!parsed || typeof parsed !== "object") return {};
    return {
      ...parsed,
      images: parseImageList(parsed.images),
    };
  } catch {
    return {};
  }
}

function normalizeOptionalUrl(value: string | null | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "";
}

function sanitizeProductImageUrl(value: string | null | undefined): string {
  const normalized = normalizeOptionalUrl(value);
  if (!normalized) return "";
  return isPlaceholderProductImageUrl(normalized) ? "" : normalized;
}

function sanitizeNullableProductImageUrl(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeOptionalUrl(value);
  if (!normalized) return null;
  return isPlaceholderProductImageUrl(normalized) ? null : normalized;
}

function normalizeProductPrice(value: number): number {
  return Math.trunc(value);
}

function toProductResponse(product: any) {
  const metadata = parseMetadata(product.metadata);
  const imgUrl = sanitizeProductImageUrl(product.img_url ?? metadata.imgUrl);
  const frontUrl = sanitizeProductImageUrl(product.front_img ?? metadata.frontUrl);
  const backUrl = sanitizeProductImageUrl(product.back_img ?? metadata.backUrl);
  const variableFrontImg = sanitizeNullableProductImageUrl(
    product.variable_front_img ?? metadata.variableFrontImg,
  );
  const variableBackImg = sanitizeNullableProductImageUrl(
    product.variable_back_img ?? metadata.variableBackImg,
  );
  const customImg = sanitizeNullableProductImageUrl(product.custom_img ?? metadata.customImg);
  const customVariableImg = sanitizeNullableProductImageUrl(
    product.custom_variable_img ?? metadata.customVariableImg,
  );
  const galleryImages = parseImageList(metadata.images);
  const images =
    galleryImages.length > 0
      ? galleryImages
      : uniqueProductImageUrls([
          imgUrl,
          frontUrl,
          backUrl,
          variableFrontImg,
          variableBackImg,
          customImg,
          customVariableImg,
        ]);

  return {
    productID: Number(product.id),
    name: product.name,
    price: resolveMerchandiseBasePrice(product),
    listPrice: Number(product.price),
    description: product.description ?? "",
    frontUrl,
    backUrl,
    imgUrl,
    images,
    dateAdded: product.date_added ?? product.created_at,
    category: product.category,
    customPrice:
      product.custom_price_value !== null
        ? product.custom_price_value.toNumber()
        : metadata.customPrice ?? null,
    variableBackImg,
    variableFrontImg,
    isActive: product.is_active,
    updatedAt: product.updated_at,
    customPriceEnabled: product.custom_price,
    customImg,
    customVariableImg,
  };
}

function validateProductData(
  requestId: string,
  productData: ProductData | ProductUpdateData,
  partial = false
): void {
  if (!partial || productData.name !== undefined) {
    if (!productData.name || productData.name.trim().length < 2) {
      throw createProductPromoError(
        ProductPromoErrorCode.PRODUCT_CREATION_FAILED,
        "Product name must be at least 2 characters",
        400,
        requestId
      );
    }
  }

  if (!partial || productData.price !== undefined) {
    if (
      typeof productData.price !== "number" ||
      !Number.isFinite(productData.price) ||
      productData.price < 0
    ) {
      throw createProductPromoError(
        ProductPromoErrorCode.INVALID_PRODUCT_PRICE,
        "Product price must be a non-negative number",
        400,
        requestId,
        { price: productData.price }
      );
    }
  }

  if (!partial || productData.category !== undefined) {
    if (!productData.category || productData.category.trim().length === 0) {
      throw createProductPromoError(
        ProductPromoErrorCode.INVALID_PRODUCT_CATEGORY,
        "Product category is required",
        400,
        requestId
      );
    }
  }

  const urls = [
    { key: "frontUrl", value: productData.frontUrl },
    { key: "backUrl", value: productData.backUrl },
    { key: "imgUrl", value: productData.imgUrl },
    { key: "variableFrontImg", value: productData.variableFrontImg },
    { key: "variableBackImg", value: productData.variableBackImg },
    { key: "customImg", value: productData.customImg },
    { key: "customVariableImg", value: productData.customVariableImg },
    ...(productData.images ?? []).map((value, index) => ({
      key: `images[${index}]`,
      value,
    })),
  ];

  for (const entry of urls) {
    if (entry.value && entry.value.startsWith("http")) {
      const validation = validateMediaUrl(entry.value, entry.key);
      if (!validation.valid) {
        throw createProductPromoError(
          ProductPromoErrorCode.INVALID_IMAGE_URL,
          validation.error,
          400,
          requestId,
          { field: entry.key }
        );
      }
    }
  }
}

function toLimit(value: number | undefined): number {
  if (!value || !Number.isInteger(value)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, value));
}

function toPage(value: number | undefined): number {
  if (!value || !Number.isInteger(value)) return 1;
  return Math.max(1, value);
}

export class ProductService {
  constructor(private readonly requestId: string) {}

  async getAllProducts(filters: {
    page?: number;
    limit?: number;
    category?: string;
    search?: string;
    sort_by?: string;
    sort_dir?: "asc" | "desc";
    includeInactive?: boolean;
  }): Promise<{ products: ReturnType<typeof toProductResponse>[]; pagination: Record<string, unknown> }> {
    const page = toPage(filters.page);
    const limit = toLimit(filters.limit);
    const skip = (page - 1) * limit;
    const sortBy = ALLOWED_SORT_FIELDS.has(filters.sort_by ?? "")
      ? filters.sort_by!
      : "catalog";
    const sortDir = filters.sort_dir === "asc" ? "asc" : "desc";
    const useCatalogOrder = sortBy === "catalog";

    const where: Prisma.MerchandiseWhereInput = {
      ...(filters.includeInactive ? {} : { is_active: true }),
      ...(filters.category ? { category: filters.category } : {}),
      ...(filters.search
        ? {
            OR: [
              { name: { contains: filters.search } },
              { description: { contains: filters.search } },
            ],
          }
        : {}),
    };

    const orderBy: Prisma.MerchandiseOrderByWithRelationInput =
      sortBy === "name"
        ? { name: sortDir }
        : sortBy === "price"
          ? { price: sortDir }
          : sortBy === "dateAdded"
            ? { date_added: sortDir }
            : { name: "asc" };

    if (useCatalogOrder) {
      // Catalog order must be applied in memory so pagination stays correct.
      const [allRows, total] = await Promise.all([
        prisma.merchandise.findMany({
          where,
          orderBy: { name: "asc" },
        }),
        prisma.merchandise.count({ where }),
      ]);
      const sorted = sortMerchandiseByCatalogOrder(allRows);
      const pageRows = sorted.slice(skip, skip + limit);
      return {
        products: pageRows.map(toProductResponse),
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
          has_next: page * limit < total,
          has_previous: page > 1,
        },
      };
    }

    const [rows, total] = await Promise.all([
      prisma.merchandise.findMany({
        where,
        orderBy,
        skip,
        take: limit,
      }),
      prisma.merchandise.count({ where }),
    ]);

    const products = rows.map(toProductResponse);

    return {
      products,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        has_next: page * limit < total,
        has_previous: page > 1,
      },
    };
  }

  /**
   * Top merchandise by completed purchase count (PurchaseLog).
   * Falls back to newest active products when purchase history is thin.
   */
  async getMostPurchasedProducts(limit = 3) {
    const take = Math.min(Math.max(Math.trunc(limit) || 3, 1), 12);

    const topPurchases = await prisma.purchaseLog.groupBy({
      by: ["item_id"],
      where: {
        purchase_type: "merchandise",
        status: "completed",
      },
      _count: { id: true },
      _sum: { amount: true },
      orderBy: { _count: { id: "desc" } },
      take,
    });

    const purchaseCountById = new Map(
      topPurchases.map((row) => [row.item_id.toString(), row._count.id]),
    );

    let rankedIds = topPurchases.map((row) => row.item_id);

    if (rankedIds.length < take) {
      const fillers = await prisma.merchandise.findMany({
        where: {
          is_active: true,
          ...(rankedIds.length > 0 ? { id: { notIn: rankedIds } } : {}),
        },
        orderBy: { date_added: "desc" },
        take: take - rankedIds.length,
        select: { id: true },
      });
      rankedIds = [...rankedIds, ...fillers.map((row) => row.id)];
    }

    if (rankedIds.length === 0) {
      return [];
    }

    const products = await prisma.merchandise.findMany({
      where: {
        id: { in: rankedIds },
        is_active: true,
      },
    });

    const productById = new Map(products.map((row) => [row.id.toString(), row]));

    return rankedIds
      .map((id) => {
        const product = productById.get(id.toString());
        if (!product) return null;
        return {
          ...toProductResponse(product),
          purchaseCount: purchaseCountById.get(id.toString()) ?? 0,
        };
      })
      .filter((product): product is NonNullable<typeof product> => Boolean(product))
      .slice(0, take);
  }

  async getProductById(productId: number, options?: { includeInactive?: boolean }) {
    const product = await prisma.merchandise.findUnique({
      where: { id: BigInt(productId) },
    });

    if (!product) {
      throw createProductPromoError(
        ProductPromoErrorCode.PRODUCT_NOT_FOUND,
        "Product not found",
        404,
        this.requestId,
        { productId }
      );
    }

    if (!options?.includeInactive && !product.is_active) {
      throw createProductPromoError(
        ProductPromoErrorCode.PRODUCT_NOT_FOUND,
        "Product not found",
        404,
        this.requestId,
        { productId }
      );
    }

    return toProductResponse(product);
  }

  async createProduct(productData: ProductData, createdBy: string) {
    validateProductData(this.requestId, productData, false);

    const existing = await prisma.merchandise.findFirst({
      where: {
        name: { equals: productData.name.trim() },
      },
      select: { id: true },
    });

    if (existing) {
      throw createProductPromoError(
        ProductPromoErrorCode.PRODUCT_NAME_EXISTS,
        "Product name already exists",
        409,
        this.requestId,
        { name: productData.name }
      );
    }

    const galleryImages = parseImageList(productData.images);
    const imgUrl =
      normalizeOptionalUrl(productData.imgUrl) || galleryImages[0] || null;
    const metadata: ProductMetadata = {
      imgUrl,
      frontUrl: normalizeOptionalUrl(productData.frontUrl) ?? null,
      backUrl: normalizeOptionalUrl(productData.backUrl) ?? null,
      variableFrontImg: normalizeOptionalUrl(productData.variableFrontImg) ?? null,
      variableBackImg: normalizeOptionalUrl(productData.variableBackImg) ?? null,
      customPrice:
        typeof productData.customPrice === "number" && Number.isFinite(productData.customPrice)
          ? productData.customPrice
          : null,
      dateAdded: new Date().toISOString(),
      images: galleryImages.length > 0 ? galleryImages : imgUrl ? [imgUrl] : [],
    };

    try {
      const created = await prisma.merchandise.create({
        data: {
          name: productData.name.trim(),
          description: productData.description,
          price: normalizeProductPrice(productData.price),
          img_url: imgUrl,
          front_img: normalizeOptionalUrl(productData.frontUrl) ?? null,
          back_img: normalizeOptionalUrl(productData.backUrl) ?? null,
          variable_front_img: normalizeOptionalUrl(productData.variableFrontImg) ?? null,
          variable_back_img: normalizeOptionalUrl(productData.variableBackImg) ?? null,
          category: productData.category.trim(),
          custom_price: typeof productData.customPrice === "number",
          custom_price_value:
            typeof productData.customPrice === "number" && Number.isFinite(productData.customPrice)
              ? new Prisma.Decimal(productData.customPrice)
              : null,
          is_active: true,
          date_added: new Date(),
          metadata: JSON.stringify(metadata),
        },
      });

      await this.writeAudit(createdBy, "product.create", {
        productId: created.id.toString(),
        name: created.name,
      });

      return toProductResponse(created);
    } catch (error) {
      throw createProductPromoError(
        ProductPromoErrorCode.PRODUCT_CREATION_FAILED,
        "Failed to create product",
        500,
        this.requestId,
        {
          error: error instanceof Error ? error.message : "Unknown error",
        }
      );
    }
  }

  async updateProduct(productId: number, productData: ProductUpdateData, updatedBy: string) {
    validateProductData(this.requestId, productData, true);

    const existing = await prisma.merchandise.findUnique({
      where: { id: BigInt(productId) },
    });

    if (!existing) {
      throw createProductPromoError(
        ProductPromoErrorCode.PRODUCT_NOT_FOUND,
        "Product not found",
        404,
        this.requestId,
        { productId }
      );
    }

    if (productData.name && productData.name.trim() !== existing.name) {
      const dup = await prisma.merchandise.findFirst({
        where: {
          name: { equals: productData.name.trim() },
          NOT: { id: existing.id },
        },
        select: { id: true },
      });

      if (dup) {
        throw createProductPromoError(
          ProductPromoErrorCode.PRODUCT_NAME_EXISTS,
          "Product name already exists",
          409,
          this.requestId,
          { name: productData.name }
        );
      }
    }

    const previousMetadata = parseMetadata(existing.metadata);
    const nextGalleryImages =
      productData.images !== undefined ? parseImageList(productData.images) : undefined;
    const nextImgUrl =
      productData.imgUrl !== undefined
        ? normalizeOptionalUrl(productData.imgUrl) ?? null
        : nextGalleryImages
          ? nextGalleryImages[0] ?? null
          : undefined;
    const nextMetadata: ProductMetadata = {
      ...previousMetadata,
      ...(nextImgUrl !== undefined ? { imgUrl: nextImgUrl } : {}),
      ...(productData.frontUrl !== undefined
        ? { frontUrl: normalizeOptionalUrl(productData.frontUrl) ?? null }
        : {}),
      ...(productData.backUrl !== undefined
        ? { backUrl: normalizeOptionalUrl(productData.backUrl) ?? null }
        : {}),
      ...(productData.variableFrontImg !== undefined
        ? { variableFrontImg: normalizeOptionalUrl(productData.variableFrontImg) ?? null }
        : {}),
      ...(productData.variableBackImg !== undefined
        ? { variableBackImg: normalizeOptionalUrl(productData.variableBackImg) ?? null }
        : {}),
      ...(productData.customPrice !== undefined
        ? { customPrice: productData.customPrice ?? null }
        : {}),
      ...(nextGalleryImages !== undefined ? { images: nextGalleryImages } : {}),
    };

    try {
      const updated = await prisma.merchandise.update({
        where: { id: existing.id },
        data: {
          ...(productData.name !== undefined ? { name: productData.name.trim() } : {}),
          ...(productData.description !== undefined ? { description: productData.description } : {}),
          ...(productData.price !== undefined
            ? { price: normalizeProductPrice(productData.price) }
            : {}),
          ...(nextImgUrl !== undefined ? { img_url: nextImgUrl } : {}),
          ...(productData.frontUrl !== undefined
            ? { front_img: normalizeOptionalUrl(productData.frontUrl) ?? null }
            : {}),
          ...(productData.backUrl !== undefined
            ? { back_img: normalizeOptionalUrl(productData.backUrl) ?? null }
            : {}),
          ...(productData.variableFrontImg !== undefined
            ? { variable_front_img: normalizeOptionalUrl(productData.variableFrontImg) ?? null }
            : {}),
          ...(productData.variableBackImg !== undefined
            ? { variable_back_img: normalizeOptionalUrl(productData.variableBackImg) ?? null }
            : {}),
          ...(productData.category !== undefined ? { category: productData.category.trim() } : {}),
          ...(productData.customPrice !== undefined
            ? { custom_price: productData.customPrice !== null }
            : {}),
          ...(productData.customPrice !== undefined
            ? {
                custom_price_value:
                  typeof productData.customPrice === "number" && Number.isFinite(productData.customPrice)
                    ? new Prisma.Decimal(productData.customPrice)
                    : null,
              }
            : {}),
          metadata: JSON.stringify(nextMetadata),
          updated_at: new Date(),
        },
      });

      await this.writeAudit(updatedBy, "product.update", {
        productId: updated.id.toString(),
        fields: Object.keys(productData),
      });

      return toProductResponse(updated);
    } catch (error) {
      throw createProductPromoError(
        ProductPromoErrorCode.PRODUCT_UPDATE_FAILED,
        "Failed to update product",
        500,
        this.requestId,
        {
          error: error instanceof Error ? error.message : "Unknown error",
        }
      );
    }
  }

  async deleteProduct(productId: number, actorUserId: string, permanent = false) {
    const existing = await prisma.merchandise.findUnique({
      where: { id: BigInt(productId) },
    });

    if (!existing) {
      throw createProductPromoError(
        ProductPromoErrorCode.PRODUCT_NOT_FOUND,
        "Product not found",
        404,
        this.requestId,
        { productId }
      );
    }

    if (permanent) {
      const usage = await prisma.shopOrderItem.count({
        where: {
          item_type: "merchandise",
          item_id: existing.id,
        },
      });

      if (usage > 0) {
        throw createProductPromoError(
          ProductPromoErrorCode.PRODUCT_DELETE_FAILED,
          "Product cannot be permanently deleted because order history exists",
          409,
          this.requestId,
          { productId, usage }
        );
      }

      await prisma.merchandise.delete({ where: { id: existing.id } });
    } else {
      await prisma.merchandise.update({
        where: { id: existing.id },
        data: { is_active: false, updated_at: new Date() },
      });
    }

    await this.writeAudit(actorUserId, "product.delete", {
      productId: existing.id.toString(),
      permanent,
    });

    return {
      productID: Number(existing.id),
      permanent,
      message: permanent ? "Product permanently deleted" : "Product archived successfully",
    };
  }

  async getProductCategories(): Promise<string[]> {
    const rows = await prisma.merchandise.findMany({
      where: { is_active: true },
      select: { category: true },
      distinct: ["category"],
      orderBy: { category: "asc" },
    });

    return rows.map((row) => row.category);
  }

  async uploadProductImages(
    files: {
      frontImage?: File;
      backImage?: File;
      mainImage?: File;
      variableFrontImage?: File;
      variableBackImage?: File;
      images?: File[];
    },
    productName: string
  ): Promise<{
    frontUrl?: string;
    backUrl?: string;
    imgUrl?: string;
    variableFrontImg?: string;
    variableBackImg?: string;
    images: string[];
  }> {
    const galleryFiles = (files.images ?? []).filter(
      (file): file is File => file instanceof File && file.size > 0,
    );
    const namedCount = [
      files.frontImage,
      files.backImage,
      files.mainImage,
      files.variableFrontImage,
      files.variableBackImage,
    ].filter(Boolean).length;
    const totalCount = namedCount + galleryFiles.length;

    if (totalCount > MAX_PRODUCT_IMAGES) {
      throw createProductPromoError(
        ProductPromoErrorCode.IMAGE_UPLOAD_FAILED,
        `A product can have at most ${MAX_PRODUCT_IMAGES} images`,
        400,
        this.requestId,
        { max: MAX_PRODUCT_IMAGES, received: totalCount }
      );
    }

    const cloudinary = new CloudinaryService(this.requestId);

    const tasks: Array<Promise<{ key: string; url: string }>> = [];
    const enqueue = (key: string, file: File | undefined) => {
      if (!file) return;
      tasks.push(
        (async () => {
          const mime = file.type.toLowerCase();
          const validation = validateUploadedFile(mime, file.size, "image");
          if (!validation.valid) {
            throw createProductPromoError(
              ProductPromoErrorCode.IMAGE_UPLOAD_FAILED,
              validation.error,
              validation.code === "FILE_TOO_LARGE" ? 413 : 400,
              this.requestId,
              { key }
            );
          }

          const buffer = Buffer.from(await file.arrayBuffer());
          const uploaded = await cloudinary.uploadFile({
            fileBuffer: buffer,
            originalName: file.name,
            mimeType: mime,
            bizcardName: productName,
            fileCategory: key,
            folder: "products",
          });

          return { key, url: uploaded.secure_url };
        })()
      );
    };

    enqueue("front", files.frontImage);
    enqueue("back", files.backImage);
    enqueue("main", files.mainImage);
    enqueue("variable_front", files.variableFrontImage);
    enqueue("variable_back", files.variableBackImage);
    galleryFiles.forEach((file, index) => enqueue(`gallery_${index}`, file));

    const uploaded = await Promise.all(tasks);

    const result: {
      frontUrl?: string;
      backUrl?: string;
      imgUrl?: string;
      variableFrontImg?: string;
      variableBackImg?: string;
      images: string[];
    } = { images: [] };

    const galleryUrls: string[] = [];
    for (const file of uploaded) {
      if (file.key === "front") result.frontUrl = file.url;
      else if (file.key === "back") result.backUrl = file.url;
      else if (file.key === "main") result.imgUrl = file.url;
      else if (file.key === "variable_front") result.variableFrontImg = file.url;
      else if (file.key === "variable_back") result.variableBackImg = file.url;
      else if (file.key.startsWith("gallery_")) galleryUrls.push(file.url);
    }

    if (!result.imgUrl && galleryUrls[0]) {
      result.imgUrl = galleryUrls[0];
    }

    result.images = uniqueProductImageUrls([
      result.imgUrl,
      result.frontUrl,
      result.backUrl,
      result.variableFrontImg,
      result.variableBackImg,
      ...galleryUrls,
    ]);

    return result;
  }

  private async writeAudit(actorUserId: string, action: string, details: Record<string, unknown>) {
    try {
      if (!/^\d+$/.test(actorUserId)) return;
      const adminUserId = BigInt(actorUserId);
      const actor = await prisma.user.findUnique({
        where: { user_id: adminUserId },
        select: { email: true },
      });
      if (!actor) return;

      await prisma.adminAuditLog.create({
        data: {
          admin_user_id: adminUserId,
          admin_email: actor.email,
          action,
          details: JSON.stringify(details),
        },
      });
    } catch {
      // Best effort audit log; do not fail primary flow.
    }
  }
}
