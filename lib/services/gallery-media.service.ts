// lib/services/gallery-media.service.ts
import { prisma } from "@/server/lib/prisma";
import { uploadToR2, deleteFromR2, isOwnR2Url } from "@/server/lib/r2";
import { createNotFoundError } from "@/lib/errors/types";

export interface UploadMediaParams {
  bizcardId: number;
  userId: string;
  fileBuffer: Buffer;
  originalName: string;
  mimeType: string;
  fileCategory: string;
  metadata: {
    title?: string;
    description?: string;
    is_featured?: boolean;
  };
  ip: string;
  userAgent: string;
}

export interface UpdateMediaParams {
  bizcardId: number;
  userId: string;
  mediaId: number;
  updates: {
    title?: string | null;
    description?: string | null;
    alt_text?: string | null;
    display_order?: number;
    is_featured?: boolean;
  };
  /** Optional replacement binary — when set, uploads to R2 and updates file_url. */
  file?: {
    fileBuffer: Buffer;
    originalName: string;
    mimeType: string;
  };
  ip: string;
  userAgent: string;
}

export interface MediaItem {
  id: number;
  url: string;
  thumbnail: string | null;
  title: string | null;
  description: string | null;
  type: "image" | "video";
  mime_type: string;
  size: number;
  width: number | null;
  height: number | null;
  display_order: number;
  is_featured: boolean;
  created_at: Date;
}

/**
 * Validate title input - only text, no HTML/scripts
 */
function validateTitle(title: string | null | undefined): string | null {
  if (title === null || title === undefined) return null;
  if (typeof title !== "string") return null;
  
  const trimmed = title.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > 255) return trimmed.slice(0, 255);
  
  const sanitized = trimmed
    .replace(/<[^>]*>/g, "")
    .replace(/[<>]/g, "")
    .replace(/&[^;]+;/g, "");
  
  return sanitized || null;
}

/**
 * Validate description input - only text, no HTML/scripts
 */
function validateDescription(description: string | null | undefined): string | null {
  if (description === null || description === undefined) return null;
  if (typeof description !== "string") return null;
  
  const trimmed = description.trim();
  if (trimmed.length === 0) return null;
  
  const sanitized = trimmed
    .replace(/<[^>]*>/g, "")
    .replace(/[<>]/g, "")
    .replace(/&[^;]+;/g, "");
  
  return sanitized || null;
}

/**
 * Validate alt_text - accessibility text
 */
function validateAltText(altText: string | null | undefined): string | null {
  if (altText === null || altText === undefined) return null;
  if (typeof altText !== "string") return null;
  
  const trimmed = altText.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > 500) return trimmed.slice(0, 500);
  
  const sanitized = trimmed
    .replace(/<[^>]*>/g, "")
    .replace(/[<>]/g, "");
  
  return sanitized || null;
}

/**
 * Generate filename: {bizcardId}_{sanitizedTitle}_{timestamp}.{ext}
 */
function generateFileName(bizcardId: number, title: string | null | undefined, originalName: string, extension: string): string {
  const timestamp = Date.now();
  const bizcardPart = `bizcard_${bizcardId}`;
  
  if (title && title.trim()) {
    const titlePart = title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 50);
    return `${bizcardPart}_${titlePart}_${timestamp}.${extension}`;
  }
  
  const namePart = originalName
    .replace(/\.[^/.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 50);
  return `${bizcardPart}_${namePart}_${timestamp}.${extension}`;
}

export class GalleryMediaService {
  private requestId: string;

  constructor(requestId: string = "unknown") {
    this.requestId = requestId;
  }

  async getUserGallery(bizcardId: number, userId: string): Promise<MediaItem[]> {
    const bizcard = await prisma.bizcard.findFirst({
      where: {
        bizcard_id: BigInt(bizcardId),
        user_id: BigInt(userId),
        deactivated_flag: false,
      },
      select: { bizcard_id: true },
    });

    if (!bizcard) {
      throw createNotFoundError("Bizcard", String(bizcardId), this.requestId);
    }

    const media = await prisma.media.findMany({
      where: {
        user_id: BigInt(userId),
        related_type: "gallery",
        related_id: BigInt(bizcardId),
        is_active: true,
        deleted_at: null,
      },
      orderBy: [{ display_order: "asc" }, { created_at: "asc" }],
      select: {
        media_id: true,
        file_url: true,
        mime_type: true,
        size: true,
        width: true,
        height: true,
        display_order: true,
        is_featured: true,
        created_at: true,
        title: true,
        description: true,
      },
    });

    return media.map((item) => ({
      id: Number(item.media_id),
      url: item.file_url,
      thumbnail: item.file_url,
      title: item.title,
      description: item.description,
      type: item.mime_type?.startsWith("video/") ? "video" : "image",
      mime_type: item.mime_type || "image/jpeg",
      size: item.size ? Number(item.size) : 0,
      width: item.width,
      height: item.height,
      display_order: item.display_order || 0,
      is_featured: item.is_featured || false,
      created_at: item.created_at,
    }));
  }

