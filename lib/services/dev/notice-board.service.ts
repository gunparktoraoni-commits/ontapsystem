import { prisma } from "@/server/lib/prisma";
import {
  getDefaultPreferences,
  queueEmailForNotification,
  randomId,
  resolveNotificationActionUrlForRole,
} from "@/server/lib/notifications";
import {
  getNoticeTypeMeta,
  isNoticeStatus,
  isNoticeType,
  type NoticeAudienceId,
  type NoticeChannelId,
  type NoticePlacementId,
  type NoticePortalId,
  type NoticePriorityId,
  type NoticeStatusId,
  type NoticeTypeId,
  type SurveyQuestion,
} from "@/lib/portal/notice-board";

export type NoticeInput = {
  title: string;
  summary?: string | null;
  body: string;
  noticeType: NoticeTypeId;
  status?: NoticeStatusId;
  priority?: NoticePriorityId;
  portals: NoticePortalId[];
  placements: NoticePlacementId[];
  audiences: NoticeAudienceId[];
  channels: NoticeChannelId[];
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  surveyUrl?: string | null;
  accentColor?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  whatsNewAdded?: string[];
  whatsNewFixed?: string[];
  whatsNewRemoved?: string[];
  surveyQuestions?: SurveyQuestion[];
  targetUserIds?: string[];
  mediaUrls?: string[];
};

export type NoticeTargetUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  serialId: string | null;
};

export type NoticeDto = {
  id: string;
  publicId: string;
  title: string;
  summary: string | null;
  body: string;
  noticeType: string;
  noticeTypeLabel: string;
  status: string;
  priority: string;
  portals: string[];
  placements: string[];
  audiences: string[];
  channels: string[];
  ctaLabel: string | null;
  ctaUrl: string | null;
  surveyUrl: string | null;
  accentColor: string | null;
  startsAt: string | null;
  endsAt: string | null;
  publishedAt: string | null;
  notifiedAt: string | null;
  notifyInApp: number;
  notifyEmail: number;
  notifySkipped: number;
  createdAt: string;
  updatedAt: string | null;
  createdBy: string | null;
  whatsNewAdded: string[];
  whatsNewFixed: string[];
  whatsNewRemoved: string[];
  surveyQuestions: SurveyQuestion[];
  targetUserIds: string[];
  /** Resolved name/email for targetUserIds (empty until hydrated). */
  targetUsers: NoticeTargetUser[];
  mediaUrls: string[];
};

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function parseSurveyQuestions(raw: string | null | undefined): SurveyQuestion[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const questions: SurveyQuestion[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const id = typeof row.id === "string" ? row.id : "";
      const prompt = typeof row.prompt === "string" ? row.prompt.trim() : "";
      const type = typeof row.type === "string" ? row.type : "text";
      if (!id || !prompt) continue;
      questions.push({
        id,
        prompt,
        type: type as SurveyQuestion["type"],
        options: Array.isArray(row.options)
          ? row.options.filter((opt): opt is string => typeof opt === "string")
          : undefined,
        required: Boolean(row.required),
        min: typeof row.min === "number" ? row.min : undefined,
        max: typeof row.max === "number" ? row.max : undefined,
      });
    }
    return questions;
  } catch {
    return [];
  }
}

function toJson(value: unknown): string {
  return JSON.stringify(value);
}

function asIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function cleanStringList(values: string[] | undefined, maxItems = 40): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function mapNotice(row: {
  notice_id: bigint;
  public_id: string;
  title: string;
  summary: string | null;
  body: string;
  notice_type: string;
  status: string;
  priority: string;
  portals: string;
  placements: string;
  audiences: string;
  channels: string;
  cta_label: string | null;
  cta_url: string | null;
  survey_url: string | null;
  whats_new_added?: string | null;
  whats_new_fixed?: string | null;
  whats_new_removed?: string | null;
  survey_questions?: string | null;
  target_user_ids?: string | null;
  media_urls?: string | null;
  accent_color: string | null;
  starts_at: Date | null;
  ends_at: Date | null;
  published_at: Date | null;
  notified_at: Date | null;
  notify_in_app: number;
  notify_email: number;
  notify_skipped: number;
  created_at: Date;
  updated_at: Date | null;
  created_by: bigint | null;
}): NoticeDto {
  const typeMeta = getNoticeTypeMeta(row.notice_type);
  return {
    id: row.notice_id.toString(),
    publicId: row.public_id,
    title: row.title,
    summary: row.summary,
    body: row.body,
    noticeType: row.notice_type,
    noticeTypeLabel: typeMeta.label,
    status: row.status,
    priority: row.priority,
    portals: parseJsonArray(row.portals),
    placements: parseJsonArray(row.placements),
    audiences: parseJsonArray(row.audiences),
    channels: parseJsonArray(row.channels),
    ctaLabel: row.cta_label,
    ctaUrl: row.cta_url,
    surveyUrl: row.survey_url,
    accentColor: row.accent_color ?? typeMeta.accent,
    startsAt: asIso(row.starts_at),
    endsAt: asIso(row.ends_at),
    publishedAt: asIso(row.published_at),
    notifiedAt: asIso(row.notified_at),
    notifyInApp: row.notify_in_app,
    notifyEmail: row.notify_email,
    notifySkipped: row.notify_skipped,
    createdAt: row.created_at.toISOString(),
    updatedAt: asIso(row.updated_at),
    createdBy: row.created_by?.toString() ?? null,
    whatsNewAdded: parseJsonArray(row.whats_new_added),
    whatsNewFixed: parseJsonArray(row.whats_new_fixed),
    whatsNewRemoved: parseJsonArray(row.whats_new_removed),
    surveyQuestions: parseSurveyQuestions(row.survey_questions),
    targetUserIds: parseJsonArray(row.target_user_ids),
    targetUsers: [],
    mediaUrls: parseJsonArray(row.media_urls),
  };
}

