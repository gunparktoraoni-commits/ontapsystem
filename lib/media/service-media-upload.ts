/**
 * Service media upload helpers — partition drafts, track per-item status,
 * and merge successful uploads so retries only re-send failed files.
 */

export type ServiceMediaUploadStatus =
  | "ready"
  | "pending"
  | "uploading"
  | "uploaded"
  | "failed";

export type ServiceMediaUploadDraft = {
  id: string;
  url: string;
  mimeType: string | null;
  fileName: string | null;
  dataUrl: string | null;
  uploadStatus?: ServiceMediaUploadStatus;
  uploadError?: string | null;
};

export type UploadedServiceMedia = {
  id: string;
  url: string;
  mimeType: string | null;
  fileName: string | null;
};

export type ServiceMediaUploadOutcome =
  | { ok: true; id: string; media: UploadedServiceMedia }
  | { ok: false; id: string; error: string };

/** True when the draft still needs a binary upload (new or previously failed). */
export function needsServiceMediaUpload(
  media: ServiceMediaUploadDraft,
): boolean {
  if (media.uploadStatus === "failed") return Boolean(media.dataUrl);
  if (media.uploadStatus === "uploaded" && media.url && !media.dataUrl) {
    return false;
  }
  if (media.url && !media.dataUrl) return false;
  return Boolean(media.dataUrl);
}

/** Split drafts into already-hosted vs still needing upload. */
export function partitionServiceMedia(
  list: ServiceMediaUploadDraft[],
): {
  existing: UploadedServiceMedia[];
  toUpload: ServiceMediaUploadDraft[];
} {
  const existing: UploadedServiceMedia[] = [];
  const toUpload: ServiceMediaUploadDraft[] = [];

  for (const media of list) {
    if (needsServiceMediaUpload(media)) {
      toUpload.push(media);
    } else if (media.url) {
      existing.push({
        id: media.id,
        url: media.url,
        mimeType: media.mimeType,
        fileName: media.fileName,
      });
    }
  }

  return { existing, toUpload };
}

/** Apply a single upload outcome onto the draft list (keeps order). */
export function applyServiceMediaUploadOutcome(
  list: ServiceMediaUploadDraft[],
  outcome: ServiceMediaUploadOutcome,
): ServiceMediaUploadDraft[] {
  return list.map((item) => {
    if (item.id !== outcome.id) return item;
    if (outcome.ok) {
      return {
        ...item,
        url: outcome.media.url,
        mimeType: outcome.media.mimeType ?? item.mimeType,
        fileName: outcome.media.fileName ?? item.fileName,
        dataUrl: null,
        uploadStatus: "uploaded",
        uploadError: null,
      };
    }
    return {
      ...item,
      uploadStatus: "failed",
      uploadError: outcome.error,
    };
  });
}

/** Mark items about to upload as uploading (clears prior errors). */
export function markServiceMediaUploading(
  list: ServiceMediaUploadDraft[],
  ids: string[],
): ServiceMediaUploadDraft[] {
  const idSet = new Set(ids);
  return list.map((item) =>
    idSet.has(item.id)
      ? { ...item, uploadStatus: "uploading" as const, uploadError: null }
      : item,
  );
}

/** Build the final media payload after a batch (existing + successful uploads). */
export function collectUploadedServiceMedia(
  list: ServiceMediaUploadDraft[],
): UploadedServiceMedia[] {
  return list
    .filter((m) => m.url && !needsServiceMediaUpload(m))
    .map((m) => ({
      id: m.id,
      url: m.url,
      mimeType: m.mimeType,
      fileName: m.fileName,
    }));
}

export function summarizeServiceMediaUploadFailures(
  outcomes: ServiceMediaUploadOutcome[],
): string {
  const failed = outcomes.filter(
    (o): o is Extract<ServiceMediaUploadOutcome, { ok: false }> => !o.ok,
  );
  if (failed.length === 0) return "";
  const names = failed
    .slice(0, 3)
    .map((f) => f.error)
    .join(" · ");
  const more =
    failed.length > 3 ? ` · and ${failed.length - 3} more` : "";
  return `${failed.length} media file${failed.length === 1 ? "" : "s"} failed to upload. ${names}${more}`;
}

