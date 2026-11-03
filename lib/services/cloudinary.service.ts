import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";
import { Readable } from "node:stream";
import { AppError } from "@/lib/errors/types";
import { MediaErrorCode, toErrorCode } from "@/lib/errors/media-errors";

let configured = false;

function ensureCloudinaryConfig(): void {
  if (configured) return;

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    throw new AppError(
      toErrorCode(MediaErrorCode.CLOUDINARY_CONNECTION_ERROR),
      "Cloudinary credentials are not configured",
      500,
      { cloudName: Boolean(cloudName), apiKey: Boolean(apiKey), apiSecret: Boolean(apiSecret) }
    );
  }

  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });

  configured = true;
}

export interface UploadResult {
  public_id: string;
  url: string;
  secure_url: string;
  format: string;
  width?: number;
  height?: number;
  bytes: number;
  created_at: string;
  etag: string;
  resource_type: string;
}

export class CloudinaryService {
  private readonly requestId: string;

  constructor(requestId: string) {
    this.requestId = requestId;
    ensureCloudinaryConfig();
  }

  generateFilename(bizcardName: string, fileType: string, extension: string): string {
    const sanitizedName = bizcardName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 50);

    const sanitizedType = fileType
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 20);

    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace("T", "_")
      .split(".")[0];

    const cleanExt = extension.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "jpg";
    return `${sanitizedName || "bizcard"}_${sanitizedType || "media"}_${stamp}.${cleanExt}`;
  }

  async uploadFile(args: {
    fileBuffer: Buffer;
    originalName: string;
    mimeType: string;
    bizcardName: string;
    fileCategory: string;
    folder?: string;
  }): Promise<UploadResult> {
    const extension = args.originalName.split(".").pop()?.toLowerCase() || "jpg";
    const fileType = args.fileCategory || (args.mimeType.startsWith("video/") ? "video" : "image");
    const generatedName = this.generateFilename(args.bizcardName, fileType, extension);

    const result = await new Promise<UploadApiResponse>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: args.folder ?? "bizcards/gallery",
          resource_type: args.mimeType.startsWith("video/") ? "video" : "image",
          public_id: generatedName,
          overwrite: false,
          invalidate: true,
          tags: ["bizcard_gallery", `type_${fileType}`],
          transformation: args.mimeType.startsWith("video/")
            ? undefined
            : [{ quality: "auto" }, { fetch_format: "auto" }],
        },
        (error, value) => {
          if (error || !value) {
            reject(
              new AppError(
                toErrorCode(MediaErrorCode.CLOUDINARY_UPLOAD_FAILED),
                `Cloudinary upload failed: ${error?.message ?? "Unknown error"}`,
                500,
                {
                  originalName: args.originalName,
                  mimeType: args.mimeType,
                  generatedName,
                  cloudinaryError: error?.message,
                },
                this.requestId
              )
            );
            return;
          }
          resolve(value);
        }
      );

      const readable = new Readable();
      readable.push(args.fileBuffer);
      readable.push(null);
      readable.pipe(stream);
    });

    return {
      public_id: result.public_id,
      url: result.url,
      secure_url: result.secure_url,
      format: result.format,
      width: result.width,
      height: result.height,
      bytes: result.bytes,
      created_at: result.created_at,
      etag: result.etag,
      resource_type: result.resource_type,
    };
  }

  async deleteFile(publicId: string, resourceType: "image" | "video" | "raw" = "image"): Promise<boolean> {
    try {
      const result = await cloudinary.uploader.destroy(publicId, {
        resource_type: resourceType,
        invalidate: true,
      });

      if (result.result !== "ok" && result.result !== "not found") {
        throw new AppError(
          toErrorCode(MediaErrorCode.CLOUDINARY_DELETE_FAILED),
          `Cloudinary delete failed: ${result.result}`,
          500,
          { publicId, result: result.result },
          this.requestId
        );
      }

      return true;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        toErrorCode(MediaErrorCode.CLOUDINARY_DELETE_FAILED),
        `Cloudinary delete failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        500,
        { publicId, resourceType },
        this.requestId
      );
    }
  }
}
