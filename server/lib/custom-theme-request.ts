export const CUSTOM_THEME_ORDER_ITEM_TYPE = "custom_theme" as const;

/** Server-fixed fee in PHP. Override with CUSTOM_THEME_REQUEST_FEE_PHP. */
export function getCustomThemeRequestFeePhp(): number {
  const raw = Number(process.env.CUSTOM_THEME_REQUEST_FEE_PHP ?? "200");
  if (!Number.isFinite(raw) || raw <= 0) return 200;
  return Math.round(raw * 100) / 100;
}

/** Statuses before payment is confirmed — never shown in the dev queue. */
export const CUSTOM_THEME_PAYMENT_PENDING_STATUSES = [
  "awaiting_payment",
  "payment_failed",
] as const;

/** Workflow statuses visible to developers after payment. */
export const CUSTOM_THEME_DEV_VISIBLE_STATUSES = [
  "pending",
  "reviewing",
  "quoted",
  "in_progress",
  "delivered",
  "closed",
  "cancelled",
] as const;

export const CUSTOM_THEME_REQUEST_STATUSES = [
  ...CUSTOM_THEME_PAYMENT_PENDING_STATUSES,
  ...CUSTOM_THEME_DEV_VISIBLE_STATUSES,
] as const;

export type CustomThemeRequestStatus =
  (typeof CUSTOM_THEME_REQUEST_STATUSES)[number];

export function isCustomThemeRequestStatus(
  value: string,
): value is CustomThemeRequestStatus {
  return (CUSTOM_THEME_REQUEST_STATUSES as readonly string[]).includes(value);
}

export function isCustomThemeDevVisibleStatus(value: string): boolean {
  return (CUSTOM_THEME_DEV_VISIBLE_STATUSES as readonly string[]).includes(
    value,
  );
}

export function generateCustomThemeReferenceNumber(): string {
  const date = new Date();
  const yyyymmdd =
    date.getFullYear().toString() +
    String(date.getMonth() + 1).padStart(2, "0") +
    String(date.getDate()).padStart(2, "0");
  const suffix = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `CTR-${yyyymmdd}-${suffix}`;
}

export type CustomThemeColorWay = {
  primary?: string | null;
  secondary?: string | null;
  accent?: string | null;
  background?: string | null;
  notes?: string | null;
};

export type CustomThemeTypography = {
  headingStyle: string;
  bodyStyle: string;
  tone?: string | null;
  preferredFonts?: string | null;
  notes?: string | null;
};

export type CustomThemeRequestInput = {
  projectName: string;
  industry?: string | null;
  useCase?: string | null;
  targetAudience?: string | null;
  primaryGoals: string[];
  themeStyles: string[];
  mood: string;
  colorWay: CustomThemeColorWay;
  typography: CustomThemeTypography;
  imageryStyle?: string[];
  shapeLanguage?: string | null;
  motionPreference?: string | null;
  layoutPreferences: string[];
  mustHaveSections: string[];
  brandPersonality: string[];
  devicePriority?: string | null;
  languages?: string | null;
  brandAssets?: string | null;
  accessibilityNeeds?: string | null;
  deliverableScope?: string | null;
  inspirationUrls?: string | null;
  referenceImageUrls: string[];
  avoidList?: string | null;
  competitorNotes?: string | null;
  budgetRange?: string | null;
  timeline?: string | null;
  moreDetails: string;
  contactPreference: string;
};

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => String(item)).filter(Boolean);
  } catch {
    return [];
  }
}

function parseColorWay(raw: string): CustomThemeColorWay {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      primary: parsed.primary ? String(parsed.primary) : null,
      secondary: parsed.secondary ? String(parsed.secondary) : null,
      accent: parsed.accent ? String(parsed.accent) : null,
      background: parsed.background ? String(parsed.background) : null,
      notes: parsed.notes ? String(parsed.notes) : null,
    };
  } catch {
    return {
      primary: null,
      secondary: null,
      accent: null,
      background: null,
      notes: null,
    };
  }
}

