export const EXPERIENCE_SURVEY_SUBMITTED = "submitted";
export const EXPERIENCE_SURVEY_DISMISSED = "dismissed";

export const EXPERIENCE_SURVEY_FEEDBACK_MAX_LENGTH = 2000;
export const EXPERIENCE_SURVEY_FEATURE_MAX_LENGTH = 2000;

export const EXPERIENCE_SURVEY_REVIEW_NEW = "new";
export const EXPERIENCE_SURVEY_REVIEW_REVIEWED = "reviewed";

export const EXPERIENCE_SURVEY_FEATURE_STATUS_NEW = "new";
export const EXPERIENCE_SURVEY_FEATURE_STATUS_UNDER_REVIEW = "under_review";
export const EXPERIENCE_SURVEY_FEATURE_STATUS_PLANNED = "planned";
export const EXPERIENCE_SURVEY_FEATURE_STATUS_IN_DEVELOPMENT = "in_development";
export const EXPERIENCE_SURVEY_FEATURE_STATUS_RELEASED = "released";

export const EXPERIENCE_SURVEY_REVIEW_STATUSES = [
  EXPERIENCE_SURVEY_REVIEW_NEW,
  EXPERIENCE_SURVEY_REVIEW_REVIEWED,
] as const;

export const EXPERIENCE_SURVEY_FEATURE_STATUSES = [
  EXPERIENCE_SURVEY_FEATURE_STATUS_NEW,
  EXPERIENCE_SURVEY_FEATURE_STATUS_UNDER_REVIEW,
  EXPERIENCE_SURVEY_FEATURE_STATUS_PLANNED,
  EXPERIENCE_SURVEY_FEATURE_STATUS_IN_DEVELOPMENT,
  EXPERIENCE_SURVEY_FEATURE_STATUS_RELEASED,
] as const;

export type ExperienceSurveyReviewStatus =
  (typeof EXPERIENCE_SURVEY_REVIEW_STATUSES)[number];

export type ExperienceSurveyFeatureStatus =
  (typeof EXPERIENCE_SURVEY_FEATURE_STATUSES)[number];

export function isExperienceSurveyReviewStatus(
  value: string,
): value is ExperienceSurveyReviewStatus {
  return (EXPERIENCE_SURVEY_REVIEW_STATUSES as readonly string[]).includes(value);
}

export function isExperienceSurveyFeatureStatus(
  value: string,
): value is ExperienceSurveyFeatureStatus {
  return (EXPERIENCE_SURVEY_FEATURE_STATUSES as readonly string[]).includes(value);
}

export function formatExperienceSurveyFeatureStatusLabel(
  status: string | null | undefined,
): string {
  switch (status) {
    case EXPERIENCE_SURVEY_FEATURE_STATUS_NEW:
      return "New";
    case EXPERIENCE_SURVEY_FEATURE_STATUS_UNDER_REVIEW:
      return "Under Review";
    case EXPERIENCE_SURVEY_FEATURE_STATUS_PLANNED:
      return "Planned";
    case EXPERIENCE_SURVEY_FEATURE_STATUS_IN_DEVELOPMENT:
      return "In Development";
    case EXPERIENCE_SURVEY_FEATURE_STATUS_RELEASED:
      return "Released";
    default:
      return status ? status.replace(/_/g, " ") : "—";
  }
}

export function formatExperienceSurveyReviewStatusLabel(
  status: string | null | undefined,
): string {
  if (status === EXPERIENCE_SURVEY_REVIEW_REVIEWED) return "Reviewed";
  if (status === EXPERIENCE_SURVEY_REVIEW_NEW) return "New";
  return status ? status.replace(/_/g, " ") : "—";
}
