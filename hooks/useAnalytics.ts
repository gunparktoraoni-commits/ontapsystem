// hooks/useAnalytics.ts
import { useState, useEffect, useCallback } from "react";
import { AnalyticsResponse } from "@/types/analytics";

const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ||
  process.env.NEXT_PUBLIC_API_URL?.trim() ||
  ""
).replace(/\/+$/, "");

interface UseAnalyticsOptions {
  filter?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

export function useAnalytics(options: UseAnalyticsOptions = {}) {
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Build query parameters
      const params = new URLSearchParams();
      // Filter parameter (required by API)
      const filter = options.filter || "last_30_days";
      params.append("filter", filter);
      // Optional parameters
      if (options.startDate) params.append("startDate", options.startDate);
      if (options.endDate) params.append("endDate", options.endDate);
      if (options.page) params.append("page", options.page.toString());
      if (options.limit) params.append("limit", options.limit.toString());
      const url = `${API_BASE_URL}/api/analytics?${params.toString()}`;
      console.log("[Analytics] Fetching URL:", url);

      const response = await fetch(url, {
        method: "GET",
        credentials: "include", // CRITICAL: sends session cookie
        headers: {
          "Content-Type": "application/json",
        },
      });

      console.log("[Analytics] Response status:", response.status);

      // Handle 401 Unauthorized
      if (response.status === 401) {
        throw new Error("Session expired. Please log in again.");
      }
      // Handle 429 Rate Limit
      if (response.status === 429) {
        throw new Error("Too many requests. Please slow down.");
      }

      // Handle 422 Validation Error
      if (response.status === 422) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Invalid date parameters.");
      }

      if (!response.ok) {
        throw new Error(`Failed to fetch analytics: ${response.status}`);
      }

      const result: AnalyticsResponse = await response.json();
      console.log("[Analytics] Response data:", result);
      // Check if the response has the expected structure
      if (!result.success) {
        throw new Error(result.error || "Failed to load analytics data");
      }
      setData(result);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "An unexpected error occurred";
      console.error("[Analytics] Error:", errorMessage);
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [options.filter, options.startDate, options.endDate, options.page, options.limit]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  return { data, loading, error, refetch: fetchAnalytics };
}