function parseTypography(raw: string): CustomThemeTypography {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      headingStyle: String(parsed.headingStyle ?? ""),
      bodyStyle: String(parsed.bodyStyle ?? ""),
      tone: parsed.tone ? String(parsed.tone) : null,
      preferredFonts: parsed.preferredFonts
        ? String(parsed.preferredFonts)
        : null,
      notes: parsed.notes ? String(parsed.notes) : null,
    };
  } catch {
    return {
      headingStyle: "",
      bodyStyle: "",
      tone: null,
      preferredFonts: null,
      notes: null,
    };
  }
}

function bullet(label: string, values: string[]): string {
  if (!values.length) return `${label}: (none)`;
  return `${label}:\n${values.map((v) => `  - ${v}`).join("\n")}`;
}

export function buildCustomThemeBrief(
  data: CustomThemeRequestInput,
  userId: string,
  referenceNumber: string,
): string {
  const lines = [
    "CUSTOM THEME DESIGN BRIEF (ESCALATION)",
    "=====================================",
    "Source: E-Market → Paid Templates → Request Custom Theme",
    `Reference: ${referenceNumber}`,
    `Submitted by user_id: ${userId}`,
    "Payment: Confirmed (custom theme request fee)",
    "Routing: Escalated to Development for design follow-up",
    "",
    "1) PROJECT & AUDIENCE",
    `Project / brand name: ${data.projectName}`,
    `Industry: ${data.industry?.trim() || "(not specified)"}`,
    `Primary use case: ${data.useCase?.trim() || "(not specified)"}`,
    `Target audience: ${data.targetAudience?.trim() || "(not specified)"}`,
    `Languages to support: ${data.languages?.trim() || "(not specified)"}`,
    bullet("Primary visitor goals / CTAs", data.primaryGoals),
    "",
    "2) VISUAL DIRECTION",
    bullet("Theme style direction", data.themeStyles),
    `Overall mood: ${data.mood}`,
    bullet("Brand personality keywords", data.brandPersonality),
    "",
    "3) COLOR WAY",
    `  - Primary: ${data.colorWay.primary?.trim() || "(open — propose)"}`,
    `  - Secondary: ${data.colorWay.secondary?.trim() || "(open — propose)"}`,
    `  - Accent / CTA: ${data.colorWay.accent?.trim() || "(open — propose)"}`,
    `  - Background / surfaces: ${data.colorWay.background?.trim() || "(open — propose)"}`,
    `  - Notes: ${data.colorWay.notes?.trim() || "(none)"}`,
    "",
    "4) TYPOGRAPHY / TEXT STYLES",
    `  - Heading style: ${data.typography.headingStyle}`,
    `  - Body style: ${data.typography.bodyStyle}`,
    `  - Tone: ${data.typography.tone?.trim() || "(not specified)"}`,
    `  - Preferred fonts (if any): ${data.typography.preferredFonts?.trim() || "(open — propose)"}`,
    `  - Notes: ${data.typography.notes?.trim() || "(none)"}`,
    "",
    "5) LAYOUT & CONTENT",
    bullet("Layout preferences", data.layoutPreferences),
    bullet("Must-have portfolio sections", data.mustHaveSections),
    "",
    "6) ASSETS, SCOPE & CONSTRAINTS",
    `Brand assets available: ${data.brandAssets || "(not specified)"}`,
    `Deliverable scope: ${data.deliverableScope?.trim() || "(not specified)"}`,
    `Inspiration / reference URLs:\n${data.inspirationUrls?.trim() || "(none)"}`,
    bullet("Reference images (optional)", data.referenceImageUrls),
    `Please avoid:\n${data.avoidList?.trim() || "(none)"}`,
    `Competitors / differentiation:\n${data.competitorNotes?.trim() || "(none)"}`,
    "",
    "7) CONTACT",
    `Preferred contact: ${data.contactPreference}`,
    "",
    "8) CREATIVE BRIEF (FREEFORM)",
    data.moreDetails.trim(),
    "",
    "— End of custom theme design brief —",
  ];
  return lines.join("\n");
}