function toTargetUser(user: {
  user_id: bigint;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: string;
  serial_id: string | null;
}): NoticeTargetUser {
  const name =
    [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || user.email;
  return {
    id: user.user_id.toString(),
    name,
    email: user.email,
    role: user.role,
    serialId: user.serial_id,
  };
}

export async function resolveNoticeTargetUsers(
  targetUserIds: string[],
): Promise<NoticeTargetUser[]> {
  const ids = targetUserIds
    .map((id) => {
      try {
        return BigInt(id);
      } catch {
        return null;
      }
    })
    .filter((id): id is bigint => id != null);
  if (!ids.length) return [];

  const users = await prisma.user.findMany({
    where: { user_id: { in: ids } },
    select: {
      user_id: true,
      email: true,
      first_name: true,
      last_name: true,
      role: true,
      serial_id: true,
    },
  });
  const byId = new Map(users.map((user) => [user.user_id.toString(), toTargetUser(user)]));
  return targetUserIds
    .map((id) => byId.get(id))
    .filter((user): user is NoticeTargetUser => Boolean(user));
}

async function hydrateNoticeTargetUsers(notices: NoticeDto[]): Promise<NoticeDto[]> {
  const allIds = Array.from(new Set(notices.flatMap((notice) => notice.targetUserIds)));
  if (!allIds.length) {
    return notices.map((notice) => ({ ...notice, targetUsers: [] }));
  }
  const resolved = await resolveNoticeTargetUsers(allIds);
  const byId = new Map(resolved.map((user) => [user.id, user]));
  return notices.map((notice) => ({
    ...notice,
    targetUsers: notice.targetUserIds
      .map((id) => byId.get(id))
      .filter((user): user is NoticeTargetUser => Boolean(user)),
  }));
}

function sanitizeInput(input: NoticeInput): NoticeInput {
  const title = input.title.trim().slice(0, 200);
  const body = input.body.trim().slice(0, 8000);
  const summary = input.summary?.trim().slice(0, 320) || null;
  if (!title) throw new Error("Title is required.");
  if (!body && input.noticeType !== "whats_new" && input.noticeType !== "survey") {
    throw new Error("Body is required.");
  }
  if (!isNoticeType(input.noticeType)) throw new Error("Invalid notice type.");
  if (!input.portals.length) throw new Error("Select at least one portal.");
  if (!input.placements.length) throw new Error("Select at least one placement.");
  if (!input.audiences.length) throw new Error("Select at least one audience.");
  if (!input.channels.length) throw new Error("Select at least one notification channel.");
  const targetUserIds = cleanStringList(input.targetUserIds, 500);
  let audiences = [...input.audiences];
  // Selecting specific users implies the custom audience, even if the composer
  // still has a portal-wide audience checked alongside the picker.
  if (targetUserIds.length > 0 && !audiences.includes("custom_users")) {
    audiences = [...audiences, "custom_users"];
  }
  if (audiences.includes("custom_users") && !targetUserIds.length) {
    throw new Error("Pick at least one specific user when using custom audience.");
  }
  if (input.noticeType === "survey" && !(input.surveyQuestions?.length)) {
    throw new Error("Add at least one survey question.");
  }

  const surveyQuestions = (input.surveyQuestions ?? [])
    .map((q) => ({
      id: String(q.id || randomId("q")).slice(0, 40),
      prompt: String(q.prompt || "").trim().slice(0, 400),
      type: q.type,
      options: cleanStringList(q.options, 20),
      required: Boolean(q.required),
      min: q.type === "rating" ? 1 : undefined,
      max: q.type === "rating" ? 5 : undefined,
    }))
    .filter((q) => q.prompt);

  return {
    ...input,
    title,
    body: body || summary || title,
    summary,
    status: input.status && isNoticeStatus(input.status) ? input.status : "draft",
    priority: input.priority ?? "medium",
    audiences: audiences as NoticeAudienceId[],
    ctaLabel: input.ctaLabel?.trim().slice(0, 80) || null,
    ctaUrl: input.ctaUrl?.trim().slice(0, 512) || null,
    surveyUrl: input.surveyUrl?.trim().slice(0, 512) || null,
    accentColor: input.accentColor?.trim().slice(0, 16) || null,
    whatsNewAdded: cleanStringList(input.whatsNewAdded),
    whatsNewFixed: cleanStringList(input.whatsNewFixed),
    whatsNewRemoved: cleanStringList(input.whatsNewRemoved),
    surveyQuestions,
    targetUserIds,
    mediaUrls: cleanStringList(input.mediaUrls, 12),
  };
}

function parsePreferences(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function wantsInApp(prefsRaw: string | null): boolean {
  const prefs = parsePreferences(prefsRaw);
  const defaults = getDefaultPreferences();
  const eventPref = (prefs.system_update ?? defaults.system_update) as
    | Record<string, unknown>
    | undefined;
  if (!eventPref) return true;
  return eventPref.in_app !== false;
}

function wantsEmail(prefsRaw: string | null, unsubscribedAt: Date | null, emailVerified: boolean): boolean {
  if (unsubscribedAt !== null || !emailVerified) return false;
  const prefs = parsePreferences(prefsRaw);
  const defaults = getDefaultPreferences();
  const eventPref = (prefs.system_update ?? defaults.system_update) as
    | Record<string, unknown>
    | undefined;
  if (!eventPref) return true;
  return eventPref.email === true;
}

function portalRoles(portals: string[]): string[] {
  const roles = new Set<string>();
  if (portals.includes("user")) roles.add("user");
  if (portals.includes("admin")) {
    roles.add("admin");
    roles.add("company_admin");
    roles.add("manager");
  }
  if (portals.includes("staff")) roles.add("staff");
  return Array.from(roles);
}

export async function resolveNoticeAudienceUserIds(
  portals: string[],
  audiences: string[],
  targetUserIds: string[] = [],
): Promise<bigint[]> {
  if (audiences.includes("custom_users")) {
    const ids = targetUserIds
      .map((id) => {
        try {
          return BigInt(id);
        } catch {
          return null;
        }
      })
      .filter((id): id is bigint => id != null);
    if (!ids.length) return [];
    const users = await prisma.user.findMany({
      where: {
        user_id: { in: ids },
        is_active: true,
        deactivated_flag: false,
        deleted_at: null,
      },
      select: { user_id: true },
    });
    return users.map((user) => user.user_id);
  }

  const roles = portalRoles(portals);
  if (!roles.length) return [];

  const baseUsers = await prisma.user.findMany({
    where: {
      is_active: true,
      deactivated_flag: false,
      deleted_at: null,
      role: { in: roles },
    },
    select: {
      user_id: true,
      role: true,
      created_at: true,
      company_id: true,
    },
  });

  if (!baseUsers.length) return [];

  const includeAll = audiences.includes("all_matched_portals");
  const wantUser = audiences.includes("role_user");
  const wantAdmin = audiences.includes("role_company_admin");
  const wantStaff = audiences.includes("role_staff");
  const wantNew = audiences.includes("new_users");
  const tierKeys = audiences.filter((item) =>
    ["tier_basic", "tier_standard", "tier_premium"].includes(item),
  );
  const wantTrial = audiences.includes("tier_free_trial");

  const newCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  let candidates = baseUsers;

  if (!includeAll) {
    candidates = candidates.filter((user) => {
      const role = String(user.role ?? "").toLowerCase();
      const roleOk =
        (wantUser && role === "user") ||
        (wantAdmin && ["admin", "company_admin", "manager"].includes(role)) ||
        (wantStaff && role === "staff") ||
        (!wantUser && !wantAdmin && !wantStaff);
      const newOk = !wantNew || (user.created_at?.getTime() ?? 0) >= newCutoff;
      if (!wantUser && !wantAdmin && !wantStaff) {
        return wantNew ? newOk : true;
      }
      return roleOk && (!wantNew || newOk);
    });
  }

  let userIds = candidates.map((user) => user.user_id);

  if (tierKeys.length || wantTrial) {
    const tierCodes = tierKeys.map((key) => key.replace("tier_", ""));
    const tierUserIds = new Set<string>();

    if (tierCodes.length) {
      const bizcards = await prisma.bizcard.findMany({
        where: {
          deactivated_flag: false,
          subscription_tier: { in: tierCodes },
          user_id: { in: userIds },
        },
        select: { user_id: true },
        distinct: ["user_id"],
      });
      bizcards.forEach((row) => {
        if (row.user_id != null) tierUserIds.add(row.user_id.toString());
      });
    }

    if (wantTrial) {
      const trialPlans = await prisma.subscriptionPlan.findMany({
        where: { is_trial: true, is_active: true },
        select: { id: true },
      });
      if (trialPlans.length) {
        const subs = await prisma.bizcardSubscription.findMany({
          where: {
            plan_id: { in: trialPlans.map((plan) => plan.id) },
            status: { in: ["active", "pending"] },
            bizcard: { user_id: { in: userIds } },
          },
          include: { bizcard: { select: { user_id: true } } },
        });
        subs.forEach((sub) => {
          if (sub.bizcard.user_id != null) {
            tierUserIds.add(sub.bizcard.user_id.toString());
          }
        });
      }
    }

    // When tier filters exist, intersect with role/lifecycle set.
    userIds = userIds.filter((id) => tierUserIds.has(id.toString()));
  }

  return Array.from(new Set(userIds.map((id) => id.toString()))).map((id) => BigInt(id));
}

export async function previewNoticeAudience(
  portals: string[],
  audiences: string[],
  targetUserIds: string[] = [],
) {
  const ids = await resolveNoticeAudienceUserIds(portals, audiences, targetUserIds);
  return { count: ids.length, sampleIds: ids.slice(0, 8).map((id) => id.toString()) };
}

export async function listNotices(
  filters?: {
    status?: string;
    noticeType?: string;
    portal?: string;
  },
  options?: { hydrateTargets?: boolean },
): Promise<NoticeDto[]> {
  const rows = await prisma.devNotice.findMany({
    where: {
      deleted_at: null,
      ...(filters?.status ? { status: filters.status } : {}),
      ...(filters?.noticeType ? { notice_type: filters.noticeType } : {}),
    },
    orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
    take: 200,
  });

  let mapped = rows.map(mapNotice);
  if (filters?.portal) {
    mapped = mapped.filter((item) => item.portals.includes(filters.portal!));
  }
  if (options?.hydrateTargets === false) {
    return mapped.map((notice) => ({ ...notice, targetUsers: [] }));
  }
  return hydrateNoticeTargetUsers(mapped);
}

export async function getNoticeByPublicId(publicId: string): Promise<NoticeDto | null> {
  const row = await prisma.devNotice.findFirst({
    where: { public_id: publicId, deleted_at: null },
  });
  if (!row) return null;
  const [hydrated] = await hydrateNoticeTargetUsers([mapNotice(row)]);
  return hydrated ?? null;
}

export async function createNotice(
  input: NoticeInput,
  actorId?: bigint | null,
  options?: { notify?: boolean },
): Promise<{
  notice: NoticeDto;
  delivery: { inApp: number; email: number; skipped: number } | null;
}> {
  const clean = sanitizeInput(input);
  const typeMeta = getNoticeTypeMeta(clean.noticeType);
  const row = await prisma.devNotice.create({
    data: {
      public_id: randomId("notice"),
      title: clean.title,
      summary: clean.summary,
      body: clean.body,
      notice_type: clean.noticeType,
      status: clean.status ?? "draft",
      priority: clean.priority ?? "medium",
      portals: toJson(clean.portals),
      placements: toJson(clean.placements),
      audiences: toJson(clean.audiences),
      channels: toJson(clean.channels),
      cta_label: clean.ctaLabel,
      cta_url: clean.ctaUrl,
      survey_url: clean.surveyUrl,
      whats_new_added: toJson(clean.whatsNewAdded ?? []),
      whats_new_fixed: toJson(clean.whatsNewFixed ?? []),
      whats_new_removed: toJson(clean.whatsNewRemoved ?? []),
      survey_questions: toJson(clean.surveyQuestions ?? []),
      target_user_ids: toJson(clean.targetUserIds ?? []),
      media_urls: toJson(clean.mediaUrls ?? []),
      accent_color: clean.accentColor ?? typeMeta.accent,
      starts_at: clean.startsAt ? new Date(clean.startsAt) : null,
      ends_at: clean.endsAt ? new Date(clean.endsAt) : null,
      created_by: actorId ?? null,
      updated_by: actorId ?? null,
    },
  });
  let [notice] = await hydrateNoticeTargetUsers([mapNotice(row)]);
  notice = notice!;

  const delivery = await maybeNotifyNotice(notice, options);
  if (delivery) {
    const updated = await prisma.devNotice.update({
      where: { notice_id: row.notice_id },
      data: {
        notified_at: new Date(),
        notify_in_app: delivery.inApp,
        notify_email: delivery.email,
        notify_skipped: delivery.skipped,
        ...(notice.status === "draft" || notice.status === "scheduled"
          ? { status: "published", published_at: new Date() }
          : {}),
      },
    });
    [notice] = await hydrateNoticeTargetUsers([mapNotice(updated)]);
    notice = notice!;
  }

  return { notice, delivery };
}

export async function updateNotice(
  publicId: string,
  input: Partial<NoticeInput> & { status?: NoticeStatusId },
  actorId?: bigint | null,
  options?: { notify?: boolean },
): Promise<{
  notice: NoticeDto;
  delivery: { inApp: number; email: number; skipped: number } | null;
}> {
  const existing = await prisma.devNotice.findFirst({
    where: { public_id: publicId, deleted_at: null },
  });
  if (!existing) throw new Error("Notice not found.");

  const merged: NoticeInput = {
    title: input.title ?? existing.title,
    summary: input.summary !== undefined ? input.summary : existing.summary,
    body: input.body ?? existing.body,
    noticeType: (input.noticeType ?? existing.notice_type) as NoticeTypeId,
    status: (input.status ?? existing.status) as NoticeStatusId,
    priority: (input.priority ?? existing.priority) as NoticePriorityId,
    portals: (input.portals ?? parseJsonArray(existing.portals)) as NoticePortalId[],
    placements: (input.placements ?? parseJsonArray(existing.placements)) as NoticePlacementId[],
    audiences: (input.audiences ?? parseJsonArray(existing.audiences)) as NoticeAudienceId[],
    channels: (input.channels ?? parseJsonArray(existing.channels)) as NoticeChannelId[],
    ctaLabel: input.ctaLabel !== undefined ? input.ctaLabel : existing.cta_label,
    ctaUrl: input.ctaUrl !== undefined ? input.ctaUrl : existing.cta_url,
    surveyUrl: input.surveyUrl !== undefined ? input.surveyUrl : existing.survey_url,
    accentColor: input.accentColor !== undefined ? input.accentColor : existing.accent_color,
    startsAt:
      input.startsAt !== undefined
        ? input.startsAt
        : existing.starts_at?.toISOString() ?? null,
    endsAt:
      input.endsAt !== undefined ? input.endsAt : existing.ends_at?.toISOString() ?? null,
    whatsNewAdded:
      input.whatsNewAdded ?? parseJsonArray((existing as { whats_new_added?: string | null }).whats_new_added),
    whatsNewFixed:
      input.whatsNewFixed ?? parseJsonArray((existing as { whats_new_fixed?: string | null }).whats_new_fixed),
    whatsNewRemoved:
      input.whatsNewRemoved ??
      parseJsonArray((existing as { whats_new_removed?: string | null }).whats_new_removed),
    surveyQuestions:
      input.surveyQuestions ??
      parseSurveyQuestions((existing as { survey_questions?: string | null }).survey_questions),
    targetUserIds:
      input.targetUserIds ?? parseJsonArray((existing as { target_user_ids?: string | null }).target_user_ids),
    mediaUrls: input.mediaUrls ?? parseJsonArray((existing as { media_urls?: string | null }).media_urls),
  };

  const clean = sanitizeInput(merged);
  const typeMeta = getNoticeTypeMeta(clean.noticeType);
  const row = await prisma.devNotice.update({
    where: { notice_id: existing.notice_id },
    data: {
      title: clean.title,
      summary: clean.summary,
      body: clean.body,
      notice_type: clean.noticeType,
      status: clean.status ?? existing.status,
      priority: clean.priority ?? existing.priority,
      portals: toJson(clean.portals),
      placements: toJson(clean.placements),
      audiences: toJson(clean.audiences),
      channels: toJson(clean.channels),
      cta_label: clean.ctaLabel,
      cta_url: clean.ctaUrl,
      survey_url: clean.surveyUrl,
      whats_new_added: toJson(clean.whatsNewAdded ?? []),
      whats_new_fixed: toJson(clean.whatsNewFixed ?? []),
      whats_new_removed: toJson(clean.whatsNewRemoved ?? []),
      survey_questions: toJson(clean.surveyQuestions ?? []),
      target_user_ids: toJson(clean.targetUserIds ?? []),
      media_urls: toJson(clean.mediaUrls ?? []),
      accent_color: clean.accentColor ?? typeMeta.accent,
      starts_at: clean.startsAt ? new Date(clean.startsAt) : null,
      ends_at: clean.endsAt ? new Date(clean.endsAt) : null,
      updated_by: actorId ?? null,
    },
  });

  let [notice] = await hydrateNoticeTargetUsers([mapNotice(row)]);
  notice = notice!;

  const delivery = await maybeNotifyNotice(notice, options);
  if (delivery) {
    const updated = await prisma.devNotice.update({
      where: { notice_id: existing.notice_id },
      data: {
        notified_at: new Date(),
        notify_in_app: delivery.inApp,
        notify_email: delivery.email,
        notify_skipped: delivery.skipped,
        ...(notice.status === "draft" || notice.status === "scheduled"
          ? { status: "published", published_at: new Date() }
          : {}),
      },
    });
    [notice] = await hydrateNoticeTargetUsers([mapNotice(updated)]);
    notice = notice!;
  }

  return { notice, delivery };
}

export async function archiveNotice(publicId: string, actorId?: bigint | null): Promise<NoticeDto> {
  const existing = await prisma.devNotice.findFirst({
    where: { public_id: publicId, deleted_at: null },
  });
  if (!existing) throw new Error("Notice not found.");
  const row = await prisma.devNotice.update({
    where: { notice_id: existing.notice_id },
    data: {
      status: "archived",
      updated_by: actorId ?? null,
    },
  });
  const [hydrated] = await hydrateNoticeTargetUsers([mapNotice(row)]);
  return hydrated!;
}

export async function softDeleteNotice(publicId: string, actorId?: bigint | null): Promise<void> {
  const existing = await prisma.devNotice.findFirst({
    where: { public_id: publicId, deleted_at: null },
  });
  if (!existing) throw new Error("Notice not found.");
  await prisma.devNotice.update({
    where: { notice_id: existing.notice_id },
    data: {
      deleted_at: new Date(),
      status: "archived",
      updated_by: actorId ?? null,
    },
  });
}

/**
 * Dev-portal notices to selected users should deliver even when the recipient
 * has not opted into system_update email / email_verified yet. Hard unsubscribes
 * are still respected inside fanOutNoticeNotifications.
 */
async function maybeNotifyNotice(
  notice: NoticeDto,
  options?: { notify?: boolean },
): Promise<{ inApp: number; email: number; skipped: number } | null> {
  if (options?.notify === false) return null;

  const hasChannel =
    notice.channels.includes("email") || notice.channels.includes("in_app");
  if (!hasChannel) return null;

  // Create/edit: notify explicitly selected users.
  if (notice.targetUserIds.length > 0) {
    return fanOutNoticeNotifications(notice, {
      targetsOnly: true,
      bypassEmailOptIn: true,
    });
  }

  return null;
}

async function fanOutNoticeNotifications(
  notice: NoticeDto,
  options?: { targetsOnly?: boolean; bypassEmailOptIn?: boolean },
): Promise<{
  inApp: number;
  email: number;
  skipped: number;
}> {
  let userIds: bigint[];
  if (options?.targetsOnly && notice.targetUserIds.length > 0) {
    userIds = await resolveNoticeAudienceUserIds(
      notice.portals,
      ["custom_users"],
      notice.targetUserIds,
    );
  } else {
    userIds = await resolveNoticeAudienceUserIds(
      notice.portals,
      notice.audiences,
      notice.targetUserIds,
    );
  }
  if (!userIds.length) return { inApp: 0, email: 0, skipped: 0 };

  const channels = new Set(notice.channels);
  const sendInApp = channels.has("in_app");
  const sendEmail = channels.has("email");
  const fallbackActionUrl =
    notice.ctaUrl ||
    notice.surveyUrl ||
    (notice.portals[0] === "staff"
      ? "/staff/dashboard"
      : notice.portals[0] === "admin"
        ? "/admin/dashboard"
        : "/user/dashboard");
  const actionText = notice.ctaLabel || (notice.noticeType === "survey" ? "Open survey" : "View notice");
  const message = notice.summary || notice.body.slice(0, 280);

  let inApp = 0;
  let email = 0;
  let skipped = 0;
  const BATCH = 80;

  for (let i = 0; i < userIds.length; i += BATCH) {
    const chunk = userIds.slice(i, i + BATCH);
    const users = await prisma.user.findMany({
      where: { user_id: { in: chunk } },
      select: {
        user_id: true,
        email: true,
        first_name: true,
        role: true,
        notificationPreference: {
          select: {
            preferences: true,
            unsubscribed_at: true,
            email_verified: true,
          },
        },
      },
    });

    for (const user of users) {
      const prefsRaw = user.notificationPreference?.preferences ?? null;
      const unsubscribedAt = user.notificationPreference?.unsubscribed_at ?? null;
      const emailVerified = user.notificationPreference?.email_verified ?? false;
      const allowInApp = sendInApp && wantsInApp(prefsRaw);
      const allowEmail =
        sendEmail &&
        Boolean(user.email) &&
        unsubscribedAt === null &&
        (options?.bypassEmailOptIn
          ? true
          : wantsEmail(prefsRaw, unsubscribedAt, emailVerified));

      if (!allowInApp && !allowEmail) {
        skipped++;
        continue;
      }

      const actionUrl = resolveNotificationActionUrlForRole(
        "system_update",
        user.role,
        {},
        fallbackActionUrl,
      );

      const notificationId = randomId("notif");
      try {
        if (allowInApp) {
          await prisma.userNotification.create({
            data: {
              id: notificationId,
              user_id: user.user_id,
              event_type: "system_update",
              priority: notice.priority,
              title: notice.title,
              message,
              action_url: actionUrl,
              action_text: actionText,
            },
          });
          await prisma.notificationDelivery.create({
            data: {
              id: randomId("ndel"),
              notification_id: notificationId,
              channel: "in_app",
              status: "delivered",
              delivered_at: new Date(),
            },
          });
          inApp++;
        }

        if (allowEmail && user.email) {
          if (allowInApp) {
            await prisma.notificationDelivery.create({
              data: {
                id: randomId("ndel"),
                notification_id: notificationId,
                channel: "email",
                status: "pending",
              },
            });
          }
          await queueEmailForNotification({
            userId: user.user_id,
            notificationId: allowInApp ? notificationId : null,
            recipientEmail: user.email,
            recipientName: user.first_name,
            subject: notice.title,
            templateName: "system-update",
            templateData: {
              app_name: process.env.EMAIL_FROM_NAME ?? "OnTap",
              app_url: process.env.FRONTEND_URL ?? "",
              user_name: user.first_name,
              update_title: notice.title,
              message,
              action_url: actionUrl,
              action_text: actionText,
              cta_url: notice.ctaUrl,
              cta_label: notice.ctaLabel,
              survey_url: notice.surveyUrl,
            },
            emailType: "system_update",
            priority: notice.priority === "critical" || notice.priority === "high" ? 90 : 70,
            // Notice-board fan-out should deliver now, not wait for the email cron.
            sendNow: true,
          });
          email++;
        }
      } catch (error) {
        console.error("[dev-notice] fan-out failed", user.user_id.toString(), error);
        skipped++;
      }
    }
  }

  return { inApp, email, skipped };
}

export async function publishNotice(
  publicId: string,
  actorId?: bigint | null,
  options?: { notify?: boolean },
): Promise<{ notice: NoticeDto; delivery: { inApp: number; email: number; skipped: number } }> {
  const existing = await getNoticeByPublicId(publicId);
  if (!existing) throw new Error("Notice not found.");
  if (existing.status === "archived") throw new Error("Archived notices cannot be published.");

  const shouldNotify = options?.notify !== false;
  const delivery = shouldNotify
    ? await fanOutNoticeNotifications(existing, {
        // Prefer the picker list when present; otherwise fan out to audience.
        targetsOnly: existing.targetUserIds.length > 0,
        // Explicit "Publish & notify" is an admin action — bypass soft opt-in /
        // email_verified gates so recipients actually get the message.
        bypassEmailOptIn: true,
      })
    : { inApp: 0, email: 0, skipped: 0 };

  const row = await prisma.devNotice.update({
    where: { public_id: publicId },
    data: {
      status: "published",
      published_at: new Date(),
      notified_at: shouldNotify ? new Date() : existing.notifiedAt ? new Date(existing.notifiedAt) : null,
      notify_in_app: shouldNotify ? delivery.inApp : existing.notifyInApp,
      notify_email: shouldNotify ? delivery.email : existing.notifyEmail,
      notify_skipped: shouldNotify ? delivery.skipped : existing.notifySkipped,
      updated_by: actorId ?? null,
    },
  });

  const [hydrated] = await hydrateNoticeTargetUsers([mapNotice(row)]);
  return { notice: hydrated!, delivery };
}

export async function getNoticeSummary() {
  const rows = await prisma.devNotice.findMany({
    where: { deleted_at: null },
    select: { status: true, notice_type: true },
    take: 200,
  });
  return {
    total: rows.length,
    draft: rows.filter((item) => item.status === "draft").length,
    scheduled: rows.filter((item) => item.status === "scheduled").length,
    published: rows.filter((item) => item.status === "published").length,
    archived: rows.filter((item) => item.status === "archived").length,
    byType: {
      system_update: rows.filter((item) => item.notice_type === "system_update").length,
      whats_new: rows.filter((item) => item.notice_type === "whats_new").length,
      survey: rows.filter((item) => item.notice_type === "survey").length,
      promotion: rows.filter((item) => item.notice_type === "promotion").length,
      alert: rows.filter((item) => item.notice_type === "alert").length,
    },
  };
}

function noticeIsLive(notice: NoticeDto, now = Date.now()): boolean {
  if (notice.status !== "published") return false;
  if (notice.startsAt && new Date(notice.startsAt).getTime() > now) return false;
  if (notice.endsAt && new Date(notice.endsAt).getTime() < now) return false;
  return true;
}

export async function getActiveNoticesForUser(params: {
  portal: NoticePortalId;
  placement?: NoticePlacementId | null;
  userId: bigint;
}): Promise<NoticeDto[]> {
  const notices = await listNotices(
    { status: "published", portal: params.portal },
    { hydrateTargets: false },
  );
  const live = notices.filter((notice) => {
    if (!noticeIsLive(notice)) return false;
    if (params.placement && !notice.placements.includes(params.placement)) return false;
    return true;
  });

  const matched: NoticeDto[] = [];
  for (const notice of live) {
    const ids = await resolveNoticeAudienceUserIds(
      notice.portals,
      notice.audiences,
      notice.targetUserIds,
    );
    if (ids.some((id) => id === params.userId)) matched.push(notice);
  }

  const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return matched.sort((a, b) => {
    const pr = (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9);
    if (pr !== 0) return pr;
    return (b.publishedAt ?? b.createdAt).localeCompare(a.publishedAt ?? a.createdAt);
  });
}

export async function hasUserSurveyResponse(noticePublicId: string, userId: bigint): Promise<boolean> {
  const notice = await prisma.devNotice.findFirst({
    where: { public_id: noticePublicId, deleted_at: null },
    select: { notice_id: true },
  });
  if (!notice) return false;
  const existing = await prisma.devSurveyResponse.findUnique({
    where: {
      notice_id_user_id: {
        notice_id: notice.notice_id,
        user_id: userId,
      },
    },
    select: { response_id: true },
  });
  return Boolean(existing);
}

export async function submitSurveyResponse(params: {
  noticePublicId: string;
  userId: bigint;
  answers: Record<string, unknown>;
}): Promise<{ responseId: string }> {
  const notice = await prisma.devNotice.findFirst({
    where: {
      public_id: params.noticePublicId,
      deleted_at: null,
      status: "published",
      notice_type: "survey",
    },
  });
  if (!notice) throw new Error("Survey notice not found.");

  const dto = mapNotice(notice as Parameters<typeof mapNotice>[0]);
  if (!noticeIsLive(dto)) throw new Error("This survey is no longer active.");

  const audience = await resolveNoticeAudienceUserIds(
    dto.portals,
    dto.audiences,
    dto.targetUserIds,
  );
  if (!audience.some((id) => id === params.userId)) {
    throw new Error("You are not in the audience for this survey.");
  }

  const questions = dto.surveyQuestions;
  if (!questions.length) throw new Error("This survey has no questions.");

  const normalized: Record<string, unknown> = {};
  for (const question of questions) {
    const raw = params.answers[question.id];
    if (question.required && (raw === undefined || raw === null || raw === "")) {
      throw new Error(`Answer required: ${question.prompt}`);
    }
    if (raw === undefined || raw === null || raw === "") continue;

    if (question.type === "multiple") {
      const list = Array.isArray(raw)
        ? raw.filter((item): item is string => typeof item === "string")
        : typeof raw === "string"
          ? [raw]
          : [];
      if (question.required && !list.length) {
        throw new Error(`Answer required: ${question.prompt}`);
      }
      normalized[question.id] = list;
    } else if (question.type === "rating") {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 1 || n > 5) {
        throw new Error(`Rating must be 1–5 for: ${question.prompt}`);
      }
      normalized[question.id] = n;
    } else if (question.type === "yes_no") {
      const value = String(raw).toLowerCase();
      if (value !== "yes" && value !== "no") {
        throw new Error(`Answer yes or no for: ${question.prompt}`);
      }
      normalized[question.id] = value;
    } else {
      normalized[question.id] = String(raw).trim().slice(0, 2000);
    }
  }

  try {
    const row = await prisma.devSurveyResponse.create({
      data: {
        notice_id: notice.notice_id,
        user_id: params.userId,
        answers: JSON.stringify(normalized),
      },
      select: { response_id: true },
    });
    return { responseId: row.response_id.toString() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/Unique constraint|duplicate/i.test(message)) {
      throw new Error("You already submitted this survey.");
    }
    throw error;
  }
}

export async function countSurveyResponses(noticeId: bigint): Promise<number> {
  return prisma.devSurveyResponse.count({ where: { notice_id: noticeId } });
}
