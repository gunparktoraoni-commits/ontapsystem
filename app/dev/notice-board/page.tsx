"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  CalendarClock,
  Check,
  ClipboardList,
  ImagePlus,
  Megaphone,
  Plus,
  Send,
  Sparkles,
  Trash2,
  Upload,
  UserPlus,
  Wrench,
  X,
} from "lucide-react";
import {
  NOTICE_AUDIENCES,
  NOTICE_CHANNELS,
  NOTICE_PLACEMENTS,
  NOTICE_PORTALS,
  NOTICE_PRIORITIES,
  NOTICE_TYPES,
  SURVEY_QUESTION_TYPES,
  getNoticeTypeMeta,
  type SurveyQuestion,
  type SurveyQuestionTypeId,
} from "@/lib/portal/notice-board";
import { InlineLoader, SectionLoader } from "@/app/components/Loader";
import { ModalPortal } from "@/app/components/ModalPortal";
import { DevKpiStrip } from "@/app/dev/components/DevKpiStrip";
import { useDevEndpoint } from "@/app/dev/hooks/useDevEndpoint";
import { devApiFetch, devApiJson } from "@/app/dev/lib/devApi";
import { showConfirmDialog } from "@/app/components/ConfirmDialog";

type PickerUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  serialId: string | null;
};

type NoticeRow = {
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
  whatsNewAdded: string[];
  whatsNewFixed: string[];
  whatsNewRemoved: string[];
  surveyQuestions: SurveyQuestion[];
  targetUserIds: string[];
  targetUsers?: PickerUser[];
  mediaUrls: string[];
};

type NoticesPayload = {
  notices: NoticeRow[];
  summary: {
    total: number;
    draft: number;
    scheduled: number;
    published: number;
    archived: number;
    byType: Record<string, number>;
  };
};

type ComposerState = {
  title: string;
  summary: string;
  body: string;
  noticeType: string;
  priority: string;
  portals: string[];
  placements: string[];
  audiences: string[];
  channels: string[];
  ctaLabel: string;
  ctaUrl: string;
  surveyUrl: string;
  startsAt: string;
  endsAt: string;
  whatsNewAddedText: string;
  whatsNewFixedText: string;
  whatsNewRemovedText: string;
  surveyQuestions: SurveyQuestion[];
  targetUserIds: string[];
  selectedUsers: PickerUser[];
  mediaUrls: string[];
  mediaUrlDraft: string;
};

const EMPTY_COMPOSER: ComposerState = {
  title: "",
  summary: "",
  body: "",
  noticeType: "whats_new",
  priority: "medium",
  portals: ["user"],
  placements: ["dashboard"],
  audiences: ["all_matched_portals"],
  channels: ["in_app", "email"],
  ctaLabel: "",
  ctaUrl: "",
  surveyUrl: "",
  startsAt: "",
  endsAt: "",
  whatsNewAddedText: "",
  whatsNewFixedText: "",
  whatsNewRemovedText: "",
  surveyQuestions: [],
  targetUserIds: [],
  selectedUsers: [],
  mediaUrls: [],
  mediaUrlDraft: "",
};

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  system_update: Wrench,
  whats_new: Sparkles,
  survey: ClipboardList,
  promotion: Megaphone,
  alert: Bell,
};