export function rowToCustomThemeBriefInput(
  row: Pick<
    CustomThemeRequestRow,
    | "project_name"
    | "industry"
    | "use_case"
    | "target_audience"
    | "languages"
    | "primary_goals"
    | "theme_styles"
    | "mood"
    | "color_way"
    | "typography"
    | "layout_preferences"
    | "must_have_sections"
    | "brand_personality"
    | "brand_assets"
    | "deliverable_scope"
    | "inspiration_urls"
    | "reference_image_urls"
    | "avoid_list"
    | "competitor_notes"
    | "more_details"
    | "contact_preference"
  >,
): CustomThemeRequestInput {
  return {
    projectName: row.project_name,
    industry: row.industry,
    useCase: row.use_case,
    targetAudience: row.target_audience,
    languages: row.languages,
    primaryGoals: parseJsonArray(row.primary_goals),
    themeStyles: parseJsonArray(row.theme_styles),
    mood: row.mood,
    colorWay: parseColorWay(row.color_way),
    typography: parseTypography(row.typography),
    layoutPreferences: parseJsonArray(row.layout_preferences),
    mustHaveSections: parseJsonArray(row.must_have_sections),
    brandPersonality: parseJsonArray(row.brand_personality),
    brandAssets: row.brand_assets,
    deliverableScope: row.deliverable_scope,
    inspirationUrls: row.inspiration_urls,
    referenceImageUrls: parseJsonArray(row.reference_image_urls),
    avoidList: row.avoid_list,
    competitorNotes: row.competitor_notes,
    moreDetails: row.more_details,
    contactPreference: row.contact_preference,
  };
}

export function toCustomThemeRequestCreateData(
  input: CustomThemeRequestInput,
  userId: bigint,
  opts?: {
    conversationId?: bigint | null;
    referenceNumber?: string;
    status?: string;
    shopOrderId?: bigint | null;
    paymentAmount?: number | null;
  },
) {
  return {
    user_id: userId,
    reference_number:
      opts?.referenceNumber ?? generateCustomThemeReferenceNumber(),
    project_name: input.projectName.trim(),
    industry: input.industry?.trim() || null,
    use_case: input.useCase?.trim() || null,
    target_audience: input.targetAudience?.trim() || null,
    languages: input.languages?.trim() || null,
    primary_goals: JSON.stringify(input.primaryGoals ?? []),
    theme_styles: JSON.stringify(input.themeStyles),
    mood: input.mood,
    color_way: JSON.stringify({
      primary: input.colorWay.primary ?? null,
      secondary: input.colorWay.secondary ?? null,
      accent: input.colorWay.accent ?? null,
      background: input.colorWay.background ?? null,
      notes: input.colorWay.notes ?? null,
    }),
    typography: JSON.stringify({
      headingStyle: input.typography.headingStyle,
      bodyStyle: input.typography.bodyStyle,
      tone: input.typography.tone ?? null,
      preferredFonts: input.typography.preferredFonts ?? null,
      notes: input.typography.notes ?? null,
    }),
    imagery_style: JSON.stringify(input.imageryStyle ?? []),
    shape_language: input.shapeLanguage?.trim() || null,
    motion_preference: input.motionPreference?.trim() || null,
    layout_preferences: JSON.stringify(input.layoutPreferences ?? []),
    must_have_sections: JSON.stringify(input.mustHaveSections ?? []),
    brand_personality: JSON.stringify(input.brandPersonality ?? []),
    device_priority: input.devicePriority?.trim() || null,
    brand_assets: input.brandAssets?.trim() || null,
    accessibility_needs: input.accessibilityNeeds?.trim() || null,
    deliverable_scope: input.deliverableScope?.trim() || null,
    inspiration_urls: input.inspirationUrls?.trim() || null,
    reference_image_urls: JSON.stringify(input.referenceImageUrls ?? []),
    avoid_list: input.avoidList?.trim() || null,
    competitor_notes: input.competitorNotes?.trim() || null,
    budget_range: input.budgetRange?.trim() || null,
    timeline: input.timeline?.trim() || null,
    more_details: input.moreDetails.trim(),
    contact_preference: input.contactPreference,
    status: opts?.status ?? "awaiting_payment",
    conversation_id: opts?.conversationId ?? null,
    shop_order_id: opts?.shopOrderId ?? null,
    payment_amount:
      opts?.paymentAmount != null ? opts.paymentAmount : null,
  };
}

