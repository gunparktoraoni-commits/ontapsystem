"use client";

import { getFrontendApiBaseUrl } from "@/app/components/apiBase";
import { csrfClient } from "@/lib/csrf-client";

const API = getFrontendApiBaseUrl();

export type FeedbackRow = {
  survey_id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  rating: number | null;
  feedback: string | null;
  feature_suggestion: string | null;
  review_status: string | null;
  feature_request_status: string | null;
  created_at: string;
  updated_at: string;
};

export type OverviewMetrics = {
  total_feedback: number;
  average_rating: number | null;
  feature_suggestions: number;
  feedback_this_month: number;
};

export type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  pages: number;
  has_next: boolean;
  has_previous: boolean;
};

type ApiError = {
  message?: string;
  code?: string;
};

function extractError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const record = payload as Record<string, unknown>;
  const error = record.error;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object" && !Array.isArray(error)) {
    const message = (error as ApiError).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

async function parseJson<T>(res: Response): Promise<T | null> {
  return (await res.json().catch(() => null)) as T | null;
}

export async function fetchOverview(): Promise<{
  metrics: OverviewMetrics;
  recent_feedback: FeedbackRow[];
}> {
  const res = await fetch(`${API}/api/superadmin/user-experience/overview`, {
    credentials: "include",
    cache: "no-store",
  });
  const payload = await parseJson<{ success?: boolean; data?: { metrics: OverviewMetrics; recent_feedback: FeedbackRow[] }; error?: ApiError }>(res);
  if (!res.ok || !payload?.success || !payload.data) {
    throw new Error(extractError(payload, "Failed to load overview."));
  }
  return payload.data;
}

export async function fetchFeedbackList(params: {
  page?: number;
  limit?: number;
  search?: string;
  rating?: number | "all";
  review_status?: string | "all";
  dateFrom?: string;
  dateTo?: string;
}): Promise<{ rows: FeedbackRow[]; pagination: PaginationMeta }> {
  const query = new URLSearchParams({
    page: String(params.page ?? 1),
    limit: String(params.limit ?? 20),
  });
  if (params.search?.trim()) query.set("search", params.search.trim());
  if (params.rating && params.rating !== "all") query.set("rating", String(params.rating));
  if (params.review_status && params.review_status !== "all") {
    query.set("review_status", params.review_status);
  }
  if (params.dateFrom?.trim()) query.set("dateFrom", params.dateFrom.trim());
  if (params.dateTo?.trim()) query.set("dateTo", params.dateTo.trim());

  const res = await fetch(`${API}/api/superadmin/user-experience/feedback?${query.toString()}`, {
    credentials: "include",
    cache: "no-store",
  });
  const payload = await parseJson<{ success?: boolean; data?: { rows: FeedbackRow[]; pagination: PaginationMeta }; error?: ApiError }>(res);
  if (!res.ok || !payload?.success || !payload.data) {
    throw new Error(extractError(payload, "Failed to load feedback."));
  }
  return payload.data;
}

export async function fetchFeedbackDetail(surveyId: string): Promise<FeedbackRow> {
  const res = await fetch(`${API}/api/superadmin/user-experience/feedback/${encodeURIComponent(surveyId)}`, {
    credentials: "include",
    cache: "no-store",
  });
  const payload = await parseJson<{ success?: boolean; data?: FeedbackRow; error?: ApiError }>(res);
  if (!res.ok || !payload?.success || !payload.data) {
    throw new Error(extractError(payload, "Failed to load feedback details."));
  }
  return payload.data;
}

export async function updateFeedbackReviewStatus(
  surveyId: string,
  reviewStatus: string,
): Promise<FeedbackRow> {
  const options = await csrfClient.getFetchOptions(
    "PATCH",
    { review_status: reviewStatus },
    false,
    API,
  );
  const res = await fetch(
    `${API}/api/superadmin/user-experience/feedback/${encodeURIComponent(surveyId)}`,
    { ...options, credentials: "include" },
  );
  const payload = await parseJson<{ success?: boolean; data?: FeedbackRow; error?: ApiError }>(res);
  if (!res.ok || !payload?.success || !payload.data) {
    throw new Error(extractError(payload, "Failed to update feedback status."));
  }
  return payload.data;
}

export async function fetchFeatureRequestsList(params: {
  page?: number;
  limit?: number;
  search?: string;
  feature_request_status?: string | "all";
  dateFrom?: string;
  dateTo?: string;
}): Promise<{ rows: FeedbackRow[]; pagination: PaginationMeta }> {
  const query = new URLSearchParams({
    page: String(params.page ?? 1),
    limit: String(params.limit ?? 20),
  });
  if (params.search?.trim()) query.set("search", params.search.trim());
  if (params.feature_request_status && params.feature_request_status !== "all") {
    query.set("feature_request_status", params.feature_request_status);
  }
  if (params.dateFrom?.trim()) query.set("dateFrom", params.dateFrom.trim());
  if (params.dateTo?.trim()) query.set("dateTo", params.dateTo.trim());

  const res = await fetch(
    `${API}/api/superadmin/user-experience/feature-requests?${query.toString()}`,
    { credentials: "include", cache: "no-store" },
  );
  const payload = await parseJson<{ success?: boolean; data?: { rows: FeedbackRow[]; pagination: PaginationMeta }; error?: ApiError }>(res);
  if (!res.ok || !payload?.success || !payload.data) {
    throw new Error(extractError(payload, "Failed to load feature requests."));
  }
  return payload.data;
}

export async function updateFeatureRequestStatus(
  surveyId: string,
  featureRequestStatus: string,
): Promise<FeedbackRow> {
  const options = await csrfClient.getFetchOptions(
    "PATCH",
    { feature_request_status: featureRequestStatus },
    false,
    API,
  );
  const res = await fetch(
    `${API}/api/superadmin/user-experience/feature-requests/${encodeURIComponent(surveyId)}`,
    { ...options, credentials: "include" },
  );
  const payload = await parseJson<{ success?: boolean; data?: FeedbackRow; error?: ApiError }>(res);
  if (!res.ok || !payload?.success || !payload.data) {
    throw new Error(extractError(payload, "Failed to update feature request status."));
  }
  return payload.data;
}
