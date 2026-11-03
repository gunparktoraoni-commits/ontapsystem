"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, Mail, Plus, Send, Trash2, Upload, X } from "lucide-react";
import {
  PortalBadge,
  PortalDataTable,
  PortalEmptyState,
  PortalModal,
  PortalTableBody,
  PortalTableCell,
  PortalTableHead,
  PortalTableHeaderCell,
  PortalTableRow,
} from "../../components/ui";
import { fmtDate, manageContentRequest, safeString } from "./manage-content-shared";
import PromoEmailContentsEditor from "./PromoEmailContentsEditor";
import { toServableMediaSrc } from "@/app/lib/portfolioDisplay";

/** True when HTML/plain content has no meaningful text (ignores empty tags / &nbsp;). */
function isContentsEmpty(content: string): boolean {
  return (
    content
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&#160;/gi, " ")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim().length === 0
  );
}

type Subscriber = {
  user_id: string;
  email: string;
  name: string;
  role: string;
  tier: string;
  opted_in_at: string;
};

type Campaign = {
  id: string;
  title: string;
  content: string;
  image_urls?: string[];
  audience: string[];
  status: string;
  recipient_count: number;
  sent_at: string | null;
  created_at: string;
};

const AUDIENCE_OPTIONS = [
  { value: "basic", label: "Basic BizCard Users" },
  { value: "standard", label: "Standard BizCard Users" },
  { value: "premium", label: "Premium BizCard Users" },
  { value: "company_admins", label: "Company Admins" },
  { value: "free_trial", label: "Free Trial Users" },
  { value: "custom", label: "Custom Selection" },
  { value: "custom_emails", label: "Enter Email Addresses" },
];

type CampaignForm = {
  title: string;
  content: string;
  image_urls: string[];
  audience: string[];
  custom_user_ids: string;
  custom_emails: string;
};

const EMPTY_FORM: CampaignForm = {
  title: "",
  content: "",
  image_urls: [],
  audience: [],
  custom_user_ids: "",
  custom_emails: "",
};

