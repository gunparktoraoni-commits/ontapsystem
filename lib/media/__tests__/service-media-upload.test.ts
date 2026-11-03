import { describe, expect, it, vi } from "vitest";
import {
  applyServiceMediaUploadOutcome,
  collectUploadedServiceMedia,
  needsServiceMediaUpload,
  partitionServiceMedia,
  summarizeServiceMediaUploadFailures,
  uploadPendingServiceMedia,
  type ServiceMediaUploadDraft,
} from "../service-media-upload";

function draft(
  partial: Partial<ServiceMediaUploadDraft> & { id: string },
): ServiceMediaUploadDraft {
  return {
    url: "",
    mimeType: "image/jpeg",
    fileName: `${partial.id}.jpg`,
    dataUrl: null,
    uploadStatus: "pending",
    uploadError: null,
    ...partial,
  };
}

describe("service-media-upload helpers", () => {
  it("needsServiceMediaUpload skips already-hosted files", () => {
    expect(
      needsServiceMediaUpload(
        draft({
          id: "a",
          url: "https://cdn.example/a.jpg",
          dataUrl: null,
          uploadStatus: "uploaded",
        }),
      ),
    ).toBe(false);
  });

  it("needsServiceMediaUpload retries failed drafts that still have dataUrl", () => {
    expect(
      needsServiceMediaUpload(
        draft({
          id: "b",
          url: "",
          dataUrl: "data:image/jpeg;base64,abc",
          uploadStatus: "failed",
        }),
      ),
    ).toBe(true);
  });

  it("partitionServiceMedia separates existing from pending uploads", () => {
    const list = [
      draft({
        id: "keep",
        url: "https://cdn.example/keep.jpg",
        dataUrl: null,
        uploadStatus: "uploaded",
      }),
      draft({
        id: "new",
        dataUrl: "data:image/jpeg;base64,abc",
        uploadStatus: "pending",
      }),
      draft({
        id: "fail",
        dataUrl: "data:image/jpeg;base64,def",
        uploadStatus: "failed",
        uploadError: "timeout",
      }),
    ];
    const { existing, toUpload } = partitionServiceMedia(list);
    expect(existing.map((m) => m.id)).toEqual(["keep"]);
    expect(toUpload.map((m) => m.id)).toEqual(["new", "fail"]);
  });

  it("applyServiceMediaUploadOutcome clears dataUrl on success", () => {
    const list = [
      draft({
        id: "x",
        dataUrl: "data:image/jpeg;base64,abc",
        uploadStatus: "uploading",
      }),
    ];
    const next = applyServiceMediaUploadOutcome(list, {
      ok: true,
      id: "x",
      media: {
        id: "x",
        url: "https://cdn.example/x.jpg",
        mimeType: "image/jpeg",
        fileName: "x.jpg",
      },
    });
    expect(next[0].url).toBe("https://cdn.example/x.jpg");
    expect(next[0].dataUrl).toBeNull();
    expect(next[0].uploadStatus).toBe("uploaded");
  });

  it("uploadPendingServiceMedia only retries failed files on second pass", async () => {
    const tinyJpeg =
      "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z";

    let list: ServiceMediaUploadDraft[] = [
      draft({
        id: "ok-file",
        dataUrl: tinyJpeg,
        fileName: "ok.jpg",
        uploadStatus: "pending",
      }),
      draft({
        id: "bad-file",
        dataUrl: tinyJpeg,
        fileName: "bad.jpg",
        uploadStatus: "pending",
      }),
    ];

    const uploadFile = vi.fn(async ({ file }: { file: File }) => {
      if (file.name.includes("bad")) {
        throw new Error("R2 unavailable");
      }
      return { url: `https://cdn.example/${file.name}` };
    });

    const first = await uploadPendingServiceMedia({
      list,
      serviceId: null,
      uploadFile,
    });

    expect(first.allSucceeded).toBe(false);
    expect(uploadFile).toHaveBeenCalledTimes(2);
    expect(first.list.find((m) => m.id === "ok-file")?.uploadStatus).toBe(
      "uploaded",
    );
    expect(first.list.find((m) => m.id === "bad-file")?.uploadStatus).toBe(
      "failed",
    );
    expect(collectUploadedServiceMedia(first.list).map((m) => m.id)).toEqual([
      "ok-file",
    ]);
    expect(summarizeServiceMediaUploadFailures(first.outcomes)).toMatch(
      /failed to upload/i,
    );

    list = first.list;
    uploadFile.mockClear();
    uploadFile.mockImplementation(async ({ file }: { file: File }) => {
      return { url: `https://cdn.example/retry-${file.name}` };
    });

    const second = await uploadPendingServiceMedia({
      list,
      serviceId: 42,
      uploadFile,
    });

    expect(second.allSucceeded).toBe(true);
    // Only the previously failed file is re-uploaded.
    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(uploadFile.mock.calls[0][0].serviceId).toBe(42);
    expect(uploadFile.mock.calls[0][0].context).toBe("service");
    expect(collectUploadedServiceMedia(second.list)).toHaveLength(2);
    expect(second.list.every((m) => m.uploadStatus === "uploaded")).toBe(true);
  });

  it("mapServiceMediaFromRecord-compatible drafts stay ready for edit display", () => {
    const existing = partitionServiceMedia([
      draft({
        id: "1",
        url: "https://cdn.example/1.jpg",
        dataUrl: null,
        uploadStatus: "uploaded",
      }),
      draft({
        id: "2",
        url: "https://cdn.example/2.mp4",
        mimeType: "video/mp4",
        dataUrl: null,
        uploadStatus: "uploaded",
      }),
    ]);
    expect(existing.toUpload).toHaveLength(0);
    expect(existing.existing).toHaveLength(2);
  });
});
