import { prisma } from "@/server/lib/prisma";
import {
  EXPERIENCE_SURVEY_SUBMITTED,
  isExperienceSurveyFeatureStatus,
  isExperienceSurveyReviewStatus,
} from "@/lib/portal/experience-survey";

const SUBMITTED_WHERE = { status: EXPERIENCE_SURVEY_SUBMITTED } as const;

export type SerializedFeedbackRow = {
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

type UserSelect = {
  user_id: bigint;
  first_name: string;
  last_name: string;
  email: string;
};

type SurveyWithUser = {
  survey_id: bigint;
  user_id: bigint;
  rating: number | null;
  feedback: string | null;
  feature_suggestion: string | null;
  review_status: string | null;
  feature_request_status: string | null;
  created_at: Date;
  updated_at: Date;
  user: UserSelect;
};

function toBigIntId(value: string | number | bigint): bigint {
  return typeof value === "bigint" ? value : BigInt(value);
}

function formatUserName(user: Pick<UserSelect, "first_name" | "last_name">): string {
  const full = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return full || "User";
}

function startOfCurrentMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function parseOptionalDate(value: string | undefined | null): Date | null {
  if (!value?.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function serializeSurveyRow(row: SurveyWithUser): SerializedFeedbackRow {
  return {
    survey_id: row.survey_id.toString(),
    user_id: row.user_id.toString(),
    user_name: formatUserName(row.user),
    user_email: row.user.email,
    rating: row.rating,
    feedback: row.feedback,
    feature_suggestion: row.feature_suggestion,
    review_status: row.review_status,
    feature_request_status: row.feature_request_status,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

const userSelect = {
  user_id: true,
  first_name: true,
  last_name: true,
  email: true,
} as const;

const surveyInclude = {
  user: { select: userSelect },
} as const;

function buildPagination(page: number, limit: number, total: number): PaginationMeta {
  const pages = Math.max(1, Math.ceil(total / limit));
  return {
    page,
    limit,
    total,
    pages,
    has_next: page < pages,
    has_previous: page > 1,
  };
}

function buildFeedbackSearchWhere(
  search: string | undefined,
  rating: number | undefined,
  reviewStatus: string | undefined,
  dateFrom: Date | null,
  dateTo: Date | null,
) {
  const where: Record<string, unknown> = { ...SUBMITTED_WHERE };

  if (rating != null) {
    where.rating = rating;
  }

  if (reviewStatus) {
    where.review_status = reviewStatus;
  }

  if (dateFrom || dateTo) {
    const createdAt: Record<string, Date> = {};
    if (dateFrom) createdAt.gte = dateFrom;
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      createdAt.lte = end;
    }
    where.created_at = createdAt;
  }

  const q = search?.trim();
  if (q) {
    where.OR = [
      { feedback: { contains: q } },
      { feature_suggestion: { contains: q } },
      { user: { first_name: { contains: q } } },
      { user: { last_name: { contains: q } } },
      { user: { email: { contains: q } } },
    ];
  }

  return where;
}

function buildFeatureRequestWhere(
  search: string | undefined,
  featureStatus: string | undefined,
  dateFrom: Date | null,
  dateTo: Date | null,
) {
  const where: Record<string, unknown> = {
    ...SUBMITTED_WHERE,
    feature_suggestion: { not: null },
    NOT: { feature_suggestion: "" },
  };

  if (featureStatus) {
    where.feature_request_status = featureStatus;
  }

  if (dateFrom || dateTo) {
    const createdAt: Record<string, Date> = {};
    if (dateFrom) createdAt.gte = dateFrom;
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      createdAt.lte = end;
    }
    where.created_at = createdAt;
  }

  const q = search?.trim();
  if (q) {
    where.AND = [
      {
        OR: [
          { feature_suggestion: { contains: q } },
          { feedback: { contains: q } },
          { user: { first_name: { contains: q } } },
          { user: { last_name: { contains: q } } },
          { user: { email: { contains: q } } },
        ],
      },
    ];
  }

  return where;
}

export async function getOverviewMetrics(): Promise<{
  metrics: OverviewMetrics;
  recent_feedback: SerializedFeedbackRow[];
}> {
  const monthStart = startOfCurrentMonth();

  const [
    totalFeedback,
    ratingAggregate,
    featureSuggestions,
    feedbackThisMonth,
    recentRows,
  ] = await Promise.all([
    prisma.userExperienceSurvey.count({ where: SUBMITTED_WHERE }),
    prisma.userExperienceSurvey.aggregate({
      where: { ...SUBMITTED_WHERE, rating: { not: null } },
      _avg: { rating: true },
    }),
    prisma.userExperienceSurvey.count({
      where: {
        ...SUBMITTED_WHERE,
        feature_suggestion: { not: null },
        NOT: { feature_suggestion: "" },
      },
    }),
    prisma.userExperienceSurvey.count({
      where: {
        ...SUBMITTED_WHERE,
        created_at: { gte: monthStart },
      },
    }),
    prisma.userExperienceSurvey.findMany({
      where: SUBMITTED_WHERE,
      include: surveyInclude,
      orderBy: { created_at: "desc" },
      take: 8,
    }),
  ]);

  const avg = ratingAggregate._avg.rating;

  return {
    metrics: {
      total_feedback: totalFeedback,
      average_rating: avg != null ? Math.round(avg * 10) / 10 : null,
      feature_suggestions: featureSuggestions,
      feedback_this_month: feedbackThisMonth,
    },
    recent_feedback: recentRows.map((row) => serializeSurveyRow(row as SurveyWithUser)),
  };
}

export async function listFeedback(params: {
  page?: number;
  limit?: number;
  search?: string;
  rating?: number;
  review_status?: string;
  dateFrom?: string;
  dateTo?: string;
}): Promise<{ rows: SerializedFeedbackRow[]; pagination: PaginationMeta }> {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(100, Math.max(1, params.limit ?? 20));
  const skip = (page - 1) * limit;

  const where = buildFeedbackSearchWhere(
    params.search,
    params.rating,
    params.review_status,
    parseOptionalDate(params.dateFrom),
    parseOptionalDate(params.dateTo),
  );

  const [rows, total] = await Promise.all([
    prisma.userExperienceSurvey.findMany({
      where,
      include: surveyInclude,
      orderBy: { created_at: "desc" },
      skip,
      take: limit,
    }),
    prisma.userExperienceSurvey.count({ where }),
  ]);

  return {
    rows: rows.map((row) => serializeSurveyRow(row as SurveyWithUser)),
    pagination: buildPagination(page, limit, total),
  };
}

export async function getFeedbackById(
  surveyId: string | number | bigint,
): Promise<SerializedFeedbackRow | null> {
  const row = await prisma.userExperienceSurvey.findFirst({
    where: {
      survey_id: toBigIntId(surveyId),
      status: EXPERIENCE_SURVEY_SUBMITTED,
    },
    include: surveyInclude,
  });

  if (!row) return null;
  return serializeSurveyRow(row as SurveyWithUser);
}

export async function updateFeedbackReviewStatus(
  surveyId: string | number | bigint,
  reviewStatus: string,
): Promise<SerializedFeedbackRow> {
  if (!isExperienceSurveyReviewStatus(reviewStatus)) {
    throw new Error("Invalid review status.");
  }

  const existing = await prisma.userExperienceSurvey.findFirst({
    where: {
      survey_id: toBigIntId(surveyId),
      status: EXPERIENCE_SURVEY_SUBMITTED,
    },
  });

  if (!existing) {
    throw new Error("Feedback not found.");
  }

  const updated = await prisma.userExperienceSurvey.update({
    where: { survey_id: existing.survey_id },
    data: { review_status: reviewStatus },
    include: surveyInclude,
  });

  return serializeSurveyRow(updated as SurveyWithUser);
}

export async function listFeatureRequests(params: {
  page?: number;
  limit?: number;
  search?: string;
  feature_request_status?: string;
  dateFrom?: string;
  dateTo?: string;
}): Promise<{ rows: SerializedFeedbackRow[]; pagination: PaginationMeta }> {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(100, Math.max(1, params.limit ?? 20));
  const skip = (page - 1) * limit;

  const where = buildFeatureRequestWhere(
    params.search,
    params.feature_request_status,
    parseOptionalDate(params.dateFrom),
    parseOptionalDate(params.dateTo),
  );

  const [rows, total] = await Promise.all([
    prisma.userExperienceSurvey.findMany({
      where,
      include: surveyInclude,
      orderBy: { created_at: "desc" },
      skip,
      take: limit,
    }),
    prisma.userExperienceSurvey.count({ where }),
  ]);

  return {
    rows: rows.map((row) => serializeSurveyRow(row as SurveyWithUser)),
    pagination: buildPagination(page, limit, total),
  };
}

export async function getFeatureRequestById(
  surveyId: string | number | bigint,
): Promise<SerializedFeedbackRow | null> {
  const row = await prisma.userExperienceSurvey.findFirst({
    where: {
      survey_id: toBigIntId(surveyId),
      status: EXPERIENCE_SURVEY_SUBMITTED,
      feature_suggestion: { not: null },
      NOT: { feature_suggestion: "" },
    },
    include: surveyInclude,
  });

  if (!row) return null;
  return serializeSurveyRow(row as SurveyWithUser);
}

export async function updateFeatureRequestStatus(
  surveyId: string | number | bigint,
  featureRequestStatus: string,
): Promise<SerializedFeedbackRow> {
  if (!isExperienceSurveyFeatureStatus(featureRequestStatus)) {
    throw new Error("Invalid feature request status.");
  }

  const existing = await prisma.userExperienceSurvey.findFirst({
    where: {
      survey_id: toBigIntId(surveyId),
      status: EXPERIENCE_SURVEY_SUBMITTED,
      feature_suggestion: { not: null },
      NOT: { feature_suggestion: "" },
    },
  });

  if (!existing) {
    throw new Error("Feature request not found.");
  }

  const updated = await prisma.userExperienceSurvey.update({
    where: { survey_id: existing.survey_id },
    data: { feature_request_status: featureRequestStatus },
    include: surveyInclude,
  });

  return serializeSurveyRow(updated as SurveyWithUser);
}