type UserSnippet = {
  user_id: bigint;
  first_name: string;
  last_name: string;
  email: string;
  contact: string | null;
} | null;

export type CustomThemeRequestRow = {
  id: bigint;
  user_id: bigint;
  reference_number: string | null;
  project_name: string;
  industry: string | null;
  use_case: string | null;
  target_audience: string | null;
  languages: string | null;
  primary_goals: string | null;
  theme_styles: string;
  mood: string;
  color_way: string;
  typography: string;
  imagery_style: string | null;
  shape_language: string | null;
  motion_preference: string | null;
  layout_preferences: string | null;
  must_have_sections: string | null;
  brand_personality: string | null;
  device_priority: string | null;
  brand_assets: string | null;
  accessibility_needs: string | null;
  deliverable_scope: string | null;
  inspiration_urls: string | null;
  reference_image_urls: string | null;
  avoid_list: string | null;
  competitor_notes: string | null;
  budget_range: string | null;
  timeline: string | null;
  more_details: string;
  contact_preference: string;
  status: string;
  staff_notes: string | null;
  conversation_id: bigint | null;
  assigned_to: bigint | null;
  shop_order_id?: bigint | null;
  paid_at?: Date | null;
  payment_amount?: { toString(): string } | null;
  read_at: Date | null;
  created_at: Date;
  updated_at: Date;
  user?: UserSnippet;
  assignee?: UserSnippet;
};

function serializeUser(user: UserSnippet) {
  if (!user) return null;
  return {
    id: user.user_id.toString(),
    name: `${user.first_name} ${user.last_name}`.trim(),
    firstName: user.first_name,
    lastName: user.last_name,
    email: user.email,
    contact: user.contact,
  };
}

export function serializeCustomThemeRequest(row: CustomThemeRequestRow) {
  return {
    id: row.id.toString(),
    userId: row.user_id.toString(),
    referenceNumber: row.reference_number,
    projectName: row.project_name,
    industry: row.industry,
    useCase: row.use_case,
    targetAudience: row.target_audience,
    languages: row.languages,
    primaryGoals: parseJsonArray(row.primary_goals),
    themeStyles: parseJsonArray(row.theme_styles),
    mood: row.mood,
    colorWay: parseColorWay(row.color_way),
    typography: parseTypography(row.typography),
    imageryStyle: parseJsonArray(row.imagery_style),
    shapeLanguage: row.shape_language,
    motionPreference: row.motion_preference,
    layoutPreferences: parseJsonArray(row.layout_preferences),
    mustHaveSections: parseJsonArray(row.must_have_sections),
    brandPersonality: parseJsonArray(row.brand_personality),
    devicePriority: row.device_priority,
    brandAssets: row.brand_assets,
    accessibilityNeeds: row.accessibility_needs,
    deliverableScope: row.deliverable_scope,
    inspirationUrls: row.inspiration_urls,
    referenceImageUrls: parseJsonArray(row.reference_image_urls),
    avoidList: row.avoid_list,
    competitorNotes: row.competitor_notes,
    budgetRange: row.budget_range,
    timeline: row.timeline,
    moreDetails: row.more_details,
    contactPreference: row.contact_preference,
    status: row.status,
    staffNotes: row.staff_notes,
    conversationId: row.conversation_id?.toString() ?? null,
    assignedTo: row.assigned_to?.toString() ?? null,
    shopOrderId: row.shop_order_id?.toString() ?? null,
    paidAt: row.paid_at?.toISOString() ?? null,
    paymentAmount:
      row.payment_amount != null ? Number(row.payment_amount.toString()) : null,
    feePhp: getCustomThemeRequestFeePhp(),
    readAt: row.read_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    user: serializeUser(row.user ?? null),
    assignee: serializeUser(row.assignee ?? null),
  };
}

export const customThemeRequestUserInclude = {
  user: {
    select: {
      user_id: true,
      first_name: true,
      last_name: true,
      email: true,
      contact: true,
    },
  },
  assignee: {
    select: {
      user_id: true,
      first_name: true,
      last_name: true,
      email: true,
      contact: true,
    },
  },
} as const;
