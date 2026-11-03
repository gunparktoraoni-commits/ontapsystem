// @ts-nocheck
import { randomUUID } from "node:crypto";
import { prisma } from "@/server/lib/prisma";
import { deleteFromR2 } from "@/server/lib/r2";
import { AppError, ErrorCode } from "@/lib/errors/types";

const db = prisma as any;

type ResourceType = "image" | "video" | "raw";
type MediaType = "image" | "video";

export interface CreateMediaPayload {
  secureUrl: string;
  fileUrl?: string;
  cloudinaryPublicId?: string;
  mediaType: MediaType;
  resourceType?: ResourceType;
  mimeType?: string;
  fileName?: string;
  format?: string;
  width?: number;
  height?: number;
  sizeBytes?: number;
  durationSec?: number;
  altText?: string;
  caption?: string;
  tags?: string[];
  sortOrder?: number;
  isFeatured?: boolean;
  isVisible?: boolean;
}

export interface UpdateMediaPayload {
  altText?: string | null;
  caption?: string | null;
  tags?: string[];
  sortOrder?: number;
  isFeatured?: boolean;
  isVisible?: boolean;
}

function normalizeOptionalText(value: string | null | undefined, max: number): string | null {
  if (value === undefined) return null;
  if (value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return tags
    .map((tag) => (typeof tag === "string" ? tag.trim() : ""))
    .filter(Boolean)
    .slice(0, 20)
    .map((tag) => tag.slice(0, 50));
}

function ensurePositiveInt(value: number | undefined, field: string, requestId: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 0) {
    throw new AppError(
      ErrorCode.MEDIA_VALIDATION_FAILED,
      `${field} must be a non-negative integer`,
      400,
      { field, value },
      requestId
    );
  }
  return value;
}

function ensurePositiveNumber(value: number | undefined, field: string, requestId: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0) {
    throw new AppError(
      ErrorCode.MEDIA_VALIDATION_FAILED,
      `${field} must be a non-negative number`,
      400,
      { field, value },
      requestId
    );
  }
  return value;
}

