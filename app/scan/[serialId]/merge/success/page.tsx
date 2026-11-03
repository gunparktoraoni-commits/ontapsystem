"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { InlineLoader } from "@/app/components/Loader";
import { resolvePortfolioHref } from "@/lib/bizcard/scan-session";

const REDIRECT_SECONDS = 3;

export default function MergeSuccessPage({ params }: { params: Promise<{ serialId: string }> }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [serialId, setSerialId] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(REDIRECT_SECONDS);
  const [redirecting, setRedirecting] = useState(false);

  const portfolioAlias = (searchParams.get("alias") ?? "").trim();

  const portfolioHref = useMemo(
    () => (portfolioAlias ? resolvePortfolioHref(portfolioAlias) : "/user/bizcard-list"),
    [portfolioAlias],
  );

  useEffect(() => {
    let cancelled = false;
    void params.then((resolved) => {
      if (!cancelled) setSerialId(resolved.serialId.trim().toUpperCase());
    });
    return () => {
      cancelled = true;
    };
  }, [params]);

  useEffect(() => {
    if (!portfolioAlias) return;

    const interval = window.setInterval(() => {
      setSecondsLeft((current) => Math.max(0, current - 1));
    }, 1000);

    const timeout = window.setTimeout(() => {
      setRedirecting(true);
      router.replace(portfolioHref);
    }, REDIRECT_SECONDS * 1000);

    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [portfolioAlias, portfolioHref, router]);

  const handleViewNow = () => {
    setRedirecting(true);
    router.push(portfolioHref);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-lg rounded-3xl border border-emerald-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
          {redirecting ? (
            <InlineLoader />
          ) : (
            <CheckCircle2 className="h-8 w-8" aria-hidden="true" />
          )}
        </div>

        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-600">
          Merge complete
        </p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Physical card linked successfully</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          {serialId ? (
            <>
              Card <strong>{serialId}</strong> is now linked to your virtual BizCard.
            </>
          ) : (
            <>Your virtual BizCard is now linked to the physical card.</>
          )}{" "}
          Future scans will open your merged portfolio.
        </p>

        {portfolioAlias ? (
          <p className="mt-4 text-sm text-slate-500">
            {redirecting
              ? "Opening your portfolio…"
              : `Redirecting to your portfolio in ${secondsLeft}s…`}
          </p>
        ) : (
          <p className="mt-4 text-sm text-amber-700">
            Portfolio alias was not returned. You can open your BizCard list to view the merged card.
          </p>
        )}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={handleViewNow}
            disabled={!portfolioAlias || redirecting}
            className="inline-flex items-center justify-center rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            View portfolio now
          </button>
          <Link
            href="/user/bizcard-list"
            className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700"
          >
            Back to BizCards
          </Link>
        </div>
      </div>
    </div>
  );
}
