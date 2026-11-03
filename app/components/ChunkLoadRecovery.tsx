"use client";
import { useEffect } from "react";
import {
  CHUNK_RELOAD_GUARD_KEY,
  isChunkLoadFailure,
  isNextStaticChunkTarget,
  reloadWithChunkCacheBust,
} from "@/lib/chunk-reload";
/**
 * Recovers from stale Next.js chunk references after deployments.
 * Performs at most one cache-busting reload per browser session.
 */
export default function ChunkLoadRecovery() {
  useEffect(() => {
    const clearReloadGuard = () => {
      try {
        sessionStorage.removeItem(CHUNK_RELOAD_GUARD_KEY);
      } catch {
        // Ignore storage errors in restricted contexts.
      }
    };

    clearReloadGuard();

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (!isChunkLoadFailure(event.reason)) return;
      event.preventDefault();
      reloadWithChunkCacheBust();
    };

    const handleError = (event: ErrorEvent) => {
      if (!isNextStaticChunkTarget(event.target)) return;
      event.preventDefault();
      reloadWithChunkCacheBust();
    };

    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    window.addEventListener("error", handleError, true);

    return () => {
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
      window.removeEventListener("error", handleError, true);
    };
  }, []);

  return null;
}