  async uploadMedia(params: UploadMediaParams): Promise<MediaItem> {
    const { bizcardId, userId, fileBuffer, originalName, mimeType, fileCategory, metadata, ip, userAgent } = params;

    const bizcard = await prisma.bizcard.findFirst({
      where: {
        bizcard_id: BigInt(bizcardId),
        user_id: BigInt(userId),
        deactivated_flag: false,
      },
      select: { bizcard_id: true, bizcard_name: true },
    });

    if (!bizcard) {
      throw createNotFoundError("Bizcard", String(bizcardId), this.requestId);
    }

    const title = validateTitle(metadata.title);
    const description = validateDescription(metadata.description);

    const isVideo = mimeType.startsWith("video/");
    const extension = isVideo
      ? mimeType === "video/mp4" ? "mp4" : mimeType === "video/quicktime" ? "mov" : "webm"
      : mimeType === "image/jpeg" ? "jpg" : mimeType === "image/png" ? "png" : "webp";

    const generatedFileName = generateFileName(bizcardId, title, originalName, extension);

    const resourceType = isVideo ? "video" : "image";
    const uploadResult = await uploadToR2(
      fileBuffer,
      mimeType,
      "portfolio",
      userId,
      undefined,
      generatedFileName,
      { width: undefined, height: undefined, duration: undefined }
    );

    const existingCount = await prisma.media.count({
      where: {
        user_id: BigInt(userId),
        related_type: "gallery",
        related_id: BigInt(bizcardId),
        is_active: true,
        deleted_at: null,
      },
    });

    const media = await prisma.media.create({
      data: {
        user_id: BigInt(userId),
        related_type: "gallery",
        related_id: BigInt(bizcardId),
        file_name: generatedFileName,
        original_filename: originalName,
        file_url: uploadResult.url,
        cloudinary_public_id: uploadResult.key,
        mime_type: mimeType,
        size: BigInt(uploadResult.bytes),
        width: uploadResult.width,
        height: uploadResult.height,
        storage_provider: "r2",
        media_type: isVideo ? "video" : "image",
        display_order: existingCount,
        is_featured: metadata.is_featured || false,
        is_active: true,
        title: title,
        description: description,
        metadata: JSON.stringify({
          uploaded_by: userId,
          ip_address: ip,
          user_agent: userAgent,
          original_name: originalName,
          bizcard_name: bizcard.bizcard_name,
          r2_key: uploadResult.key,
        }),
      },
      select: {
        media_id: true,
        file_url: true,
        mime_type: true,
        size: true,
        width: true,
        height: true,
        display_order: true,
        is_featured: true,
        created_at: true,
        title: true,
        description: true,
      },
    });

    return {
      id: Number(media.media_id),
      url: media.file_url,
      thumbnail: media.file_url,
      title: media.title,
      description: media.description,
      type: media.mime_type?.startsWith("video/") ? "video" : "image",
      mime_type: media.mime_type || (isVideo ? "video/mp4" : "image/jpeg"),
      size: media.size ? Number(media.size) : 0,
      width: media.width,
      height: media.height,
      display_order: media.display_order || 0,
      is_featured: media.is_featured || false,
      created_at: media.created_at,
    };
  }

