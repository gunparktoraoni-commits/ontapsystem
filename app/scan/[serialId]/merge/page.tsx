"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FullPageLoader, InlineLoader } from "@/app/components/Loader";
import { csrfClient } from "@/lib/csrf-client";
import { fetchPhysicalCardScan, resolvePortfolioHref } from "@/lib/bizcard/scan-session";
import type { PhysicalCardScanResult } from "@/lib/bizcard/scan-routing";
import {
  buildClaimCreateSeparatePath,
  buildClaimSignupPath,
  classifyBlankCardNextAction,
  extractClaimSerial,
  persistClaimSerial,
} from "@/lib/bizcard/claim-urls";

/**
 * Authenticated blank-card claim: merge serial onto a virtual BizCard that has
 * no serial_id yet, or create a separate BizCard and attach the serial after setup.
 */
export default function ScanMergePage({ params }: { params: Promise<{ serialId: string }> }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [serialId, setSerialId] = useState("");
  const [scanData, setScanData] = useState<PhysicalCardScanResult | null>(null);
  const [selectedVirtualId, setSelectedVirtualId] = useState("");
  const [loading, setLoading] = useState(true);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryVirtualId = searchParams.get("virtualId") ?? "";

  useEffect(() => {
    let cancelled = false;
    void params.then((resolved) => {
      const serial = extractClaimSerial(resolved.serialId) ?? resolved.serialId.trim().toUpperCase();
      if (!cancelled) {
        setSerialId(serial);
        persistClaimSerial(serial);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [params]);

  useEffect(() => {
    if (!serialId) return;
    let cancelled = false;

    async function loadScan() {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchPhysicalCardScan(serialId);
        if (!result.ok) {
          throw new Error(result.message);
        }
        if (cancelled) return;

        const data = result.data;
        setScanData(data);

        const routeKind = classifyBlankCardNextAction(data.nextAction);

        // Soft redirect with replace so iOS Safari / Android Chrome don't leave
        // a stale merge page in history after signup/create-separate bounce.
        if (routeKind === "signup") {
          window.location.replace(data.redirectUrl || buildClaimSignupPath(serialId));
          return;
        }

        if (routeKind === "create_separate") {
          window.location.replace(data.redirectUrl || buildClaimCreateSeparatePath(serialId));
          return;
        }

        if (routeKind === "show_portfolio" && data.redirectUrl) {
          window.location.replace(resolvePortfolioHref(data.redirectUrl));
          return;
        }

        const initial = queryVirtualId || data.virtualCards[0]?.id || "";
        setSelectedVirtualId(initial);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unable to load card details.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadScan();
    return () => {
      cancelled = true;
    };
  }, [serialId, queryVirtualId]);

  const selectedCard = useMemo(
    () => scanData?.virtualCards.find((card) => card.id === selectedVirtualId) ?? null,
    [scanData, selectedVirtualId],
  );

  const handleMerge = useCallback(async () => {
    if (!serialId || !selectedVirtualId) return;
    setMerging(true);
    setError(null);
    try {
      const fetchOpts = await csrfClient.getFetchOptions("POST", {
        serialId,
        virtualCardId: selectedVirtualId,
      });
      const response = await fetch("/api/bizcard/merge", {
        ...fetchOpts,
        credentials: "include",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error?.message ?? "Merge failed. Please try again.");
      }

      const alias = String(payload?.data?.bizcard?.urlAlias ?? "").trim();
      if (alias) {
        router.push(
          `/scan/${encodeURIComponent(serialId)}/merge/success?alias=${encodeURIComponent(alias)}`,
        );
        return;
      }

      const portfolioUrl = String(payload?.data?.bizcard?.portfolioUrl ?? "").trim();
      if (portfolioUrl) {
        window.location.href = resolvePortfolioHref(portfolioUrl);
        return;
      }

      router.push("/user/bizcard-list");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Merge failed. Please try again.");
    } finally {
      setMerging(false);
    }
  }, [router, selectedVirtualId, serialId]);

  const handleCreateSeparate = useCallback(() => {
    // Full navigation keeps serial in the address bar on iOS WKWebView / Chrome.
    window.location.assign(buildClaimCreateSeparatePath(serialId));
  }, [serialId]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <FullPageLoader />
      </div>
    );
  }

  if (error && !scanData) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="max-w-md rounded-2xl border border-rose-200 bg-white p-6 text-center shadow-sm">
          <p className="text-sm text-rose-700">{error}</p>
          <Link href="/" className="mt-4 inline-block text-sm font-semibold text-primary">
            Go home
          </Link>
        </div>
      </div>
    );
  }

  if (!scanData || scanData.status !== "blank" || scanData.virtualCards.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">No merge options available</h1>
          <p className="mt-2 text-sm text-slate-600">
            This physical card cannot be merged right now. You can create a separate BizCard instead.
          </p>
          <button
            type="button"
            onClick={handleCreateSeparate}
            className="mt-4 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white"
          >
            Create a separate BizCard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-2xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
          Physical card detected
        </p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Link card {serialId}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {scanData.isPlaceholder
            ? "This blank BizCard is ready to be claimed."
            : "This physical BizCard is unassigned."}{" "}
          Merge the serial onto an existing virtual BizCard that has no serial yet, or create a
          separate BizCard registration.
        </p>

        <div className="mt-6 space-y-3">
          {scanData.virtualCards.map((card) => (
            <label
              key={card.id}
              className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition ${
                selectedVirtualId === card.id
                  ? "border-primary bg-primary/5"
                  : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <input
                type="radio"
                name="virtualCard"
                value={card.id}
                checked={selectedVirtualId === card.id}
                onChange={() => setSelectedVirtualId(card.id)}
                className="mt-1"
              />
              <div>
                <p className="font-semibold text-slate-900">{card.name || card.fullName}</p>
                {card.title ? <p className="text-sm text-slate-500">{card.title}</p> : null}
                <p className="mt-1 text-xs text-slate-400">
                  Created {new Date(card.createdAt).toLocaleDateString()}
                </p>
              </div>
            </label>
          ))}
        </div>

        {error ? <p className="mt-4 text-sm text-rose-600">{error}</p> : null}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => void handleMerge()}
            disabled={!selectedCard || merging}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {merging ? <InlineLoader /> : null}
            Merge with selected virtual card
          </button>
          <button
            type="button"
            onClick={handleCreateSeparate}
            disabled={merging}
            className="inline-flex flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
          >
            Create a separate BizCard
          </button>
        </div>

        {selectedCard ? (
          <p className="mt-4 text-xs text-slate-500">
            Merging keeps all information from{" "}
            <strong>{selectedCard.name || selectedCard.fullName}</strong>, assigns serial{" "}
            <strong>{serialId}</strong> to that virtual BizCard, and removes the blank card record.
            Future QR/NFC scans will open that portfolio.
          </p>
        ) : null}
      </div>
    </div>
  );
}
