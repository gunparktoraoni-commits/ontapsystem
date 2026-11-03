"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { ModalPortal } from "../ModalPortal";
import { InlineLoader } from "../Loader";
import { showToast } from "../Toast";
import { fetchImageAsDataUrl } from "@/app/lib/exportImage";
import { DigitalBizCardPreview } from "./DigitalBizCardPreview";
import type { DigitalBizCardData } from "./digitalBizCard.types";
import type { DigitalBizCardTheme } from "./digitalBizCard.theme";
import {
  defaultDigitalBizCardTheme,
} from "./digitalBizCard.theme";
import {
  exportDigitalBizCardPng,
  generateVcardQrDataUrl,
} from "./digitalBizCardCanvas";

type DigitalBizCardModalProps = {
  isOpen: boolean;
  onClose: () => void;
  data: DigitalBizCardData | null;
  theme?: DigitalBizCardTheme;
};

export function DigitalBizCardModal({
  isOpen,
  onClose,
  data,
  theme = defaultDigitalBizCardTheme(),
}: DigitalBizCardModalProps) {
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [profileDataUrl, setProfileDataUrl] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!isOpen || !data) {
      setQrDataUrl("");
      setProfileDataUrl("");
      return;
    }

    let cancelled = false;
    setPreparing(true);

    void (async () => {
      try {
        const [qr, profile] = await Promise.all([
          generateVcardQrDataUrl(data.vcardQrPayload),
          data.profileImageUrl
            ? fetchImageAsDataUrl(data.profileImageUrl)
            : Promise.resolve(""),
        ]);
        if (cancelled) return;
        setQrDataUrl(qr);
        setProfileDataUrl(profile ?? "");
      } catch (error) {
        console.error("[DigitalBizCardModal] preview prepare failed", error);
        if (!cancelled) {
          showToast("Unable to prepare your digital card preview.", "error");
        }
      } finally {
        if (!cancelled) setPreparing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [data, isOpen]);

  const handleDownload = useCallback(async () => {
    if (!data || !qrDataUrl || downloading) return;

    setDownloading(true);
    try {
      await exportDigitalBizCardPng(data, qrDataUrl, theme);
      showToast("Digital card downloaded.", "success");
    } catch (error) {
      console.error("[DigitalBizCardModal] download failed", error);
      showToast("Download failed. Please try again.", "error");
    } finally {
      setDownloading(false);
    }
  }, [data, downloading, qrDataUrl, theme]);

  return (
    <ModalPortal isOpen={isOpen} onClose={onClose}>
      <div
        className="relative mx-4 w-full max-w-4xl overflow-hidden rounded-3xl bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="digital-bizcard-modal-title"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 sm:px-6">
          <div>
            <h2
              id="digital-bizcard-modal-title"
              className="text-lg font-extrabold text-slate-900"
            >
              Digital Card Preview
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Review your card, then download the PNG when ready.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleDownload()}
              disabled={!data || !qrDataUrl || preparing || downloading}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[#2A4792]/20 bg-[#2A4792] text-white transition hover:bg-[#3B569F] disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Download digital card"
              title="Download PNG"
            >
              {downloading ? <InlineLoader /> : <Download className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close preview"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition hover:bg-slate-50"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="bg-slate-50 px-5 py-6 sm:px-8 sm:py-8">
          {preparing || !data ? (
            <div className="flex min-h-[280px] items-center justify-center">
              <InlineLoader />
            </div>
          ) : (
            <DigitalBizCardPreview
              data={data}
              qrDataUrl={qrDataUrl}
              profileDataUrl={profileDataUrl}
              theme={theme}
              className="mx-auto"
            />
          )}
        </div>
      </div>
    </ModalPortal>
  );
}

export async function sharePortfolioUrl(url: string, title: string): Promise<boolean> {
  const trimmed = url.trim();
  if (!trimmed) return false;

  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ title, url: trimmed });
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return false;
      }
    }
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(trimmed);
    return true;
  }

  return false;
}