const selectClass =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-[#2A4792] focus:ring-2 focus:ring-[#2A4792]/15";

const inputClass =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-[#2A4792] focus:ring-2 focus:ring-[#2A4792]/15";

function linesToList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function listToLines(items: string[] | undefined): string {
  return (items ?? []).join("\n");
}

function parseOptionsText(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildWhatsNewBody(added: string[], fixed: string[], removed: string[]): string {
  const sections: string[] = [];
  if (added.length) {
    sections.push("Added", ...added.map((item) => `• ${item}`));
  }
  if (fixed.length) {
    if (sections.length) sections.push("");
    sections.push("Fixed", ...fixed.map((item) => `• ${item}`));
  }
  if (removed.length) {
    if (sections.length) sections.push("");
    sections.push("Removed", ...removed.map((item) => `• ${item}`));
  }
  return sections.join("\n");
}

function newQuestionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function emptyQuestion(): SurveyQuestion {
  return {
    id: newQuestionId(),
    prompt: "",
    type: "single",
    options: [],
    required: true,
  };
}

function TagList({
  items,
  onRemove,
}: {
  items: Array<{ id: string; label: string }>;
  onRemove: (id: string) => void;
}) {
  if (!items.length) {
    return <p className="text-[11px] text-slate-400">Nothing selected yet.</p>;
  }
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <li
          key={item.id}
          className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700"
        >
          {item.label}
          <button
            type="button"
            onClick={() => onRemove(item.id)}
            className="rounded p-0.5 text-slate-400 hover:bg-white hover:text-rose-600"
            aria-label={`Remove ${item.label}`}
          >
            <X className="h-3 w-3" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function AddSelect({
  label,
  placeholder,
  options,
  onAdd,
}: {
  label: string;
  placeholder: string;
  options: Array<{ id: string; label: string }>;
  onAdd: (id: string) => void;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</span>
      <select
        value=""
        onChange={(event) => {
          const value = event.target.value;
          if (value) onAdd(value);
          event.target.value = "";
        }}
        className={selectClass}
        disabled={options.length === 0}
      >
        <option value="">{options.length ? placeholder : "All options selected"}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Chip({
  active,
  label,
  onClick,
  color,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  color?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-all ${
        active
          ? "text-white shadow-sm"
          : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
      }`}
      style={active ? { backgroundColor: color ?? "#2A4792" } : undefined}
    >
      {label}
    </button>
  );
}

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    draft: "bg-slate-100 text-slate-700",
    scheduled: "bg-sky-50 text-sky-700",
    published: "bg-emerald-50 text-emerald-700",
    archived: "bg-amber-50 text-amber-800",
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${styles[status] ?? styles.draft}`}
    >
      {status}
    </span>
  );
}

function DetailList({
  title,
  items,
  tone = "neutral",
}: {
  title: string;
  items: string[];
  tone?: "added" | "fixed" | "removed" | "neutral";
}) {
  if (!items.length) return null;
  const styles = {
    added: "border-emerald-100 bg-emerald-50 text-emerald-800",
    fixed: "border-sky-100 bg-sky-50 text-sky-800",
    removed: "border-rose-100 bg-rose-50 text-rose-800",
    neutral: "border-slate-100 bg-white text-slate-700",
  }[tone];
  return (
    <div className={`rounded-xl border px-3 py-2 ${styles}`}>
      <p className="text-[10px] font-bold uppercase tracking-wide opacity-80">{title}</p>
      <ul className="mt-1 space-y-1 text-xs">
        {items.map((item) => (
          <li key={`${title}-${item}`}>• {item}</li>
        ))}
      </ul>
    </div>
  );
}

export default function DevNoticeBoardPage() {
  const { data, loading, error, reload } = useDevEndpoint<NoticesPayload>("/api/dev/notices");
  const [portalBoard, setPortalBoard] = useState<"all" | "user" | "admin" | "staff">("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composer, setComposer] = useState<ComposerState>(EMPTY_COMPOSER);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [audiencePreview, setAudiencePreview] = useState<number | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [userQuery, setUserQuery] = useState("");
  const [userResults, setUserResults] = useState<PickerUser[]>([]);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const notices = data?.notices ?? [];

  const filtered = useMemo(() => {
    return notices.filter((notice) => {
      if (portalBoard !== "all" && !notice.portals.includes(portalBoard)) return false;
      if (typeFilter !== "all" && notice.noticeType !== typeFilter) return false;
      if (statusFilter !== "all" && notice.status !== statusFilter) return false;
      return true;
    });
  }, [notices, portalBoard, typeFilter, statusFilter]);

  const selected = filtered.find((item) => item.publicId === selectedId) ?? filtered[0] ?? null;

  useEffect(() => {
    if (selected && selected.publicId !== selectedId) {
      setSelectedId(selected.publicId);
    }
  }, [selected, selectedId]);

  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, []);

  const openCreate = (type?: string) => {
    setEditingId(null);
    setComposer({
      ...EMPTY_COMPOSER,
      noticeType: type ?? "whats_new",
      portals: portalBoard === "all" ? ["user"] : [portalBoard],
      surveyQuestions: type === "survey" ? [emptyQuestion()] : [],
    });
    setAudiencePreview(null);
    setUserQuery("");
    setUserResults([]);
    setComposerOpen(true);
  };

  const openEdit = (notice: NoticeRow) => {
    setEditingId(notice.publicId);
    setComposer({
      title: notice.title,
      summary: notice.summary ?? "",
      body: notice.body,
      noticeType: notice.noticeType,
      priority: notice.priority,
      portals: notice.portals,
      placements: notice.placements,
      audiences: notice.audiences,
      channels: notice.channels,
      ctaLabel: notice.ctaLabel ?? "",
      ctaUrl: notice.ctaUrl ?? "",
      surveyUrl: notice.surveyUrl ?? "",
      startsAt: notice.startsAt ? notice.startsAt.slice(0, 16) : "",
      endsAt: notice.endsAt ? notice.endsAt.slice(0, 16) : "",
      whatsNewAddedText: listToLines(notice.whatsNewAdded),
      whatsNewFixedText: listToLines(notice.whatsNewFixed),
      whatsNewRemovedText: listToLines(notice.whatsNewRemoved),
      surveyQuestions: notice.surveyQuestions?.length
        ? notice.surveyQuestions
        : notice.noticeType === "survey"
          ? [emptyQuestion()]
          : [],
      targetUserIds: notice.targetUserIds ?? [],
      selectedUsers:
        notice.targetUsers && notice.targetUsers.length > 0
          ? notice.targetUsers.map((user) => ({
              id: user.id,
              email: user.email,
              name: user.name,
              role: user.role ?? "",
              serialId: user.serialId ?? null,
            }))
          : (notice.targetUserIds ?? []).map((id) => ({
              id,
              email: "",
              name: `User ${id}`,
              role: "",
              serialId: null,
            })),
      mediaUrls: notice.mediaUrls ?? [],
      mediaUrlDraft: "",
    });
    setAudiencePreview(null);
    setUserQuery("");
    setUserResults([]);
    setComposerOpen(true);

    // If older payloads lacked targetUsers, resolve names/emails for the chips.
    if (
      (notice.targetUserIds?.length ?? 0) > 0 &&
      !(notice.targetUsers && notice.targetUsers.length > 0)
    ) {
      void (async () => {
        try {
          const result = await devApiJson<{ users: PickerUser[] }>(
            `/api/dev/notices/users?ids=${encodeURIComponent(notice.targetUserIds.join(","))}`,
          );
          if (!result.ok || !result.data?.users?.length) return;
          setComposer((prev) => ({
            ...prev,
            selectedUsers: result.data!.users,
          }));
        } catch {
          // keep placeholders
        }
      })();
    }
  };

  const searchUsers = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setUserResults([]);
      return;
    }
    setSearchingUsers(true);
    try {
      const result = await devApiJson<{ users: PickerUser[] }>(
        `/api/dev/notices/users?q=${encodeURIComponent(q.trim())}`,
      );
      if (!result.ok) {
        throw new Error(result.error ?? "User search failed.");
      }
      setUserResults(result.data?.users ?? []);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "User search failed.");
      setUserResults([]);
    } finally {
      setSearchingUsers(false);
    }
  }, []);

  const onUserQueryChange = (value: string) => {
    setUserQuery(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      void searchUsers(value);
    }, 280);
  };

  const pickUser = (user: PickerUser) => {
    setComposer((prev) => {
      if (prev.targetUserIds.includes(user.id)) return prev;
      return {
        ...prev,
        targetUserIds: [...prev.targetUserIds, user.id],
        selectedUsers: [...prev.selectedUsers.filter((item) => item.id !== user.id), user],
      };
    });
    setUserQuery("");
    setUserResults([]);
  };

  const removeUser = (userId: string) => {
    setComposer((prev) => ({
      ...prev,
      targetUserIds: prev.targetUserIds.filter((id) => id !== userId),
      selectedUsers: prev.selectedUsers.filter((user) => user.id !== userId),
    }));
  };

  const uploadMediaFile = async (file: File) => {
    setUploadingMedia(true);
    setMessage(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("context", "notice");

      const response = await devApiFetch("/api/media/upload", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!response.ok || !payload.url) {
        throw new Error(payload.error ?? "Media upload failed.");
      }
      setComposer((prev) => ({
        ...prev,
        mediaUrls: prev.mediaUrls.includes(payload.url!)
          ? prev.mediaUrls
          : [...prev.mediaUrls, payload.url!].slice(0, 12),
      }));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Media upload failed.");
    } finally {
      setUploadingMedia(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const addMediaUrl = () => {
    const url = composer.mediaUrlDraft.trim();
    if (!url) return;
    setComposer((prev) => ({
      ...prev,
      mediaUrls: prev.mediaUrls.includes(url) ? prev.mediaUrls : [...prev.mediaUrls, url].slice(0, 12),
      mediaUrlDraft: "",
    }));
  };

  const previewAudience = async () => {
    setPreviewing(true);
    try {
      const result = await devApiJson<{ count: number }>("/api/dev/notices", {
        method: "POST",
        body: {
          action: "preview_audience",
          portals: composer.portals,
          audiences: composer.audiences,
          targetUserIds: composer.targetUserIds,
        },
      });
      if (!result.ok) {
        throw new Error(result.error ?? "Preview failed.");
      }
      setAudiencePreview(Number(result.data?.count ?? 0));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Preview failed.");
    } finally {
      setPreviewing(false);
    }
  };

  const saveComposer = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const whatsNewAdded = linesToList(composer.whatsNewAddedText);
      const whatsNewFixed = linesToList(composer.whatsNewFixedText);
      const whatsNewRemoved = linesToList(composer.whatsNewRemovedText);
      let body = composer.body.trim();
      if (!body && composer.noticeType === "whats_new") {
        body = buildWhatsNewBody(whatsNewAdded, whatsNewFixed, whatsNewRemoved);
      }

      const payloadBody = {
        title: composer.title,
        summary: composer.summary,
        body,
        noticeType: composer.noticeType,
        priority: composer.priority,
        portals: composer.portals,
        placements: composer.placements,
        audiences: composer.audiences,
        channels: composer.channels,
        ctaLabel: composer.ctaLabel || null,
        ctaUrl: composer.ctaUrl || null,
        surveyUrl: composer.surveyUrl || null,
        startsAt: composer.startsAt || null,
        endsAt: composer.endsAt || null,
        whatsNewAdded,
        whatsNewFixed,
        whatsNewRemoved,
        surveyQuestions: composer.surveyQuestions.map((question) => ({
          ...question,
          options:
            question.type === "single" || question.type === "multiple"
              ? parseOptionsText((question.options ?? []).join("\n"))
              : undefined,
        })),
        targetUserIds: composer.targetUserIds,
        mediaUrls: composer.mediaUrls,
      };

      type SaveResult = {
        publicId?: string;
        delivery?: { inApp?: number; email?: number; skipped?: number } | null;
      };

      const result = editingId
        ? await devApiJson<SaveResult>(`/api/dev/notices/${encodeURIComponent(editingId)}`, {
            method: "PATCH",
            body: { ...payloadBody, notify: true },
          })
        : await devApiJson<SaveResult>("/api/dev/notices", {
            method: "POST",
            body: { ...payloadBody, notify: true },
          });

      if (!result.ok) {
        throw new Error(result.error ?? "Failed to save notice.");
      }
      setComposerOpen(false);
      const delivery = result.data?.delivery;
      const willNotifyTargets =
        composer.targetUserIds.length > 0 &&
        (composer.channels.includes("email") || composer.channels.includes("in_app"));
      if (delivery && (delivery.email ?? 0) + (delivery.inApp ?? 0) > 0) {
        setMessage(
          `${editingId ? "Notice updated" : "Notice created"}. Email queued: ${delivery.email ?? 0}, in-app: ${delivery.inApp ?? 0}, skipped: ${delivery.skipped ?? 0}.`,
        );
      } else if (willNotifyTargets) {
        setMessage(
          `${editingId ? "Notice updated" : "Notice created"}. No emails were queued (selected users may be inactive or unsubscribed).`,
        );
      } else {
        setMessage(editingId ? "Notice updated." : "Draft saved.");
      }
      await reload();
      const publicId = result.data?.publicId;
      if (publicId) setSelectedId(publicId);
      else if (editingId) setSelectedId(editingId);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to save notice.");
    } finally {
      setSaving(false);
    }
  };

  const publishSelected = async (notice: NoticeRow) => {
    if (
      !(await showConfirmDialog({
        title: "Publish this notice?",
        message: `"${notice.title}" will go live and notify the selected audience by in-app message and email.`,
        confirmLabel: "Publish notice",
        variant: "primary",
      }))
    ) {
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const result = await devApiJson<{
        delivery?: { inApp?: number; email?: number; skipped?: number };
      }>(`/api/dev/notices/${encodeURIComponent(notice.publicId)}`, {
        method: "PATCH",
        body: { action: "publish", notify: true },
      });
      if (!result.ok) {
        throw new Error(result.error ?? "Publish failed.");
      }
      const delivery = result.data?.delivery;
      setMessage(
        `Published. In-app: ${delivery?.inApp ?? 0}, email queued: ${delivery?.email ?? 0}, skipped: ${delivery?.skipped ?? 0}.`,
      );
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Publish failed.");
    } finally {
      setSaving(false);
    }
  };

  const archiveSelected = async (notice: NoticeRow) => {
    setSaving(true);
    try {
      const result = await devApiJson(`/api/dev/notices/${encodeURIComponent(notice.publicId)}`, {
        method: "PATCH",
        body: { action: "archive" },
      });
      if (!result.ok) {
        throw new Error(result.error ?? "Archive failed.");
      }
      setMessage("Notice archived.");
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Archive failed.");
    } finally {
      setSaving(false);
    }
  };

  const deleteSelected = async (notice: NoticeRow) => {
    if (!(await showConfirmDialog({
      title: "Delete this notice?",
      message: `"${notice.title}" will be soft-deleted and hidden from the notice board.`,
      confirmLabel: "Delete notice",
      variant: "danger",
    }))) return;
    setSaving(true);
    try {
      const result = await devApiJson(`/api/dev/notices/${encodeURIComponent(notice.publicId)}`, {
        method: "DELETE",
      });
      if (!result.ok) {
        throw new Error(result.error ?? "Delete failed.");
      }
      setSelectedId(null);
      setMessage("Notice removed.");
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SectionLoader text="Loading..." />
    );
  }

  if (!data) {
    return (
      <div className="rounded-2xl bg-white p-6 text-sm text-red-600 shadow-sm">
        {error ?? "Failed to load notice board."}
      </div>
    );
  }

  const typeMeta = getNoticeTypeMeta(composer.noticeType);
  const availablePlacements = NOTICE_PLACEMENTS.filter((placement) =>
    composer.portals.some((portal) => (placement.portals as readonly string[]).includes(portal)),
  );
  const showCustomUsers = composer.audiences.includes("custom_users");
  const needsOptions = (type: SurveyQuestionTypeId) => type === "single" || type === "multiple";

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-3xl border border-slate-200 bg-[#0F1C3F] px-6 py-7 text-white shadow-sm">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background:
              "radial-gradient(circle at 12% 20%, rgba(107,186,235,0.45), transparent 42%), radial-gradient(circle at 88% 10%, rgba(251,191,36,0.28), transparent 36%)",
          }}
        />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#9EC9EA]">
              Comms studio
            </p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">Notice Board</h1>
            <p className="mt-2 text-sm text-white/75">
              Compose system updates, what&apos;s-new cards, surveys, and promotions. Target by portal,
              page surface, and audience — then notify everyone in-app and by email when you publish.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {NOTICE_TYPES.slice(0, 4).map((type) => (
              <button
                key={type.id}
                type="button"
                onClick={() => openCreate(type.id)}
                className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-2 text-xs font-semibold text-white ring-1 ring-white/15 transition hover:bg-white/20"
              >
                <Plus className="h-3.5 w-3.5" />
                {type.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <DevKpiStrip
        items={[
          { label: "Total", value: data.summary.total },
          { label: "Published", value: data.summary.published, tone: "success" },
          { label: "Drafts", value: data.summary.draft },
          {
            label: "What's new",
            value: data.summary.byType.whats_new ?? 0,
          },
        ]}
      />

      {message ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
          {message}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[220px_minmax(0,1fr)_320px]">
        <aside className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Boards</p>
            <div className="mt-3 space-y-1.5">
              {[
                { id: "all", label: "All portals" },
                ...NOTICE_PORTALS.map((portal) => ({ id: portal.id, label: portal.label })),
              ].map((board) => (
                <button
                  key={board.id}
                  type="button"
                  onClick={() => setPortalBoard(board.id as typeof portalBoard)}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition ${
                    portalBoard === board.id
                      ? "bg-[#2A4792] text-white"
                      : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {board.label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Type</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Chip active={typeFilter === "all"} label="All" onClick={() => setTypeFilter("all")} />
              {NOTICE_TYPES.map((type) => (
                <Chip
                  key={type.id}
                  active={typeFilter === type.id}
                  label={type.label}
                  color={type.accent}
                  onClick={() => setTypeFilter(type.id)}
                />
              ))}
            </div>
            <p className="mt-4 text-[11px] font-bold uppercase tracking-wide text-slate-400">Status</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {["all", "draft", "scheduled", "published", "archived"].map((status) => (
                <Chip
                  key={status}
                  active={statusFilter === status}
                  label={status}
                  onClick={() => setStatusFilter(status)}
                />
              ))}
            </div>
          </div>
        </aside>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                {filtered.length} notice{filtered.length === 1 ? "" : "s"}
              </h2>
              <p className="text-xs text-slate-500">Select a card to inspect targeting and delivery.</p>
            </div>
            <button
              type="button"
              onClick={() => openCreate()}
              className="inline-flex items-center gap-2 rounded-xl bg-[#2A4792] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#243f82]"
            >
              <Plus className="h-4 w-4" />
              Compose
            </button>
          </div>

          {filtered.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
              <Sparkles className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-3 text-sm font-semibold text-slate-800">No notices on this board yet</p>
              <p className="mt-1 text-xs text-slate-500">
                Start with a what&apos;s-new card or a maintenance update for a specific portal.
              </p>
            </div>
          ) : (
            filtered.map((notice) => {
              const Icon = TYPE_ICONS[notice.noticeType] ?? Bell;
              const active = selected?.publicId === notice.publicId;
              return (
                <button
                  key={notice.publicId}
                  type="button"
                  onClick={() => setSelectedId(notice.publicId)}
                  className={`w-full rounded-2xl border px-4 py-4 text-left transition ${
                    active
                      ? "border-[#2A4792]/40 bg-white shadow-md ring-1 ring-[#2A4792]/20"
                      : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white"
                      style={{ backgroundColor: notice.accentColor ?? "#2A4792" }}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-bold text-slate-900">{notice.title}</p>
                        <StatusPill status={notice.status} />
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-slate-500">
                        {notice.summary || notice.body}
                      </p>
                      {notice.noticeType === "whats_new" ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {(notice.whatsNewAdded?.length ?? 0) > 0 ? (
                            <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                              +{notice.whatsNewAdded.length} added
                            </span>
                          ) : null}
                          {(notice.whatsNewFixed?.length ?? 0) > 0 ? (
                            <span className="rounded-md bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">
                              {notice.whatsNewFixed.length} fixed
                            </span>
                          ) : null}
                          {(notice.whatsNewRemoved?.length ?? 0) > 0 ? (
                            <span className="rounded-md bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">
                              {notice.whatsNewRemoved.length} removed
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {notice.portals.map((portal) => (
                          <span
                            key={portal}
                            className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600"
                          >
                            {portal}
                          </span>
                        ))}
                        <span className="rounded-md bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                          {notice.placements.length} surface
                          {notice.placements.length === 1 ? "" : "s"}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </section>

        <aside className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          {!selected ? (
            <div className="flex h-full min-h-64 flex-col items-center justify-center text-center">
              <CalendarClock className="h-8 w-8 text-slate-300" />
              <p className="mt-3 text-sm font-semibold text-slate-700">Pick a notice</p>
              <p className="mt-1 text-xs text-slate-500">Delivery stats and targeting appear here.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <StatusPill status={selected.status} />
                <h3 className="mt-2 text-lg font-bold text-slate-900">{selected.title}</h3>
                <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {selected.noticeTypeLabel} · {selected.priority}
                </p>
              </div>
              <p className="text-sm whitespace-pre-wrap text-slate-600">{selected.body}</p>

              {(selected.whatsNewAdded?.length ||
                selected.whatsNewFixed?.length ||
                selected.whatsNewRemoved?.length) ? (
                <div className="space-y-3 rounded-2xl bg-slate-50 p-3">
                  <DetailList title="Added" items={selected.whatsNewAdded ?? []} tone="added" />
                  <DetailList title="Fixed" items={selected.whatsNewFixed ?? []} tone="fixed" />
                  <DetailList title="Removed" items={selected.whatsNewRemoved ?? []} tone="removed" />
                </div>
              ) : null}

              {selected.noticeType === "survey" ? (
                <div className="rounded-2xl bg-slate-50 p-3">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    Survey
                  </p>
                  <p className="mt-1 text-xs text-slate-700">
                    {(selected.surveyQuestions ?? []).length} question
                    {(selected.surveyQuestions ?? []).length === 1 ? "" : "s"}
                  </p>
                </div>
              ) : null}

              {(selected.mediaUrls ?? []).length > 0 ? (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    Media
                  </p>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {selected.mediaUrls.map((url) => (
                      <a
                        key={url}
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="block overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
                      >
                        <img src={url} alt="" className="h-16 w-full object-cover" />
                      </a>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="rounded-2xl bg-slate-50 p-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                  Surfaces
                </p>
                <p className="mt-1 text-xs text-slate-700">{selected.placements.join(", ")}</p>
                <p className="mt-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                  Audience
                </p>
                <p className="mt-1 text-xs text-slate-700">{selected.audiences.join(", ")}</p>
                {(selected.targetUsers ?? []).length > 0 ? (
                  <ul className="mt-2 space-y-1.5">
                    {selected.targetUsers!.map((user) => (
                      <li
                        key={user.id}
                        className="rounded-lg bg-white px-2.5 py-1.5 text-xs text-slate-700 ring-1 ring-slate-200"
                      >
                        <span className="font-semibold">{user.name}</span>
                        <span className="text-slate-400"> · {user.email}</span>
                      </li>
                    ))}
                  </ul>
                ) : (selected.targetUserIds ?? []).length > 0 ? (
                  <p className="mt-1 text-xs text-slate-500">
                    {selected.targetUserIds.length} selected user
                    {selected.targetUserIds.length === 1 ? "" : "s"}
                  </p>
                ) : null}
                <p className="mt-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                  Channels
                </p>
                <p className="mt-1 text-xs text-slate-700">{selected.channels.join(", ")}</p>
              </div>

              {selected.status === "published" ? (
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-xl bg-emerald-50 px-2 py-3 text-center">
                    <p className="text-lg font-bold text-emerald-700">{selected.notifyInApp}</p>
                    <p className="text-[10px] font-semibold uppercase text-emerald-700/80">In-app</p>
                  </div>
                  <div className="rounded-xl bg-sky-50 px-2 py-3 text-center">
                    <p className="text-lg font-bold text-sky-700">{selected.notifyEmail}</p>
                    <p className="text-[10px] font-semibold uppercase text-sky-700/80">Email</p>
                  </div>
                  <div className="rounded-xl bg-slate-100 px-2 py-3 text-center">
                    <p className="text-lg font-bold text-slate-700">{selected.notifySkipped}</p>
                    <p className="text-[10px] font-semibold uppercase text-slate-500">Skipped</p>
                  </div>
                </div>
              ) : null}

              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => openEdit(selected)}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Edit
                </button>
                {selected.status !== "published" && selected.status !== "archived" ? (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void publishSelected(selected)}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#2A4792] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#243f82] disabled:opacity-60"
                  >
                    <Send className="h-4 w-4" />
                    Publish & notify
                  </button>
                ) : null}
                {selected.status !== "archived" ? (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void archiveSelected(selected)}
                    className="rounded-xl px-4 py-2.5 text-sm font-semibold text-amber-700 hover:bg-amber-50"
                  >
                    Archive
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void deleteSelected(selected)}
                  className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </button>
              </div>
            </div>
          )}
        </aside>
      </div>

      <ModalPortal isOpen={composerOpen} onClose={() => !saving && setComposerOpen(false)}>
        <div className="mx-3 flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-[#F7F8FC] shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                {editingId ? "Edit notice" : "Compose notice"}
              </p>
              <h2 className="text-lg font-bold text-slate-900">{typeMeta.label}</h2>
            </div>
            <button
              type="button"
              onClick={() => setComposerOpen(false)}
              aria-label="Close composer"
              className="rounded-full p-2 text-slate-400 hover:bg-slate-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid min-h-0 flex-1 gap-0 overflow-y-auto lg:grid-cols-[1.15fr_0.85fr]">
            <div className="space-y-5 p-5">
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-slate-600">Type</span>
                <select
                  value={composer.noticeType}
                  onChange={(event) => {
                    const nextType = event.target.value;
                    setComposer((prev) => ({
                      ...prev,
                      noticeType: nextType,
                      surveyQuestions:
                        nextType === "survey" && prev.surveyQuestions.length === 0
                          ? [emptyQuestion()]
                          : prev.surveyQuestions,
                    }));
                  }}
                  className={selectClass}
                >
                  {NOTICE_TYPES.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-slate-600">Title</span>
                <input
                  value={composer.title}
                  onChange={(event) => setComposer((prev) => ({ ...prev, title: event.target.value }))}
                  className={inputClass}
                  placeholder="e.g. Scheduled maintenance this Sunday"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-slate-600">Short summary</span>
                <input
                  value={composer.summary}
                  onChange={(event) =>
                    setComposer((prev) => ({ ...prev, summary: event.target.value }))
                  }
                  className={inputClass}
                  placeholder="Shown on cards and in notification previews"
                />
              </label>

              {composer.noticeType === "whats_new" ? (
                <div className="space-y-3">
                  <label className="block space-y-1.5">
                    <span className="text-xs font-semibold text-slate-600">
                      Added <span className="font-normal text-slate-400">(one per line)</span>
                    </span>
                    <textarea
                      value={composer.whatsNewAddedText}
                      onChange={(event) =>
                        setComposer((prev) => ({ ...prev, whatsNewAddedText: event.target.value }))
                      }
                      rows={3}
                      className={inputClass}
                      placeholder={"New dashboard filters\nBulk export"}
                    />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-xs font-semibold text-slate-600">
                      Fixed <span className="font-normal text-slate-400">(one per line)</span>
                    </span>
                    <textarea
                      value={composer.whatsNewFixedText}
                      onChange={(event) =>
                        setComposer((prev) => ({ ...prev, whatsNewFixedText: event.target.value }))
                      }
                      rows={3}
                      className={inputClass}
                      placeholder={"Login timeout on Safari\nBroken CTA on mobile"}
                    />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-xs font-semibold text-slate-600">
                      Removed <span className="font-normal text-slate-400">(one per line)</span>
                    </span>
                    <textarea
                      value={composer.whatsNewRemovedText}
                      onChange={(event) =>
                        setComposer((prev) => ({
                          ...prev,
                          whatsNewRemovedText: event.target.value,
                        }))
                      }
                      rows={3}
                      className={inputClass}
                      placeholder={"Legacy widget\nDeprecated API banner"}
                    />
                  </label>
                </div>
              ) : null}

              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-slate-600">
                  Body
                  {composer.noticeType === "whats_new" ? (
                    <span className="ml-1 font-normal text-slate-400">
                      (optional — auto-built from lists if empty)
                    </span>
                  ) : null}
                </span>
                <textarea
                  value={composer.body}
                  onChange={(event) => setComposer((prev) => ({ ...prev, body: event.target.value }))}
                  rows={composer.noticeType === "whats_new" ? 4 : 6}
                  className={inputClass}
                  placeholder="Full notice copy…"
                />
              </label>

              {composer.noticeType === "survey" ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold text-slate-600">Questions</p>
                    <button
                      type="button"
                      onClick={() =>
                        setComposer((prev) => ({
                          ...prev,
                          surveyQuestions: [...prev.surveyQuestions, emptyQuestion()],
                        }))
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add question
                    </button>
                  </div>

                  {composer.surveyQuestions.map((question, index) => (
                    <div
                      key={question.id}
                      className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                          Question {index + 1}
                        </p>
                        <button
                          type="button"
                          onClick={() =>
                            setComposer((prev) => ({
                              ...prev,
                              surveyQuestions: prev.surveyQuestions.filter(
                                (item) => item.id !== question.id,
                              ),
                            }))
                          }
                          className="rounded-lg p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          aria-label="Remove question"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      <label className="block space-y-1.5">
                        <span className="text-xs font-semibold text-slate-600">Prompt</span>
                        <input
                          value={question.prompt}
                          onChange={(event) => {
                            const prompt = event.target.value;
                            setComposer((prev) => ({
                              ...prev,
                              surveyQuestions: prev.surveyQuestions.map((item) =>
                                item.id === question.id ? { ...item, prompt } : item,
                              ),
                            }));
                          }}
                          className={inputClass}
                          placeholder="How satisfied are you with…?"
                        />
                      </label>

                      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                        <label className="block space-y-1.5">
                          <span className="text-xs font-semibold text-slate-600">Type</span>
                          <select
                            value={question.type}
                            onChange={(event) => {
                              const type = event.target.value as SurveyQuestionTypeId;
                              setComposer((prev) => ({
                                ...prev,
                                surveyQuestions: prev.surveyQuestions.map((item) =>
                                  item.id === question.id
                                    ? {
                                        ...item,
                                        type,
                                        options: needsOptions(type) ? item.options ?? [] : undefined,
                                      }
                                    : item,
                                ),
                              }));
                            }}
                            className={selectClass}
                          >
                            {SURVEY_QUESTION_TYPES.map((type) => (
                              <option key={type.id} value={type.id}>
                                {type.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="flex items-end gap-2 pb-2.5 text-xs font-semibold text-slate-600">
                          <input
                            type="checkbox"
                            checked={Boolean(question.required)}
                            onChange={(event) => {
                              const required = event.target.checked;
                              setComposer((prev) => ({
                                ...prev,
                                surveyQuestions: prev.surveyQuestions.map((item) =>
                                  item.id === question.id ? { ...item, required } : item,
                                ),
                              }));
                            }}
                            className="h-4 w-4 rounded border-slate-300 text-[#2A4792] focus:ring-[#2A4792]"
                          />
                          Required
                        </label>
                      </div>

                      {needsOptions(question.type) ? (
                        <label className="block space-y-1.5">
                          <span className="text-xs font-semibold text-slate-600">
                            Options{" "}
                            <span className="font-normal text-slate-400">
                              (comma or newline separated)
                            </span>
                          </span>
                          <textarea
                            value={(question.options ?? []).join("\n")}
                            onChange={(event) => {
                              const options = event.target.value.split(/\r?\n/);
                              setComposer((prev) => ({
                                ...prev,
                                surveyQuestions: prev.surveyQuestions.map((item) =>
                                  item.id === question.id ? { ...item, options } : item,
                                ),
                              }));
                            }}
                            rows={3}
                            className={inputClass}
                            placeholder={"Excellent\nGood\nFair\nPoor"}
                          />
                        </label>
                      ) : null}
                    </div>
                  ))}

                  <label className="block space-y-1.5">
                    <span className="text-xs font-semibold text-slate-600">
                      External survey URL{" "}
                      <span className="font-normal text-slate-400">(optional)</span>
                    </span>
                    <input
                      value={composer.surveyUrl}
                      onChange={(event) =>
                        setComposer((prev) => ({ ...prev, surveyUrl: event.target.value }))
                      }
                      className={inputClass}
                      placeholder="https://forms…"
                    />
                  </label>
                </div>
              ) : null}

              {composer.noticeType === "promotion" ? (
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-slate-600">Promotion media</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={uploadingMedia}
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      {uploadingMedia ? "Uploading…" : "Upload file"}
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*,video/*"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void uploadMediaFile(file);
                      }}
                    />
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={composer.mediaUrlDraft}
                      onChange={(event) =>
                        setComposer((prev) => ({ ...prev, mediaUrlDraft: event.target.value }))
                      }
                      className={inputClass}
                      placeholder="Or paste a media URL…"
                    />
                    <button
                      type="button"
                      onClick={addMediaUrl}
                      aria-label="Add media"
                      className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <ImagePlus className="h-4 w-4" />
                    </button>
                  </div>
                  {composer.mediaUrls.length > 0 ? (
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                      {composer.mediaUrls.map((url) => (
                        <div
                          key={url}
                          className="group relative overflow-hidden rounded-lg border border-slate-200 bg-white"
                        >
                          <img src={url} alt="" className="h-20 w-full object-cover" />
                          <button
                            type="button"
                            onClick={() =>
                              setComposer((prev) => ({
                                ...prev,
                                mediaUrls: prev.mediaUrls.filter((item) => item !== url),
                              }))
                            }
                            className="absolute right-1 top-1 rounded-full bg-white/90 p-1 text-slate-500 opacity-0 shadow-sm transition group-hover:opacity-100"
                            aria-label="Remove media"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold text-slate-600">CTA label</span>
                  <input
                    value={composer.ctaLabel}
                    onChange={(event) =>
                      setComposer((prev) => ({ ...prev, ctaLabel: event.target.value }))
                    }
                    className={inputClass}
                    placeholder="Learn more"
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold text-slate-600">CTA URL</span>
                  <input
                    value={composer.ctaUrl}
                    onChange={(event) =>
                      setComposer((prev) => ({ ...prev, ctaUrl: event.target.value }))
                    }
                    className={inputClass}
                    placeholder="https://…"
                  />
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold text-slate-600">Starts</span>
                  <input
                    type="datetime-local"
                    value={composer.startsAt}
                    onChange={(event) =>
                      setComposer((prev) => ({ ...prev, startsAt: event.target.value }))
                    }
                    className={inputClass}
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold text-slate-600">Ends</span>
                  <input
                    type="datetime-local"
                    value={composer.endsAt}
                    onChange={(event) =>
                      setComposer((prev) => ({ ...prev, endsAt: event.target.value }))
                    }
                    className={inputClass}
                  />
                </label>
              </div>
            </div>

            <div className="space-y-4 border-t border-slate-200 bg-white p-5 lg:border-l lg:border-t-0">
              <AddSelect
                label="Portals"
                placeholder="Add a portal…"
                options={NOTICE_PORTALS.filter((portal) => !composer.portals.includes(portal.id)).map(
                  (portal) => ({ id: portal.id, label: portal.label }),
                )}
                onAdd={(id) =>
                  setComposer((prev) => ({
                    ...prev,
                    portals: prev.portals.includes(id) ? prev.portals : [...prev.portals, id],
                  }))
                }
              />
              <TagList
                items={composer.portals.map((id) => ({
                  id,
                  label: NOTICE_PORTALS.find((portal) => portal.id === id)?.label ?? id,
                }))}
                onRemove={(id) =>
                  setComposer((prev) => {
                    const portals = prev.portals.filter((item) => item !== id);
                    return {
                      ...prev,
                      portals,
                      placements: prev.placements.filter((placementId) => {
                        const meta = NOTICE_PLACEMENTS.find((item) => item.id === placementId);
                        return meta
                          ? portals.some((portal) =>
                              (meta.portals as readonly string[]).includes(portal),
                            )
                          : false;
                      }),
                    };
                  })
                }
              />

              <AddSelect
                label="Where it appears"
                placeholder="Add a page surface…"
                options={availablePlacements
                  .filter((placement) => !composer.placements.includes(placement.id))
                  .map((placement) => ({ id: placement.id, label: placement.label }))}
                onAdd={(id) =>
                  setComposer((prev) => ({
                    ...prev,
                    placements: prev.placements.includes(id)
                      ? prev.placements
                      : [...prev.placements, id],
                  }))
                }
              />
              <TagList
                items={composer.placements.map((id) => ({
                  id,
                  label: NOTICE_PLACEMENTS.find((item) => item.id === id)?.label ?? id,
                }))}
                onRemove={(id) =>
                  setComposer((prev) => ({
                    ...prev,
                    placements: prev.placements.filter((item) => item !== id),
                  }))
                }
              />

              <AddSelect
                label="Audience"
                placeholder="Add an audience segment…"
                options={NOTICE_AUDIENCES.filter(
                  (audience) => !composer.audiences.includes(audience.id),
                ).map((audience) => ({
                  id: audience.id,
                  label: `${audience.group}: ${audience.label}`,
                }))}
                onAdd={(id) =>
                  setComposer((prev) => ({
                    ...prev,
                    audiences: prev.audiences.includes(id)
                      ? prev.audiences
                      : [...prev.audiences, id],
                  }))
                }
              />
              <TagList
                items={composer.audiences.map((id) => ({
                  id,
                  label: NOTICE_AUDIENCES.find((item) => item.id === id)?.label ?? id,
                }))}
                onRemove={(id) =>
                  setComposer((prev) => ({
                    ...prev,
                    audiences: prev.audiences.filter((item) => item !== id),
                  }))
                }
              />

              {showCustomUsers ? (
                <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    Specific users
                  </p>
                  <div className="relative">
                    <input
                      value={userQuery}
                      onChange={(event) => onUserQueryChange(event.target.value)}
                      className={inputClass}
                      placeholder="Search by name, email, or serial…"
                    />
                    {searchingUsers ? (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">
                        …
                      </span>
                    ) : null}
                  </div>
                  {userResults.length > 0 ? (
                    <ul className="max-h-36 overflow-y-auto rounded-xl border border-slate-200 bg-white">
                      {userResults.map((user) => (
                        <li key={user.id}>
                          <button
                            type="button"
                            onClick={() => pickUser(user)}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-slate-50"
                          >
                            <UserPlus className="h-3.5 w-3.5 shrink-0 text-[#2A4792]" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-semibold text-slate-800">
                                {user.name}
                              </span>
                              <span className="block truncate text-slate-500">{user.email}</span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {composer.selectedUsers.length > 0 ? (
                    <ul className="space-y-1.5">
                      {composer.selectedUsers.map((user) => (
                        <li
                          key={user.id}
                          className="flex items-center justify-between gap-2 rounded-lg bg-white px-2.5 py-1.5 text-xs ring-1 ring-slate-200"
                        >
                          <span className="min-w-0 truncate text-slate-700">
                            <span className="font-semibold">{user.name}</span>
                            {user.email ? (
                              <span className="text-slate-400"> · {user.email}</span>
                            ) : null}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeUser(user.id)}
                            className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                            aria-label={`Remove ${user.name}`}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[11px] text-slate-500">No users selected yet.</p>
                  )}
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => void previewAudience()}
                disabled={previewing}
                className="text-xs font-semibold text-[#2A4792] hover:underline disabled:opacity-60"
              >
                {previewing
                  ? "Counting…"
                  : audiencePreview == null
                    ? "Preview audience size"
                    : `≈ ${audiencePreview} recipients`}
              </button>

              <AddSelect
                label="Notify via"
                placeholder="Add a channel…"
                options={NOTICE_CHANNELS.filter(
                  (channel) => !composer.channels.includes(channel.id),
                ).map((channel) => ({ id: channel.id, label: channel.label }))}
                onAdd={(id) =>
                  setComposer((prev) => ({
                    ...prev,
                    channels: prev.channels.includes(id)
                      ? prev.channels
                      : [...prev.channels, id],
                  }))
                }
              />
              <TagList
                items={composer.channels.map((id) => ({
                  id,
                  label: NOTICE_CHANNELS.find((item) => item.id === id)?.label ?? id,
                }))}
                onRemove={(id) =>
                  setComposer((prev) => ({
                    ...prev,
                    channels: prev.channels.filter((item) => item !== id),
                  }))
                }
              />

              <label className="block space-y-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                  Priority
                </span>
                <select
                  value={composer.priority}
                  onChange={(event) =>
                    setComposer((prev) => ({ ...prev, priority: event.target.value }))
                  }
                  className={selectClass}
                >
                  {NOTICE_PRIORITIES.map((priority) => (
                    <option key={priority} value={priority}>
                      {priority.charAt(0).toUpperCase() + priority.slice(1)}
                    </option>
                  ))}
                </select>
              </label>

              <div
                className="rounded-2xl p-4 text-white"
                style={{ background: `linear-gradient(135deg, ${typeMeta.accent}, #0F1C3F)` }}
              >
                <p className="text-[10px] font-bold uppercase tracking-wide text-white/70">
                  Live preview
                </p>
                <p className="mt-2 text-sm font-bold">{composer.title || "Untitled notice"}</p>
                <p className="mt-1 text-xs text-white/80">
                  {composer.summary ||
                    (composer.noticeType === "whats_new"
                      ? "Changelog sections render on the card"
                      : composer.body) ||
                    "Your summary appears here."}
                </p>
                {composer.noticeType === "whats_new" ? (
                  <div className="mt-3 space-y-1 text-[11px] text-white/90">
                    {linesToList(composer.whatsNewAddedText).length ? (
                      <p>Added: {linesToList(composer.whatsNewAddedText).length}</p>
                    ) : null}
                    {linesToList(composer.whatsNewFixedText).length ? (
                      <p>Fixed: {linesToList(composer.whatsNewFixedText).length}</p>
                    ) : null}
                    {linesToList(composer.whatsNewRemovedText).length ? (
                      <p>Removed: {linesToList(composer.whatsNewRemovedText).length}</p>
                    ) : null}
                  </div>
                ) : null}
                {composer.noticeType === "survey" ? (
                  <p className="mt-3 text-[11px] text-white/90">
                    {composer.surveyQuestions.length} question
                    {composer.surveyQuestions.length === 1 ? "" : "s"}
                  </p>
                ) : null}
                {composer.noticeType === "promotion" && composer.mediaUrls.length ? (
                  <p className="mt-3 text-[11px] text-white/90">
                    {composer.mediaUrls.length} media attachment
                    {composer.mediaUrls.length === 1 ? "" : "s"}
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-slate-200 bg-white px-5 py-4">
            <button
              type="button"
              disabled={saving}
              onClick={() => setComposerOpen(false)}
              className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void saveComposer()}
              className="inline-flex items-center gap-2 rounded-xl bg-[#2A4792] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#243f82] disabled:opacity-60"
            >
              <Check className="h-4 w-4" />
              {saving
                ? "Saving…"
                : editingId
                  ? composer.targetUserIds.length > 0
                    ? "Save & notify"
                    : "Save changes"
                  : composer.targetUserIds.length > 0
                    ? "Create & notify"
                    : "Save draft"}
            </button>
          </div>
        </div>
      </ModalPortal>
    </div>
  );
}