export function dataUrlToBlob(dataUrl: string): Blob | null {
  if (!dataUrl || !dataUrl.startsWith("data:")) return null;
  try {
    const parts = dataUrl.split(",");
    if (parts.length !== 2) return null;
    const mimeMatch = parts[0].match(/:(.*?);/);
    const mimeType = mimeMatch ? mimeMatch[1] : "application/octet-stream";
    const bstr = atob(parts[1]);
    const n = bstr.length;
    const u8arr = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      u8arr[i] = bstr.charCodeAt(i);
    }
    return new Blob([u8arr], { type: mimeType });
  } catch {
    return null;
  }
}

export type UploadServiceMediaFileFn = (args: {
  file: File;
  context: "service" | "portfolio";
  serviceId: number | null;
}) => Promise<{ url: string }>;

/**
 * Upload only drafts that still need upload. Successful items keep their URL;
 * failures are returned without aborting siblings.
 */
export async function uploadPendingServiceMedia(args: {
  list: ServiceMediaUploadDraft[];
  serviceId: number | null;
  uploadFile: UploadServiceMediaFileFn;
  onItemStart?: (id: string) => void;
  onItemComplete?: (outcome: ServiceMediaUploadOutcome) => void;
  onProgress?: (done: number, total: number) => void;
}): Promise<{
  list: ServiceMediaUploadDraft[];
  outcomes: ServiceMediaUploadOutcome[];
  allSucceeded: boolean;
}> {
  const { toUpload } = partitionServiceMedia(args.list);
  let nextList = markServiceMediaUploading(
    args.list,
    toUpload.map((m) => m.id),
  );
  const outcomes: ServiceMediaUploadOutcome[] = [];
  const total = toUpload.length;
  let done = 0;

  if (total === 0) {
    return { list: args.list, outcomes: [], allSucceeded: true };
  }

  const settled = await Promise.all(
    toUpload.map(async (media, index) => {
      args.onItemStart?.(media.id);
      let outcome: ServiceMediaUploadOutcome;
      try {
        const blob = dataUrlToBlob(media.dataUrl!);
        if (!blob) {
          throw new Error(`Failed to process media file ${index + 1}`);
        }
        const baseName = media.fileName || `service-media-${index + 1}`;
        const fileNameWithExt = baseName.includes(".")
          ? baseName
          : `${baseName}.${blob.type.split("/")[1] || "bin"}`;
        const file = new File([blob], fileNameWithExt, {
          type: media.mimeType || blob.type || "application/octet-stream",
        });
        const uploaded = await args.uploadFile({
          file,
          context: args.serviceId !== null ? "service" : "portfolio",
          serviceId: args.serviceId,
        });
        const url = String(uploaded.url ?? "").trim();
        if (!url) {
          throw new Error(
            `Missing public URL for media file ${index + 1} after upload.`,
          );
        }
        outcome = {
          ok: true,
          id: media.id,
          media: {
            id: media.id,
            url,
            mimeType: media.mimeType,
            fileName: media.fileName,
          },
        };
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown upload error";
        outcome = {
          ok: false,
          id: media.id,
          error: `${media.fileName || `Media ${index + 1}`}: ${message}`,
        };
      }
      done += 1;
      args.onProgress?.(done, total);
      // Notify immediately so the UI can toast/mark failure without waiting
      // for sibling uploads to finish.
      args.onItemComplete?.(outcome);
      return outcome;
    }),
  );

  for (const outcome of settled) {
    outcomes.push(outcome);
    nextList = applyServiceMediaUploadOutcome(nextList, outcome);
  }

  return {
    list: nextList,
    outcomes,
    allSucceeded: outcomes.every((o) => o.ok),
  };
}
