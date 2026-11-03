"use client";

import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { Eye, MapPin, RefreshCw, X } from "lucide-react";
import { ModalPortal } from "./ModalPortal";
import { InlineLoader } from "./Loader";
import { toServableMediaSrc } from "../lib/portfolioDisplay";
import { buildImpersonationHeaders } from "@/app/lib/superadminImpersonationHandoff";

const POLL_INTERVAL_MS = 10_000;
const ACCENT = "#2A4792";

type ProfileViewer = {
  viewerId: string | null;
  isAnonymous?: boolean;
  firstName: string;
  lastName: string;
  profileUrl: string | null;
  customUri: string | null;
  location?: string | null;
  viewCount?: number;
  viewedAt: string;
  timeAgo: string;
};

type ProfileViewsResponse = {
  viewers: ProfileViewer[];
  pagination: {
    page: number;
    limit: number;
    totalItems: number;
    totalPages: number;
  };
};

function getInitials(firstName: string, lastName: string): string {
  const a = (firstName || "").trim().charAt(0);
  const b = (lastName || "").trim().charAt(0);
  const initials = `${a}${b}`.toUpperCase();
  return initials || "?";
}

function ViewerAvatar({
  name,
  profileUrl,
}: {
  name: string;
  profileUrl: string | null;
}) {
  const src = profileUrl ? toServableMediaSrc(profileUrl) : null;
  if (src) {
    return (
      <img
        src={src}
        alt=""
        width={40}
        height={40}
        className="h-10 w-10 shrink-0 rounded-full object-cover border border-gray-100 bg-white"
        draggable={false}
        decoding="async"
      />
    );
  }
  return (
    <div
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
      style={{ backgroundColor: ACCENT }}
      aria-hidden
    >
      {name}
    </div>
  );
}

type ProfileViewsModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export default function ProfileViewsModal({ isOpen, onClose }: ProfileViewsModalProps) {
  const titleId = useId();
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const [viewers, setViewers] = useState<ProfileViewer[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedOnce = useRef(false);

  const fetchViewers = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    if (silent) {
      setRefreshing(true);
    } else if (!hasLoadedOnce.current) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    setError(null);

    try {
      const res = await fetch("/api/dashboard/profile-views?page=1&limit=20", {
        method: "GET",
        credentials: "include",
        headers: {
          ...buildImpersonationHeaders(),
        },
      });

      if (res.status === 401) {
        setError("Please sign in again to view your profile visitors.");
        setViewers([]);
        setTotalItems(0);
        return;
      }

      if (!res.ok) {
        setError("Unable to load profile viewers. Please try again.");
        return;
      }

      const data = (await res.json()) as ProfileViewsResponse;
      setViewers(Array.isArray(data.viewers) ? data.viewers : []);
      setTotalItems(Number(data.pagination?.totalItems ?? 0));
      hasLoadedOnce.current = true;
    } catch {
      setError("Unable to load profile viewers. Please try again.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      hasLoadedOnce.current = false;
      setViewers([]);
      setTotalItems(0);
      setError(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    void fetchViewers();

    const intervalId = window.setInterval(() => {
      void fetchViewers({ silent: true });
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isOpen, fetchViewers]);

  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    // Focus close button for keyboard users when modal opens
    closeBtnRef.current?.focus();

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, onClose]);

  return (
    <ModalPortal isOpen={isOpen} onClose={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex w-[min(100vw-1.5rem,28rem)] max-h-[min(90vh,36rem)] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2">
              <div
                className="flex h-8 w-8 items-center justify-center rounded-lg"
                style={{ backgroundColor: `${ACCENT}14` }}
              >
                <Eye className="h-4 w-4" style={{ color: ACCENT }} aria-hidden />
              </div>
              <h2 id={titleId} className="text-lg font-bold text-gray-900">
                Who viewed your profile
              </h2>
            </div>
            {!loading && !error && (
              <p className="text-xs font-medium text-gray-400">
                {totalItems === 0
                  ? "No views yet"
                  : `${totalItems} viewer${totalItems === 1 ? "" : "s"}`}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => void fetchViewers({ silent: true })}
              disabled={loading || refreshing}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-800 disabled:opacity-50"
              aria-label="Refresh viewers list"
              title="Refresh"
            >
              <RefreshCw
                className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
                aria-hidden
              />
            </button>
            <button
              ref={closeBtnRef}
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-800"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {loading ? (
            <div className="flex items-center justify-center py-14">
              <InlineLoader />
            </div>
          ) : error ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm font-medium text-rose-600">{error}</p>
              <button
                type="button"
                onClick={() => void fetchViewers()}
                className="mt-3 text-sm font-semibold underline-offset-2 hover:underline"
                style={{ color: ACCENT }}
              >
                Try again
              </button>
            </div>
          ) : viewers.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <div
                className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full"
                style={{ backgroundColor: `${ACCENT}14` }}
              >
                <Eye className="h-5 w-5" style={{ color: ACCENT }} aria-hidden />
              </div>
              <p className="text-sm font-semibold text-gray-800">No views yet.</p>
              <p className="mt-1 text-xs text-gray-500">
                Logged-in visitors and guests who scan or open your portfolio will appear here.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-50">
              {viewers.map((viewer) => {
                const fullName = viewer.isAnonymous
                  ? "Guest visitor"
                  : `${viewer.firstName ?? ""} ${viewer.lastName ?? ""}`.trim() ||
                    "Unknown viewer";
                const count = viewer.viewCount ?? 1;
                return (
                  <li
                    key={`${viewer.viewerId ?? "anon"}-${viewer.viewedAt}`}
                    className="flex items-center gap-3 px-3 py-3"
                  >
                    <ViewerAvatar
                      name={getInitials(viewer.firstName, viewer.lastName)}
                      profileUrl={viewer.profileUrl}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-gray-900">
                        {fullName}
                      </p>
                      <p className="text-xs text-gray-400">
                        Viewed {count} time{count === 1 ? "" : "s"} · {viewer.timeAgo}
                      </p>
                      {viewer.isAnonymous && (
                        <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-gray-500">
                          <MapPin className="h-3 w-3" />
                          {viewer.location || "Location unavailable"}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </ModalPortal>
  );
}