const EMAIL_FORMAT_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseEmailAddresses(raw: string): { emails: string[]; invalid: string[] } {
  const tokens = raw
    .split(/[,;\n\r]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const emails: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    const normalized = token.toLowerCase();
    if (!EMAIL_FORMAT_RE.test(normalized)) {
      invalid.push(token);
      continue;
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    emails.push(normalized);
  }
  return { emails, invalid };
}

const MAX_IMAGES = 6;

type NewsletterTabProps = {
  onNotice: (type: "success" | "error", message: string) => void;
};

export default function NewsletterTab({ onNotice }: NewsletterTabProps) {
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<CampaignForm>(EMPTY_FORM);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const query = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : "";
      const [subsRes, campsRes] = await Promise.all([
        manageContentRequest(`/api/superadmin/newsletter/subscribers${query}`),
        manageContentRequest("/api/superadmin/newsletter/campaigns"),
      ]);
      const subsPayload = await subsRes.json().catch(() => null);
      const campsPayload = await campsRes.json().catch(() => null);
      setSubscribers(subsPayload?.data?.subscribers ?? []);
      setCampaigns(campsPayload?.data?.campaigns ?? []);
    } catch {
      onNotice("error", "Failed to load newsletter data.");
    } finally {
      setLoading(false);
    }
  }, [onNotice, search]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const toggleAudience = (value: string) => {
    setForm((f) => {
      const removing = f.audience.includes(value);
      let audience = removing
        ? f.audience.filter((a) => a !== value)
        : [...f.audience, value];
      let custom_user_ids = f.custom_user_ids;
      let custom_emails = f.custom_emails;

      // Custom Selection and Enter Email Addresses are mutually exclusive.
      if (!removing && value === "custom") {
        audience = audience.filter((a) => a !== "custom_emails");
        custom_emails = "";
      }
      if (!removing && value === "custom_emails") {
        audience = audience.filter((a) => a !== "custom");
        custom_user_ids = "";
      }

      return { ...f, audience, custom_user_ids, custom_emails };
    });
  };

  const uploadPromoImage = async (file: File) => {
    if (form.image_urls.length >= MAX_IMAGES) {
      onNotice("error", `You can attach up to ${MAX_IMAGES} images.`);
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      // Use "support" (already on the public media-proxy allowlist) so previews and
      // outbound email clients can load the image. "newsletter/" was rejected by
      // older /api/media/file allowlists, which produced broken <img> tags.
      formData.append("context", "support");
      const response = await manageContentRequest("/api/media/upload", {
        method: "POST",
        body: formData,
      });
      const payload = await response.json().catch(() => null);
      let url =
        (typeof payload?.url === "string" && payload.url) ||
        (typeof payload?.data?.url === "string" && payload.data.url) ||
        "";
      if (!response.ok || !url) {
        onNotice("error", safeString(payload?.error) || "Failed to upload image.");
        return;
      }

      // Private R2 S3 URLs cannot be loaded in <img> or email clients — rewrite to
      // the same-origin media proxy. Absolute proxy URLs that point at another host
      // (e.g. R2_PUBLIC_URL=production while developing locally) stay as returned
      // for email delivery, but the UI always renders via toServableMediaSrc.
      const servable = toServableMediaSrc(url);
      if (
        servable.startsWith("/api/media/file/") &&
        /r2\.cloudflarestorage\.com/i.test(url) &&
        typeof window !== "undefined"
      ) {
        url = `${window.location.origin}${servable}`;
      }

      setForm((f) => ({
        ...f,
        image_urls: f.image_urls.includes(url)
          ? f.image_urls
          : [...f.image_urls, url].slice(0, MAX_IMAGES),
      }));
    } catch {
      onNotice("error", "Failed to upload image.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removeImage = (url: string) => {
    setForm((f) => ({ ...f, image_urls: f.image_urls.filter((item) => item !== url) }));
  };

  const handleCreate = async (sendNow: boolean) => {
    if (!form.title.trim() || !form.audience.length) {
      onNotice("error", "Title and at least one audience segment are required.");
      return;
    }
    if (isContentsEmpty(form.content) && !form.image_urls.length) {
      onNotice("error", "Add message content or attach at least one promo image.");
      return;
    }
    const customIds = form.custom_user_ids
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    let customEmails: string[] = [];
    if (form.audience.includes("custom_emails")) {
      const parsed = parseEmailAddresses(form.custom_emails);
      if (parsed.invalid.length) {
        onNotice(
          "error",
          `Invalid email address${parsed.invalid.length === 1 ? "" : "es"}: ${parsed.invalid.slice(0, 3).join(", ")}${
            parsed.invalid.length > 3 ? "…" : ""
          }`
        );
        return;
      }
      if (!parsed.emails.length) {
        onNotice("error", "Enter at least one email address.");
        return;
      }
      customEmails = parsed.emails;
    }

    try {
      const response = await manageContentRequest("/api/superadmin/newsletter/campaigns", {
        method: "POST",
        body: JSON.stringify({
          title: form.title.trim(),
          content: isContentsEmpty(form.content) ? "" : form.content.trim(),
          image_urls: form.image_urls,
          audience: form.audience,
          custom_user_ids: form.audience.includes("custom") ? customIds : [],
          custom_emails: form.audience.includes("custom_emails") ? customEmails : [],
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        onNotice("error", safeString(payload?.message) || "Failed to create campaign.");
        return;
      }
      const campaignId = payload?.data?.id as string | undefined;
      if (sendNow && campaignId) {
        setSendingId(campaignId);
        const sendRes = await manageContentRequest(
          `/api/superadmin/newsletter/campaigns/${campaignId}/send`,
          { method: "POST" }
        );
        const sendPayload = await sendRes.json().catch(() => null);
        if (!sendRes.ok) {
          onNotice(
            "error",
            safeString(sendPayload?.message) || "Campaign saved but failed to queue send."
          );
        } else {
          const usedEmails = form.audience.includes("custom_emails");
          onNotice(
            "success",
            usedEmails
              ? "Promotional email sent to the entered addresses."
              : "Campaign queued for delivery."
          );
        }
        setSendingId(null);
      } else {
        onNotice("success", "Campaign saved as draft.");
      }
      setModal(false);
      setForm(EMPTY_FORM);
      await loadData();
    } catch {
      onNotice("error", "Failed to create campaign.");
    }
  };

  const handleSend = async (campaignId: string) => {
    setSendingId(campaignId);
    try {
      const response = await manageContentRequest(
        `/api/superadmin/newsletter/campaigns/${campaignId}/send`,
        { method: "POST" }
      );
      if (!response.ok) {
        onNotice("error", "Failed to send campaign.");
        return;
      }
      onNotice("success", "Campaign queued for delivery.");
      await loadData();
    } catch {
      onNotice("error", "Failed to send campaign.");
    } finally {
      setSendingId(null);
    }
  };

  const handleDelete = async (campaignId: string) => {
    try {
      const response = await manageContentRequest(
        `/api/superadmin/newsletter/campaigns/${campaignId}`,
        { method: "DELETE" }
      );
      if (!response.ok) {
        onNotice("error", "Failed to delete campaign.");
        return;
      }
      onNotice("success", "Campaign deleted.");
      await loadData();
    } catch {
      onNotice("error", "Failed to delete campaign.");
    }
  };

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-gray-900">Newsletter Subscribers</h3>
            <p className="text-sm text-gray-500">
              Users who opted in to promotional emails in their notification settings.
            </p>
          </div>
          <input
            type="search"
            placeholder="Search subscribers…"
            className="rounded-xl border border-gray-200 px-3 py-2 text-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {loading ? (
          <p className="text-sm text-gray-500">Loading subscribers…</p>
        ) : subscribers.length === 0 ? (
          <PortalEmptyState
            title="No subscribers"
            description="Users who enable promotional emails in Settings will appear here."
            icon={Mail}
          />
        ) : (
          <PortalDataTable>
            <PortalTableHead>
              <PortalTableRow>
                <PortalTableHeaderCell>Name</PortalTableHeaderCell>
                <PortalTableHeaderCell>Email</PortalTableHeaderCell>
                <PortalTableHeaderCell>Tier</PortalTableHeaderCell>
                <PortalTableHeaderCell>Opted In</PortalTableHeaderCell>
              </PortalTableRow>
            </PortalTableHead>
            <PortalTableBody>
              {subscribers.map((sub) => (
                <PortalTableRow key={sub.user_id}>
                  <PortalTableCell>{sub.name}</PortalTableCell>
                  <PortalTableCell>{sub.email}</PortalTableCell>
                  <PortalTableCell>{sub.tier}</PortalTableCell>
                  <PortalTableCell>{fmtDate(sub.opted_in_at)}</PortalTableCell>
                </PortalTableRow>
              ))}
            </PortalTableBody>
          </PortalDataTable>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-gray-900">Promotional Campaigns</h3>
            <p className="text-sm text-gray-500">
              Create and send newsletter or promotional emails to selected audiences.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setForm(EMPTY_FORM);
              setModal(true);
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-hover"
          >
            <Plus className="h-4 w-4" />
            Create Campaign
          </button>
        </div>

        {campaigns.length === 0 ? (
          <PortalEmptyState
            title="No campaigns yet"
            description="Create a promotional email campaign to reach opted-in users."
          />
        ) : (
          <div className="space-y-3">
            {campaigns.map((campaign) => (
              <div
                key={campaign.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm"
              >
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap gap-2">
                    <PortalBadge variant={campaign.status === "sent" ? "success" : "info"}>
                      {campaign.status}
                    </PortalBadge>
                    {campaign.recipient_count > 0 ? (
                      <PortalBadge variant="neutral">
                        {campaign.recipient_count} recipients
                      </PortalBadge>
                    ) : null}
                    {(campaign.image_urls?.length ?? 0) > 0 ? (
                      <PortalBadge variant="neutral">
                        {campaign.image_urls!.length} image
                        {campaign.image_urls!.length === 1 ? "" : "s"}
                      </PortalBadge>
                    ) : null}
                  </div>
                  <h4 className="font-semibold text-gray-900">{campaign.title}</h4>
                  <p className="text-xs text-gray-400">
                    Created {fmtDate(campaign.created_at)}
                    {campaign.sent_at ? ` · Sent ${fmtDate(campaign.sent_at)}` : ""}
                  </p>
                  {(campaign.image_urls?.length ?? 0) > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {campaign.image_urls!.slice(0, 3).map((url) => (
                        <div
                          key={url}
                          className="flex max-h-24 max-w-[140px] items-center justify-center overflow-hidden rounded-lg bg-gray-50 ring-1 ring-gray-100"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={toServableMediaSrc(url)}
                            alt=""
                            className="max-h-24 w-auto max-w-full object-contain"
                          />
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  {campaign.status !== "sent" && campaign.status !== "queued" ? (
                    <button
                      type="button"
                      disabled={sendingId === campaign.id}
                      onClick={() => handleSend(campaign.id)}
                      className="inline-flex items-center gap-1 rounded-xl border border-primary px-3 py-1.5 text-sm font-semibold text-primary hover:bg-primary/5 disabled:opacity-50"
                    >
                      <Send className="h-4 w-4" />
                      Send
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => handleDelete(campaign.id)}
                    className="rounded-xl p-2 text-gray-400 hover:bg-rose-50 hover:text-rose-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <PortalModal
        open={modal}
        onClose={() => setModal(false)}
        title="Create Promotional Email"
        description="Compose a newsletter or attach promo graphics for opted-in users."
        size="lg"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setModal(false)}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => handleCreate(false)}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700"
            >
              Save Draft
            </button>
            <button
              type="button"
              onClick={() => handleCreate(true)}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white"
            >
              Send Now
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-semibold text-gray-700">Title</label>
            <input
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold text-gray-700">
              Contents{" "}
              <span className="font-normal text-gray-400">(optional if images are attached)</span>
            </label>
            <PromoEmailContentsEditor
              value={form.content}
              onChange={(html) => setForm((f) => ({ ...f, content: html }))}
              placeholder="Optional supporting message…"
            />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <label className="block text-sm font-semibold text-gray-700">
                Promo images
              </label>
              <span className="text-xs text-gray-400">
                {form.image_urls.length}/{MAX_IMAGES}
              </span>
            </div>
            <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/60 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={uploading || form.image_urls.length >= MAX_IMAGES}
                  onClick={() => fileRef.current?.click()}
                  className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-white disabled:opacity-50"
                >
                  {uploading ? (
                    <Upload className="h-4 w-4 animate-pulse" />
                  ) : (
                    <ImagePlus className="h-4 w-4" />
                  )}
                  {uploading ? "Uploading…" : "Attach image"}
                </button>
                <p className="text-xs text-gray-500">
                  Shown at natural aspect ratio in the email body (not cropped).
                </p>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadPromoImage(file);
                }}
              />

              {form.image_urls.length > 0 ? (
                <ul className="mt-4 space-y-3">
                  {form.image_urls.map((url) => (
                    <li
                      key={url}
                      className="relative overflow-hidden rounded-xl bg-white p-3 ring-1 ring-gray-100"
                    >
                      <button
                        type="button"
                        onClick={() => removeImage(url)}
                        className="absolute right-2 top-2 z-10 rounded-full bg-white/95 p-1.5 text-gray-500 shadow-sm ring-1 ring-gray-200 hover:text-rose-600"
                        aria-label="Remove image"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                      <div className="flex w-full items-center justify-center">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={toServableMediaSrc(url)}
                          alt="Promo attachment preview"
                          className="h-auto max-h-[320px] w-auto max-w-full object-contain"
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-xs text-gray-500">
                  Attach flyer, banner, or product graphics instead of typing the whole promo.
                </p>
              )}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-semibold text-gray-700">Recipients</label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {AUDIENCE_OPTIONS.map((option) => (
                <label key={option.value} className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={form.audience.includes(option.value)}
                    onChange={() => toggleAudience(option.value)}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </div>
          {form.audience.includes("custom") ? (
            <div>
              <label className="mb-1 block text-sm font-semibold text-gray-700">
                Custom User IDs (comma-separated)
              </label>
              <input
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                value={form.custom_user_ids}
                onChange={(e) => setForm((f) => ({ ...f, custom_user_ids: e.target.value }))}
                placeholder="123, 456, 789"
              />
            </div>
          ) : null}
          {form.audience.includes("custom_emails") ? (
            <div>
              <label className="mb-1 block text-sm font-semibold text-gray-700">
                Email Addresses
              </label>
              <textarea
                rows={3}
                className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm"
                value={form.custom_emails}
                onChange={(e) => setForm((f) => ({ ...f, custom_emails: e.target.value }))}
                placeholder="Enter email addresses separated by commas, semicolons, or new lines"
              />
              <p className="mt-1 text-xs text-gray-500">
                Emails are sent immediately when you click Send Now (not via the subscriber queue).
              </p>
            </div>
          ) : null}
        </div>
      </PortalModal>
    </div>
  );
}
