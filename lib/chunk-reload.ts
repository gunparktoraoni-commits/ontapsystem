/** Session guard + cache-bust reload after stale Next.js chunk references. */
export const CHUNK_RELOAD_GUARD_KEY = "ontap:chunk-reload";

export function isChunkLoadFailure(reason: unknown): boolean {
  if (!reason) return false;
  if (reason instanceof Error) {
    if (reason.name === "ChunkLoadError") return true;
    const message = reason.message.toLowerCase();
    return (
      message.includes("loading chunk") ||
      message.includes("failed to load chunk") ||
      message.includes("chunkloaderror")
    );  
  }


  const message = String(reason).toLowerCase();
  return (
    message.includes("loading chunk") ||
    message.includes("failed to load chunk") ||
    message.includes("chunkloaderror")
  );
}

export function isNextStaticChunkTarget(target: EventTarget | null): boolean {
  if (target instanceof HTMLScriptElement) {
    return (target.src || "").includes("/_next/static/chunks/");
  }
  if (target instanceof HTMLLinkElement) {
    return (target.href || "").includes("/_next/static/chunks/");
  }
  return false;
}


/** One guarded reload per session; busts cached HTML after deploy. */
export function reloadWithChunkCacheBust(): void {
  try {
    if (sessionStorage.getItem(CHUNK_RELOAD_GUARD_KEY)) return;
    sessionStorage.setItem(CHUNK_RELOAD_GUARD_KEY, "1");
    
  } catch {
    return;
  }

  const url = new URL(window.location.href);
  url.searchParams.set("v", String(Date.now()));
  window.location.replace(url.toString());
}