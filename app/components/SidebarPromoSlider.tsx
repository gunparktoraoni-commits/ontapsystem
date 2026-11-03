"use client";

/**
 * SidebarPromoSlider
 *
 * Displays a compact auto-advancing carousel of active promotions created by the superadmin.
 * Renders nothing when there are no active promos — keeps the sidebar clean.
 *
 * Data source: GET /api/public/sidebar-promos
 * Clicking a slide navigates to redirect_path when defined, otherwise does nothing.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Tag } from "lucide-react";
import { getFrontendApiBaseUrl } from "./apiBase";

const API = getFrontendApiBaseUrl();
const SLIDE_INTERVAL_MS = 4500;
const FETCH_STALE_MS = 60_000; // Re-fetch after 60 s to stay in sync with the 60 s CDN TTL

export type PromoSlide = {
  id: string;
  name: string;
  description: string | null;
  promoImg: string | null;
  redirectPath: string | null;
  promoType: string;
  discountValue: number | null;
  discountPercentage: number | null;
  expiresAt: string;
  badge: string | null;
};

type FetchState = "idle" | "loading" | "done" | "error";

function resolvePromoImg(raw: string | null): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith("/")) return `${API}${v}`;
  return v;
}

// ---------------------------------------------------------------------------
// Hook — fetches slides once on mount, then re-fetches every FETCH_STALE_MS
// ---------------------------------------------------------------------------
function useSidebarPromos(): { slides: PromoSlide[]; state: FetchState } {
  const [slides, setSlides] = useState<PromoSlide[]>([]);
  const [state, setState] = useState<FetchState>("idle");
  const lastFetchRef = useRef<number>(0);

  const fetchSlides = useCallback(async () => {
    const now = Date.now();
    if (now - lastFetchRef.current < FETCH_STALE_MS && slides.length > 0) return;

    setState("loading");
    try {
      const res = await fetch(`${API}/api/public/sidebar-promos`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setState("error");
        return;
      }
      const json = (await res.json()) as {
        success?: boolean;
        data?: { slides: PromoSlide[] };
      };
      if (json?.success && Array.isArray(json?.data?.slides)) {
        setSlides(json.data.slides);
        lastFetchRef.current = Date.now();
        setState("done");
      } else {
        setState("error");
      }
    } catch {
      setState("error");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void fetchSlides();
    const intervalId = setInterval(() => void fetchSlides(), FETCH_STALE_MS);
    return () => clearInterval(intervalId);
  }, [fetchSlides]);

  return { slides, state };
}

// ---------------------------------------------------------------------------
// Sub-component — a single slide card
// ---------------------------------------------------------------------------
function SlideCard({ slide }: { slide: PromoSlide }) {
  const imgSrc = resolvePromoImg(slide.promoImg);

  const inner = (
    <div className="relative w-full h-full overflow-hidden rounded-xl select-none">
      {/* Background image or gradient fallback */}
      {imgSrc ? (
        <>
          <img
            src={imgSrc}
            alt={slide.name}
            className="absolute inset-0 w-full h-full object-cover"
            draggable={false}
          />
          {/* Darkening overlay so text remains readable over any image */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent" />
        </>
      ) : (
        /* No image — branded gradient background */
        <div className="absolute inset-0 bg-gradient-to-br from-[#1e3a8a] via-[#1e40af] to-[#2563eb]" />
      )}

      {/* Badge pill */}
      {slide.badge && (
        <span className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-[#f59e0b] text-[#1a1a1a] text-[9px] font-extrabold tracking-wide leading-tight z-10">
          {slide.badge}
        </span>
      )}

      {/* Text content */}
      <div className="absolute bottom-0 left-0 right-0 p-3 z-10">
        <p className="text-white text-[11px] font-bold leading-tight line-clamp-1">
          {slide.name}
        </p>
        {slide.description && (
          <p className="text-white/70 text-[10px] mt-0.5 leading-tight line-clamp-2">
            {slide.description}
          </p>
        )}
        {slide.redirectPath && (
          <span className="inline-block mt-1.5 text-[9px] font-semibold text-[#7EC8F0] tracking-wide uppercase">
            Learn more →
          </span>
        )}
      </div>
    </div>
  );

  if (slide.redirectPath) {
    return (
      <Link
        href={slide.redirectPath}
        className="block w-full h-full cursor-pointer"
        tabIndex={0}
        aria-label={`View promo: ${slide.name}`}
      >
        {inner}
      </Link>
    );
  }

  return <div className="w-full h-full">{inner}</div>;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function SidebarPromoSlider() {
  const { slides, state } = useSidebarPromos();
  const [activeIndex, setActiveIndex] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset index when slide list changes
  useEffect(() => {
    setActiveIndex(0);
  }, [slides.length]);

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    if (slides.length <= 1) return;
    stopTimer();
    timerRef.current = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % slides.length);
    }, SLIDE_INTERVAL_MS);
  }, [slides.length, stopTimer]);

  useEffect(() => {
    startTimer();
    return stopTimer;
  }, [startTimer, stopTimer]);

  const goTo = useCallback(
    (index: number) => {
      setActiveIndex((index + slides.length) % slides.length);
      // Restart auto-advance so the user's manual navigation gets a full interval
      startTimer();
    },
    [slides.length, startTimer],
  );

  // Render nothing when loading failed or no promos exist
  if (state === "loading" || state === "idle") return null;
  if (slides.length === 0) return null;

  return (
    <div className="mx-3 mb-2">
      {/* Header row */}
      <div className="flex items-center justify-between mb-1.5 px-0.5">
        <div className="flex items-center gap-1">
          <Tag className="h-3 w-3 text-[#7EC8F0]" />
          <span className="text-white/50 text-[10px] font-semibold uppercase tracking-wide">
            Promos &amp; Deals
          </span>
        </div>
        {slides.length > 1 && (
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => goTo(activeIndex - 1)}
              aria-label="Previous promo"
              className="h-4.5 w-4.5 flex items-center justify-center rounded-full text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors"
            >
              <ChevronLeft className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => goTo(activeIndex + 1)}
              aria-label="Next promo"
              className="h-4.5 w-4.5 flex items-center justify-center rounded-full text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors"
            >
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>

      {/* Slide viewport */}
      <div
        className="relative h-[88px] rounded-xl overflow-hidden"
        onMouseEnter={stopTimer}
        onMouseLeave={startTimer}
      >
        {slides.map((slide, idx) => (
          <div
            key={slide.id}
            className={`absolute inset-0 transition-opacity duration-500 ${
              idx === activeIndex ? "opacity-100 z-10" : "opacity-0 z-0"
            }`}
            aria-hidden={idx !== activeIndex}
          >
            <SlideCard slide={slide} />
          </div>
        ))}
      </div>

      {/* Dot indicators — only when there are multiple slides */}
      {slides.length > 1 && (
        <div className="flex items-center justify-center gap-1 mt-1.5">
          {slides.map((slide, idx) => (
            <button
              key={slide.id}
              type="button"
              onClick={() => goTo(idx)}
              aria-label={`Go to slide ${idx + 1}`}
              className={`rounded-full transition-all duration-300 ${
                idx === activeIndex
                  ? "w-4 h-1.5 bg-[#7EC8F0]"
                  : "w-1.5 h-1.5 bg-white/25 hover:bg-white/45"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
