"use client";

import { useCallback, useEffect, useState } from "react";
import { devApiJson } from "@/app/dev/lib/devApi";

export function useDevEndpoint<T>(path: string | null, deps: ReadonlyArray<unknown> = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!path) {
      setLoading(false);
      setError(null);
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await devApiJson<T>(path, { method: "GET" });
      if (!result.ok) {
        throw new Error(result.error ?? "Request failed.");
      }
      setData(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload, ...deps]);

  return { data, loading, error, reload, setData };
}
