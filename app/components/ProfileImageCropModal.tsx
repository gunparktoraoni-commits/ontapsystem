"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, ZoomIn, ZoomOut, X } from "lucide-react";
import { ModalPortal } from "@/app/components/ModalPortal";
import { CropPreviewImage } from "./CropPreviewImage";
import { createCroppedImageDataUrl, dataUrlToBlob } from "./BizCardShared";

const CROP_FRAME_SIZE = 256;

export function ProfileImageCropModal({
  file,
  title = "Crop Profile Photo",
  onClose,
  onApply,
}: {
  file: File | null;
  title?: string;
  onClose: () => void;
  onApply: (croppedFile: File) => Promise<void>;
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  useEffect(() => {
    if (!file) {
      setImageUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setError(null);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const handleApply = async () => {
    if (!imageUrl || !file || saving) return;
    setSaving(true);
    setError(null);
    try {
      const cropped = await createCroppedImageDataUrl(imageUrl, {
        aspectRatio: 1,
        frameWidth: CROP_FRAME_SIZE,
        frameHeight: CROP_FRAME_SIZE,
        zoom,
        offsetX: offset.x,
        offsetY: offset.y,
        outputWidth: 400,
        outputHeight: 400,
        mimeType: "image/jpeg",
        quality: 0.9,
      });
      const croppedFile = new File(
        [dataUrlToBlob(cropped)],
        `${file.name.replace(/\.[^.]+$/, "") || "profile"}-cropped.jpg`,
        { type: "image/jpeg" },
      );
      await onApply(croppedFile);
      onClose();
    } catch (applyError) {
      setError(
        applyError instanceof Error
          ? applyError.message
          : "Unable to crop this image. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || saving) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y,
    };
    setDragging(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setOffset({
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    setDragging(false);
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    setZoom((current) =>
      Math.min(3, Math.max(0.5, current + (event.deltaY < 0 ? 0.1 : -0.1))),
    );
  };

  return (
    <ModalPortal isOpen={Boolean(file)} onClose={saving ? undefined : onClose}>
      <div className="w-[min(32rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h2 className="text-lg font-bold text-gray-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close crop dialog"
            className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-100 disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="bg-gray-50 p-5 sm:p-6">
          <div
            className={`relative mx-auto h-64 w-64 overflow-hidden rounded-full border-4 border-white bg-white shadow-lg touch-none ${
              dragging ? "cursor-grabbing" : "cursor-grab"
            }`}
            onWheel={handleWheel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            {imageUrl && (
              <CropPreviewImage
                src={imageUrl}
                zoom={zoom}
                offsetX={offset.x}
                offsetY={offset.y}
                frameWidth={CROP_FRAME_SIZE}
                frameHeight={CROP_FRAME_SIZE}
              />
            )}
            <div className="pointer-events-none absolute inset-0 rounded-full border-2 border-primary/30" />
          </div>

          <div className="mt-5 flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={() => setZoom((current) => Math.max(0.5, current - 0.1))}
              disabled={zoom <= 0.5 || saving}
              aria-label="Zoom out"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:opacity-40"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <span className="min-w-12 text-center text-sm font-medium text-gray-600">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom((current) => Math.min(3, current + 0.1))}
              disabled={zoom >= 3 || saving}
              aria-label="Zoom in"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:opacity-40"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-4 text-center text-xs text-gray-500">
            Drag to reposition. Scroll or use the buttons to zoom.
          </p>
          {error && (
            <p className="mt-3 text-center text-sm text-red-600" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="min-h-10 rounded-xl border border-gray-200 px-4 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleApply()}
            disabled={!imageUrl || saving}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#2D3A8C] px-4 text-sm font-semibold text-white transition hover:bg-[#243080] disabled:cursor-wait disabled:opacity-60"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? "Applying..." : "Apply Crop"}
          </button>
        </div>
      </div>
    </ModalPortal>
  );
}