  async registerCloudinaryMedia(params: {
    bizcardId: number;
    userId: string;
    secureUrl: string;
    publicId: string;
    mimeType: string;
    bytes: number;
    fileCategory: string;
    metadata: {
      title?: string;
      description?: string;
      is_featured?: boolean;
    };
    ip: string;
    userAgent: string;
  }): Promise<MediaItem> {
    const {
      bizcardId,
      userId,
      secureUrl,
      publicId,
      mimeType,
      bytes,
      fileCategory,
      metadata,
      ip,
      userAgent,
    } = params;

    if (!isOwnR2Url(secureUrl)) {
      throw createNotFoundError("Media URL", secureUrl, this.requestId);
    }

    const bizcard = await prisma.bizcard.findFirst({
      where: {
        bizcard_id: BigInt(bizcardId),
        user_id: BigInt(userId),
        deactivated_flag: false,
      },
      select: { bizcard_id: true, bizcard_name: true },
    });

    if (!bizcard) {
      throw createNotFoundError("Bizcard", String(bizcardId), this.requestId);
    }

    const title = validateTitle(metadata.title);
    const description = validateDescription(metadata.description);
    const isVideo = mimeType.startsWith("video/");
    const generatedFileName = generateFileName(
      bizcardId,
      title,
      `${publicId.split("/").pop() ?? "media"}.${mimeType.split("/")[1] ?? "mp4"}`,
      isVideo ? "mp4" : "jpg",
    );

    const existingCount = await prisma.media.count({
      where: {
        user_id: BigInt(userId),
        related_type: "gallery",
        related_id: BigInt(bizcardId),
        is_active: true,
        deleted_at: null,
      },
    });

    const media = await prisma.media.create({
      data: {
        user_id: BigInt(userId),
        related_type: "gallery",
        related_id: BigInt(bizcardId),
        file_name: generatedFileName,
        original_filename: generatedFileName,
        file_url: secureUrl,
        cloudinary_public_id: publicId,
        mime_type: mimeType,
        size: BigInt(bytes),
        storage_provider: "cloudinary",
        media_type: isVideo || fileCategory === "video" ? "video" : "image",
        display_order: existingCount,
        is_featured: metadata.is_featured || false,
        is_active: true,
        title,
        description,
        metadata: JSON.stringify({
          uploaded_by: userId,
          ip_address: ip,
          user_agent: userAgent,
          bizcard_name: bizcard.bizcard_name,
          import_source: "signed_upload",
        }),
      },
      select: {
        media_id: true,
        file_url: true,
        mime_type: true,
        size: true,
        width: true,
        height: true,
        display_order: true,
        is_featured: true,
        created_at: true,
        title: true,
        description: true,
      },
    });

    return {
      id: Number(media.media_id),
      url: media.file_url,
      thumbnail: media.file_url,
      title: media.title,
      description: media.description,
      type: media.mime_type?.startsWith("video/") ? "video" : "image",
      mime_type: media.mime_type || (isVideo ? "video/mp4" : "image/jpeg"),
      size: media.size ? Number(media.size) : 0,
      width: media.width,
      height: media.height,
      display_order: media.display_order || 0,
      is_featured: media.is_featured || false,
      created_at: media.created_at,
    };
  }

  async updateMedia(params: UpdateMediaParams): Promise<MediaItem> {
    const { bizcardId, userId, mediaId, updates, file, ip, userAgent } = params;

    const bizcard = await prisma.bizcard.findFirst({
      where: {
        bizcard_id: BigInt(bizcardId),
        user_id: BigInt(userId),
        deactivated_flag: false,
      },
      select: { bizcard_id: true, bizcard_name: true },
    });

    if (!bizcard) {
      throw createNotFoundError("Bizcard", String(bizcardId), this.requestId);
    }

    const existingMedia = await prisma.media.findFirst({
      where: {
        media_id: BigInt(mediaId),
        user_id: BigInt(userId),
        related_type: "gallery",
        related_id: BigInt(bizcardId),
        is_active: true,
        deleted_at: null,
      },
      select: {
        media_id: true,
        file_url: true,
        file_name: true,
        cloudinary_public_id: true,
        mime_type: true,
        size: true,
        width: true,
        height: true,
        display_order: true,
        is_featured: true,
        created_at: true,
        title: true,
        description: true,
        metadata: true,
      },
    });

    if (!existingMedia) {
      throw createNotFoundError("Media", String(mediaId), this.requestId);
    }

    const updateData: Record<string, unknown> = {
      updated_at: new Date(),
    };

    if (updates.title !== undefined) {
      updateData.title = validateTitle(updates.title);
    }
    if (updates.description !== undefined) {
      updateData.description = validateDescription(updates.description);
    }
    // Media has no alt_text column — persist in metadata JSON only.
    if (updates.alt_text !== undefined) {
      let meta: Record<string, unknown> = {};
      try {
        const parsed: unknown = existingMedia.metadata
          ? JSON.parse(existingMedia.metadata)
          : {};
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          meta = parsed as Record<string, unknown>;
        }
      } catch {
        meta = {};
      }
      meta.alt_text = validateAltText(updates.alt_text);
      updateData.metadata = JSON.stringify(meta);
    }
    if (updates.display_order !== undefined && typeof updates.display_order === "number" && updates.display_order >= 0) {
      updateData.display_order = updates.display_order;
      
      if (updates.display_order !== existingMedia.display_order) {
        await this.reorderMedia(bizcardId, userId, mediaId, updates.display_order);
      }
    }
    if (updates.is_featured !== undefined && typeof updates.is_featured === "boolean") {
      updateData.is_featured = updates.is_featured;
    }

