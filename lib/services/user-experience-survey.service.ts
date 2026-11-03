import { prisma } from "@/server/lib/prisma";
import {
  EXPERIENCE_SURVEY_DISMISSED,
  EXPERIENCE_SURVEY_FEATURE_MAX_LENGTH,
  EXPERIENCE_SURVEY_FEATURE_STATUS_NEW,
  EXPERIENCE_SURVEY_FEEDBACK_MAX_LENGTH,
  EXPERIENCE_SURVEY_REVIEW_NEW,
  EXPERIENCE_SURVEY_SUBMITTED,
} from "@/lib/portal/experience-survey";

export {
  EXPERIENCE_SURVEY_DISMISSED,
  EXPERIENCE_SURVEY_FEATURE_MAX_LENGTH,
  EXPERIENCE_SURVEY_FEEDBACK_MAX_LENGTH,
  EXPERIENCE_SURVEY_SUBMITTED,
} from "@/lib/portal/experience-survey";

export type ExperienceSurveyEligibility = {
  eligible: boolean;
  reason: "eligible" | "already_submitted" | "already_dismissed";
  status: string | null;
};

export type ExperienceSurveySubmitInput = {
  rating: number;
  feedback?: string | null;
  featureSuggestion?: string | null;
};

function toBigInt(userId: string | number | bigint): bigint {
  return typeof userId === "bigint" ? userId : BigInt(userId);
}

function normalizeOptionalText(
  value: unknown,
  maxLength: number,
): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

export async function getExperienceSurveyEligibility(
  userId: string | number | bigint,
): Promise<ExperienceSurveyEligibility> {
  const record = await prisma.userExperienceSurvey.findUnique({
    where: { user_id: toBigInt(userId) },
    select: { status: true },
  });

  if (!record) {
    return { eligible: true, reason: "eligible", status: null };
  }

  if (record.status === EXPERIENCE_SURVEY_SUBMITTED) {
    return {
      eligible: false,
      reason: "already_submitted",
      status: record.status,
    };
  }

  if (record.status === EXPERIENCE_SURVEY_DISMISSED) {
    return {
      eligible: false,
      reason: "already_dismissed",
      status: record.status,
    };
  }

  return { eligible: true, reason: "eligible", status: record.status };
}

export async function submitExperienceSurvey(
  userId: string | number | bigint,
  input: ExperienceSurveySubmitInput,
): Promise<{ status: typeof EXPERIENCE_SURVEY_SUBMITTED }> {
  const rating = Number(input.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new Error("rating must be an integer between 1 and 5.");
  }

  const feedback = normalizeOptionalText(
    input.feedback,
    EXPERIENCE_SURVEY_FEEDBACK_MAX_LENGTH,
  );
  const featureSuggestion = normalizeOptionalText(
    input.featureSuggestion,
    EXPERIENCE_SURVEY_FEATURE_MAX_LENGTH,
  );

  const uid = toBigInt(userId);
  const existing = await prisma.userExperienceSurvey.findUnique({
    where: { user_id: uid },
    select: { status: true },
  });

  if (existing?.status === EXPERIENCE_SURVEY_SUBMITTED) {
    throw new Error("Experience survey already submitted.");
  }

  const submitData = {
    status: EXPERIENCE_SURVEY_SUBMITTED,
    rating,
    feedback,
    feature_suggestion: featureSuggestion,
    review_status: EXPERIENCE_SURVEY_REVIEW_NEW,
    feature_request_status: featureSuggestion
      ? EXPERIENCE_SURVEY_FEATURE_STATUS_NEW
      : null,
  };

  if (existing) {
    await prisma.userExperienceSurvey.update({
      where: { user_id: uid },
      data: submitData,
    });
  } else {
    await prisma.userExperienceSurvey.create({
      data: {
        user_id: uid,
        ...submitData,
      },
    });
  }

  return { status: EXPERIENCE_SURVEY_SUBMITTED };
}

export async function dismissExperienceSurvey(
  userId: string | number | bigint,
): Promise<{ status: typeof EXPERIENCE_SURVEY_DISMISSED }> {
  const uid = toBigInt(userId);
  const existing = await prisma.userExperienceSurvey.findUnique({
    where: { user_id: uid },
    select: { status: true },
  });

  if (existing?.status === EXPERIENCE_SURVEY_SUBMITTED) {
    throw new Error("Experience survey already submitted.");
  }

  if (existing?.status === EXPERIENCE_SURVEY_DISMISSED) {
    return { status: EXPERIENCE_SURVEY_DISMISSED };
  }

  if (existing) {
    await prisma.userExperienceSurvey.update({
      where: { user_id: uid },
      data: { status: EXPERIENCE_SURVEY_DISMISSED },
    });
  } else {
    await prisma.userExperienceSurvey.create({
      data: {
        user_id: uid,
        status: EXPERIENCE_SURVEY_DISMISSED,
      },
    });
  }

  return { status: EXPERIENCE_SURVEY_DISMISSED };
}