function extractPublicIdFromUrl(url: string): string | null {
  const marker = "/upload/";
  const markerIdx = url.indexOf(marker);
  if (markerIdx === -1) return null;

  let tail = url.slice(markerIdx + marker.length);
  const versionMatch = tail.match(/^v\d+\//);
  if (versionMatch) {
    tail = tail.slice(versionMatch[0].length);
  }

  const queryIdx = tail.indexOf("?");
  if (queryIdx >= 0) tail = tail.slice(0, queryIdx);

  const lastDot = tail.lastIndexOf(".");
  if (lastDot <= 0) return decodeURIComponent(tail);

  return decodeURIComponent(tail.slice(0, lastDot));
}

export class MediaService {
  private readonly requestId: string;

  constructor(requestId?: string) {
    this.requestId = requestId ?? randomUUID();
  }

  private async assertBizcardOwnership(bizcardId: number, userId: number): Promise<void> {
    const bizcard = await db.bizcard.findFirst({
      where: {
        bizcard_id: BigInt(bizcardId),
        user_id: BigInt(userId),
        deactivated_flag: false,
      },
      select: { bizcard_id: true },
    });

    if (!bizcard) {
      throw new AppError(
        ErrorCode.MEDIA_PERMISSION_DENIED,
        "Bizcard not found or does not belong to this user",
        404,
        { bizcardId, userId },
        this.requestId
      );
    }
  }

  private async writeAuditLog(args: {
    tx: any;
    mediaId?: bigint | null;
    bizcardId: number;
    userId: number;
    action: string;
    ip?: string;
    userAgent?: string;
    beforeData?: Record<string, unknown> | null;
    afterData?: Record<string, unknown> | null;
  }): Promise<void> {
    await args.tx.mediaAuditLog.create({
      data: {
        media_id: args.mediaId ?? null,
        bizcard_id: BigInt(args.bizcardId),
        user_id: BigInt(args.userId),
        action: args.action,
        ip_address: args.ip?.slice(0, 45),
        user_agent: args.userAgent?.slice(0, 512),
        before_data: args.beforeData ?? undefined,
        after_data: args.afterData ?? undefined,
      },
    });
  }

  async listForOwner(bizcardId: number, userId: number): Promise<Array<Record<string, unknown>>> {
    await this.assertBizcardOwnership(bizcardId, userId);

    const rows = await db.bizcardMedia.findMany({
      where: {
        bizcard_id: BigInt(bizcardId),
        user_id: BigInt(userId),
        is_deleted: false,
      },
      orderBy: [{ sort_order: "asc" }, { created_at: "asc" }],
    });

    return rows.map((row: any) => ({
      mediaId: row.media_id,
      bizcardId: row.bizcard_id,
      mediaType: row.media_type,
      resourceType: row.resource_type,
      cloudinaryPublicId: row.cloudinary_public_id,
      fileUrl: row.file_url,
      secureUrl: row.secure_url,
      mimeType: row.mime_type,
      fileName: row.file_name,
      format: row.format,
      width: row.width,
      height: row.height,
      sizeBytes: row.size_bytes,
      durationSec: row.duration_sec,
      altText: row.alt_text,
      caption: row.caption,
      tags: row.tags,
      sortOrder: row.sort_order,
      isFeatured: row.is_featured,
      isVisible: row.is_visible,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async createMedia(args: {
    bizcardId: number;
    userId: number;
    payload: CreateMediaPayload;
    ip?: string;
    userAgent?: string;
  }): Promise<Record<string, unknown>> {
    await this.assertBizcardOwnership(args.bizcardId, args.userId);

    const payload = args.payload;
    if (!payload.secureUrl || !isOwnCloudinaryUrl(payload.secureUrl)) {
      throw new AppError(
        ErrorCode.MEDIA_VALIDATION_FAILED,
        "secureUrl must be a Cloudinary URL from this account",
        422,
        { secureUrl: payload.secureUrl },
        this.requestId
      );
    }

    if (payload.mediaType !== "image" && payload.mediaType !== "video") {
      throw new AppError(
        ErrorCode.MEDIA_UNSUPPORTED_TYPE,
        "mediaType must be image or video",
        422,
        { mediaType: payload.mediaType },
        this.requestId
      );
    }

    const publicId = payload.cloudinaryPublicId?.trim() || extractPublicIdFromUrl(payload.secureUrl);
    if (!publicId) {
      throw new AppError(
        ErrorCode.MEDIA_VALIDATION_FAILED,
        "cloudinaryPublicId is required when it cannot be derived from secureUrl",
        422,
        {},
        this.requestId
      );
    }

    const width = ensurePositiveInt(payload.width, "width", this.requestId);
    const height = ensurePositiveInt(payload.height, "height", this.requestId);
    const sizeBytes = ensurePositiveNumber(payload.sizeBytes, "sizeBytes", this.requestId);
    const durationSec = ensurePositiveNumber(payload.durationSec, "durationSec", this.requestId);
    const tags = normalizeTags(payload.tags);
    const altText = normalizeOptionalText(payload.altText, 255);
    const caption = normalizeOptionalText(payload.caption, 2000);

    return db.$transaction(async (tx: any) => {
      if (payload.isFeatured) {
        await tx.bizcardMedia.updateMany({
          where: {
            bizcard_id: BigInt(args.bizcardId),
            user_id: BigInt(args.userId),
            is_deleted: false,
            is_featured: true,
          },
          data: { is_featured: false, updated_at: new Date() },
        });
      }

      const computedSortOrder =
        payload.sortOrder !== undefined
          ? payload.sortOrder
          : (await tx.bizcardMedia.count({
              where: {
                bizcard_id: BigInt(args.bizcardId),
                user_id: BigInt(args.userId),
                is_deleted: false,
              },
            }));

      const created = await tx.bizcardMedia.create({
        data: {
          bizcard_id: BigInt(args.bizcardId),
          user_id: BigInt(args.userId),
          media_type: payload.mediaType,
          resource_type: payload.resourceType ?? payload.mediaType,
          cloudinary_public_id: publicId,
          file_url: payload.fileUrl ?? payload.secureUrl,
          secure_url: payload.secureUrl,
          mime_type: payload.mimeType?.trim() || null,
          file_name: payload.fileName?.trim() || null,
          format: payload.format?.trim() || null,
          width: width ?? null,
          height: height ?? null,
          size_bytes: sizeBytes !== undefined ? BigInt(Math.trunc(sizeBytes)) : null,
          duration_sec: durationSec ?? null,
          alt_text: altText,
          caption,
          tags,
          sort_order: computedSortOrder,
          is_featured: payload.isFeatured ?? false,
          is_visible: payload.isVisible ?? true,
        },
      });

      await this.writeAuditLog({
        tx,
        mediaId: created.media_id,
        bizcardId: args.bizcardId,
        userId: args.userId,
        action: "MEDIA_CREATED",
        ip: args.ip,
        userAgent: args.userAgent,
        afterData: {
          mediaId: created.media_id.toString(),
          cloudinaryPublicId: created.cloudinary_public_id,
          mediaType: created.media_type,
          sortOrder: created.sort_order,
          isFeatured: created.is_featured,
          isVisible: created.is_visible,
        },
      });

      return {
        mediaId: created.media_id,
        bizcardId: created.bizcard_id,
        mediaType: created.media_type,
        resourceType: created.resource_type,
        cloudinaryPublicId: created.cloudinary_public_id,
        secureUrl: created.secure_url,
        fileUrl: created.file_url,
        altText: created.alt_text,
        caption: created.caption,
        tags: created.tags,
        sortOrder: created.sort_order,
        isFeatured: created.is_featured,
        isVisible: created.is_visible,
        createdAt: created.created_at,
      };
    });
  }

  async updateMedia(args: {
    bizcardId: number;
    userId: number;
    mediaId: number;
    payload: UpdateMediaPayload;
    ip?: string;
    userAgent?: string;
  }): Promise<Record<string, unknown>> {
    await this.assertBizcardOwnership(args.bizcardId, args.userId);

    const existing = await db.bizcardMedia.findFirst({
      where: {
        media_id: BigInt(args.mediaId),
        bizcard_id: BigInt(args.bizcardId),
        user_id: BigInt(args.userId),
        is_deleted: false,
      },
    });

    if (!existing) {
      throw new AppError(
        ErrorCode.MEDIA_NOT_FOUND,
        "Media entry not found",
        404,
        { mediaId: args.mediaId, bizcardId: args.bizcardId },
        this.requestId
      );
    }

    const tags = args.payload.tags !== undefined ? normalizeTags(args.payload.tags) : undefined;
    const sortOrder =
      args.payload.sortOrder !== undefined
        ? ensurePositiveInt(args.payload.sortOrder, "sortOrder", this.requestId)
        : undefined;

    return db.$transaction(async (tx: any) => {
      if (args.payload.isFeatured) {
        await tx.bizcardMedia.updateMany({
          where: {
            bizcard_id: BigInt(args.bizcardId),
            user_id: BigInt(args.userId),
            is_deleted: false,
            is_featured: true,
            media_id: { not: BigInt(args.mediaId) },
          },
          data: { is_featured: false, updated_at: new Date() },
        });
      }

      const updated = await tx.bizcardMedia.update({
        where: { media_id: BigInt(args.mediaId) },
        data: {
          ...(args.payload.altText !== undefined && { alt_text: normalizeOptionalText(args.payload.altText, 255) }),
          ...(args.payload.caption !== undefined && { caption: normalizeOptionalText(args.payload.caption, 2000) }),
          ...(tags !== undefined && { tags }),
          ...(sortOrder !== undefined && { sort_order: sortOrder }),
          ...(args.payload.isFeatured !== undefined && { is_featured: args.payload.isFeatured }),
          ...(args.payload.isVisible !== undefined && { is_visible: args.payload.isVisible }),
          updated_at: new Date(),
        },
      });

      await this.writeAuditLog({
        tx,
        mediaId: updated.media_id,
        bizcardId: args.bizcardId,
        userId: args.userId,
        action: "MEDIA_UPDATED",
        ip: args.ip,
        userAgent: args.userAgent,
        beforeData: {
          altText: existing.alt_text,
          caption: existing.caption,
          tags: existing.tags,
          sortOrder: existing.sort_order,
          isFeatured: existing.is_featured,
          isVisible: existing.is_visible,
        },
        afterData: {
          altText: updated.alt_text,
          caption: updated.caption,
          tags: updated.tags,
          sortOrder: updated.sort_order,
          isFeatured: updated.is_featured,
          isVisible: updated.is_visible,
        },
      });

      return {
        mediaId: updated.media_id,
        sortOrder: updated.sort_order,
        isFeatured: updated.is_featured,
        isVisible: updated.is_visible,
        altText: updated.alt_text,
        caption: updated.caption,
        tags: updated.tags,
        updatedAt: updated.updated_at,
      };
    });
  }

  async deleteMedia(args: {
    bizcardId: number;
    userId: number;
    mediaId: number;
    ip?: string;
    userAgent?: string;
  }): Promise<void> {
    await this.assertBizcardOwnership(args.bizcardId, args.userId);

    const existing = await db.bizcardMedia.findFirst({
      where: {
        media_id: BigInt(args.mediaId),
        bizcard_id: BigInt(args.bizcardId),
        user_id: BigInt(args.userId),
        is_deleted: false,
      },
    });

    if (!existing) {
      throw new AppError(
        ErrorCode.MEDIA_NOT_FOUND,
        "Media entry not found",
        404,
        { mediaId: args.mediaId, bizcardId: args.bizcardId },
        this.requestId
      );
    }

    await db.$transaction(async (tx: any) => {
      await tx.bizcardMedia.update({
        where: { media_id: existing.media_id },
        data: {
          is_deleted: true,
          deleted_at: new Date(),
          is_visible: false,
          is_featured: false,
          updated_at: new Date(),
        },
      });

      await this.writeAuditLog({
        tx,
        mediaId: existing.media_id,
        bizcardId: args.bizcardId,
        userId: args.userId,
        action: "MEDIA_DELETED",
        ip: args.ip,
        userAgent: args.userAgent,
        beforeData: {
          cloudinaryPublicId: existing.cloudinary_public_id,
          secureUrl: existing.secure_url,
          sortOrder: existing.sort_order,
          isFeatured: existing.is_featured,
        },
        afterData: {
          isDeleted: true,
        },
      });
    });

    // R2 delete is intentionally outside transaction.
    await deleteFromR2(existing.cloudinary_public_id);
  }

  async reorderMedia(args: {
    bizcardId: number;
    userId: number;
    orderedMediaIds: number[];
    ip?: string;
    userAgent?: string;
  }): Promise<void> {
    await this.assertBizcardOwnership(args.bizcardId, args.userId);

    const distinctIds = Array.from(new Set(args.orderedMediaIds.filter((v) => Number.isInteger(v) && v > 0)));
    if (!distinctIds.length) {
      throw new AppError(
        ErrorCode.MEDIA_REORDER_INVALID,
        "orderedMediaIds must contain at least one media ID",
        422,
        { orderedMediaIds: args.orderedMediaIds },
        this.requestId
      );
    }

    const existing = await db.bizcardMedia.findMany({
      where: {
        bizcard_id: BigInt(args.bizcardId),
        user_id: BigInt(args.userId),
        is_deleted: false,
      },
      select: { media_id: true, sort_order: true },
      orderBy: { sort_order: "asc" },
    });

    const existingIds = existing.map((item: any) => Number(item.media_id));
    if (existingIds.length !== distinctIds.length) {
      throw new AppError(
        ErrorCode.MEDIA_REORDER_INVALID,
        "orderedMediaIds must include every existing media ID exactly once",
        422,
        { expectedCount: existingIds.length, providedCount: distinctIds.length },
        this.requestId
      );
    }

    const existingSet = new Set(existingIds);
    if (distinctIds.some((id) => !existingSet.has(id))) {
      throw new AppError(
        ErrorCode.MEDIA_REORDER_INVALID,
        "orderedMediaIds contains media entries outside this bizcard",
        422,
        { orderedMediaIds: distinctIds },
        this.requestId
      );
    }

    await db.$transaction(async (tx: any) => {
      for (let i = 0; i < distinctIds.length; i += 1) {
        await tx.bizcardMedia.update({
          where: { media_id: BigInt(distinctIds[i]) },
          data: { sort_order: i, updated_at: new Date() },
        });
      }

      await this.writeAuditLog({
        tx,
        bizcardId: args.bizcardId,
        userId: args.userId,
        action: "MEDIA_REORDERED",
        ip: args.ip,
        userAgent: args.userAgent,
        beforeData: {
          order: existing.map((row: any) => ({ mediaId: row.media_id.toString(), sortOrder: row.sort_order })),
        },
        afterData: {
          order: distinctIds.map((mediaId, sortOrder) => ({ mediaId: String(mediaId), sortOrder })),
        },
      });
    });
  }

  async getPublicGallery(username: string): Promise<{
    username: string;
    bizcardId: bigint;
    gallery: Array<Record<string, unknown>>;
    videos: Array<Record<string, unknown>>;
  } | null> {
    const bizcard = await db.bizcard.findFirst({
      where: {
        url_alias: username,
        deactivated_flag: false,
        user: { is_active: true },
      },
      select: {
        bizcard_id: true,
        url_alias: true,
      },
    });

    if (!bizcard) return null;

    const mediaRows = await db.bizcardMedia.findMany({
      where: {
        bizcard_id: bizcard.bizcard_id,
        is_deleted: false,
        is_visible: true,
      },
      orderBy: [{ sort_order: "asc" }, { created_at: "asc" }],
      select: {
        media_id: true,
        media_type: true,
        secure_url: true,
        alt_text: true,
        caption: true,
        tags: true,
        width: true,
        height: true,
        duration_sec: true,
        sort_order: true,
        is_featured: true,
      },
      take: 200,
    });

    const mapped = mediaRows.map((row: any) => ({
      id: row.media_id,
      media_type: row.media_type,
      url: row.secure_url,
      alt_text: row.alt_text,
      caption: row.caption,
      tags: row.tags,
      width: row.width,
      height: row.height,
      duration_sec: row.duration_sec,
      sort_order: row.sort_order,
      featured: row.is_featured,
    }));

    return {
      username: bizcard.url_alias ?? username,
      bizcardId: bizcard.bizcard_id,
      gallery: mapped.filter((row: any) => row.media_type !== "video"),
      videos: mapped.filter((row: any) => row.media_type === "video"),
    };
  }
}