    if (file) {
      const mimeType = file.mimeType.toLowerCase().split(";")[0].trim();
      const isVideo = mimeType.startsWith("video/");
      const extension = isVideo
        ? mimeType === "video/mp4" ? "mp4" : mimeType === "video/quicktime" ? "mov" : "webm"
        : mimeType === "image/jpeg" ? "jpg" : mimeType === "image/png" ? "png" : "webp";

      const titleForName =
        typeof updateData.title === "string"
          ? updateData.title
          : existingMedia.title;
      const generatedFileName = generateFileName(
        bizcardId,
        titleForName,
        file.originalName,
        extension,
      );

      const uploadResult = await uploadToR2(
        file.fileBuffer,
        mimeType,
        "portfolio",
        userId,
        undefined,
        generatedFileName,
        { width: undefined, height: undefined, duration: undefined },
      );

      updateData.file_name = generatedFileName;
      updateData.original_filename = file.originalName;
      updateData.file_url = uploadResult.url;
      updateData.cloudinary_public_id = uploadResult.key;
      updateData.mime_type = mimeType;
      updateData.size = BigInt(uploadResult.bytes);
      updateData.width = uploadResult.width ?? null;
      updateData.height = uploadResult.height ?? null;
      updateData.media_type = isVideo ? "video" : "image";
      updateData.storage_provider = "r2";

      let meta: Record<string, unknown> = {};
      try {
        const rawMeta =
          typeof updateData.metadata === "string"
            ? updateData.metadata
            : existingMedia.metadata;
        const parsed: unknown = rawMeta ? JSON.parse(String(rawMeta)) : {};
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          meta = parsed as Record<string, unknown>;
        }
      } catch {
        meta = {};
      }
      meta.replaced_by = userId;
      meta.replaced_at = new Date().toISOString();
      meta.ip_address = ip;
      meta.user_agent = userAgent;
      meta.original_name = file.originalName;
      meta.r2_key = uploadResult.key;
      meta.previous_r2_key = existingMedia.cloudinary_public_id;
      updateData.metadata = JSON.stringify(meta);

      // Best-effort cleanup of the previous R2 object after a successful upload.
      if (existingMedia.cloudinary_public_id) {
        try {
          await deleteFromR2(existingMedia.cloudinary_public_id);
        } catch {
          // Non-blocking — orphan cleanup can happen later.
        }
      }
    }

    const updated = await prisma.media.update({
      where: { media_id: BigInt(mediaId) },
      data: updateData,
      select: {
        media_id: true,
        file_url: true,
        mime_type: true,
        size: true,
        width: true,
        height: true,
        display_order: true,
        is_featured: true,
        created_at: true,
        title: true,
        description: true,
      },
    });

    return {
      id: Number(updated.media_id),
      url: updated.file_url,
      thumbnail: updated.file_url,
      title: updated.title,
      description: updated.description,
      type: updated.mime_type?.startsWith("video/") ? "video" : "image",
      mime_type: updated.mime_type || "image/jpeg",
      size: updated.size ? Number(updated.size) : 0,
      width: updated.width,
      height: updated.height,
      display_order: updated.display_order || 0,
      is_featured: updated.is_featured || false,
      created_at: updated.created_at,
    };
  }

  private async reorderMedia(bizcardId: number, userId: string, mediaId: number, newOrder: number): Promise<void> {
    const allMedia = await prisma.media.findMany({
      where: {
        user_id: BigInt(userId),
        related_type: "gallery",
        related_id: BigInt(bizcardId),
        is_active: true,
        deleted_at: null,
      },
      orderBy: [{ display_order: "asc" }, { created_at: "asc" }],
      select: { media_id: true, display_order: true },
    });

    const targetIndex = allMedia.findIndex(m => m.media_id === BigInt(mediaId));
    if (targetIndex === -1) return;

    const target = allMedia[targetIndex];
    allMedia.splice(targetIndex, 1);

    const insertAt = Math.min(Math.max(0, newOrder), allMedia.length);
    allMedia.splice(insertAt, 0, target);

    for (let i = 0; i < allMedia.length; i++) {
      if (allMedia[i].display_order !== i) {
        await prisma.media.update({
          where: { media_id: allMedia[i].media_id },
          data: { display_order: i, updated_at: new Date() },
        });
      }
    }
  }

  async deleteMedia(params: {
    bizcardId: number;
    userId: string;
    mediaId: number;
    permanent: boolean;
    ip: string;
    userAgent: string;
  }): Promise<void> {
    const { bizcardId, userId, mediaId, permanent, ip, userAgent } = params;

    const bizcard = await prisma.bizcard.findFirst({
      where: {
        bizcard_id: BigInt(bizcardId),
        user_id: BigInt(userId),
        deactivated_flag: false,
      },
      select: { bizcard_id: true },
    });

    if (!bizcard) {
      throw createNotFoundError("Bizcard", String(bizcardId), this.requestId);
    }

    const existingMedia = await prisma.media.findFirst({
      where: {
        media_id: BigInt(mediaId),
        user_id: BigInt(userId),
        related_type: "gallery",
        related_id: BigInt(bizcardId),
      },
      select: {
        media_id: true,
        cloudinary_public_id: true,
        mime_type: true,
        title: true,
        description: true,
      },
    });

    if (!existingMedia) {
      throw createNotFoundError("Media", String(mediaId), this.requestId);
    }

    if (permanent) {
      if (existingMedia.cloudinary_public_id) {
        const resourceType = existingMedia.mime_type?.startsWith("video/") ? "video" : "image";
        await deleteFromR2(existingMedia.cloudinary_public_id);
      }

      await prisma.media.delete({
        where: { media_id: BigInt(mediaId) },
      });
    } else {
      await prisma.media.update({
        where: { media_id: BigInt(mediaId) },
        data: {
          is_active: false,
          deleted_at: new Date(),
        },
      });
    }
  }

  async getPublicGallery(alias: string): Promise<{
    alias: string;
    bizcardId: number;
    gallery: Array<{
      id: number;
      url: string;
      title: string | null;
      description: string | null;
      width: number | null;
      height: number | null;
      sort_order: number;
      featured: boolean;
      mime_type: string;
    }>;
    videos: Array<{
      id: number;
      url: string;
      title: string | null;
      description: string | null;
      width: number | null;
      height: number | null;
      duration_sec: number | null;
      sort_order: number;
      featured: boolean;
      mime_type: string;
    }>;
  } | null> {
    const bizcard = await prisma.bizcard.findFirst({
      where: {
        url_alias: alias,
        deactivated_flag: false,
        user: { is: { is_active: true } },
      },
      select: {
        bizcard_id: true,
        url_alias: true,
      },
    });

    if (!bizcard) return null;

    const media = await prisma.media.findMany({
      where: {
        related_type: "gallery",
        related_id: bizcard.bizcard_id,
        is_active: true,
        deleted_at: null,
      },
      orderBy: [{ display_order: "asc" }, { created_at: "asc" }],
      select: {
        media_id: true,
        file_url: true,
        file_name: true,
        title: true,
        description: true,
        width: true,
        height: true,
        display_order: true,
        is_featured: true,
        mime_type: true,
        media_type: true,
        metadata: true,
      },
    });

    const isVideoRow = (m: {
      mime_type: string | null;
      media_type: string | null;
      file_url: string;
      file_name: string | null;
    }) => {
      if (m.media_type === "video") return true;
      if (m.mime_type?.startsWith("video/")) return true;
      const url = `${m.file_url ?? ""} ${m.file_name ?? ""}`.toLowerCase();
      return (
        url.includes(".mp4") ||
        url.includes(".mov") ||
        url.includes(".webm") ||
        url.includes(".m4v")
      );
    };

    const gallery = media
      .filter((m) => !isVideoRow(m))
      .map((m) => ({
        id: Number(m.media_id),
        url: m.file_url,
        title: m.title,
        description: m.description,
        width: m.width,
        height: m.height,
        sort_order: m.display_order || 0,
        featured: m.is_featured || false,
        mime_type: m.mime_type || "image/jpeg",
      }));

    const videos = media
      .filter((m) => isVideoRow(m))
      .map((m) => {
        let duration: number | null = null;
        if (m.metadata) {
          try {
            const parsed = JSON.parse(m.metadata);
            duration = parsed.duration || null;
          } catch {}
        }
        return {
          id: Number(m.media_id),
          url: m.file_url,
          title: m.title,
          description: m.description,
          width: m.width,
          height: m.height,
          duration_sec: duration,
          sort_order: m.display_order || 0,
          featured: m.is_featured || false,
          mime_type: m.mime_type || "video/mp4",
        };
      });

    return {
      alias: bizcard.url_alias || alias,
      bizcardId: Number(bizcard.bizcard_id),
      gallery,
      videos,
    };
  }
}