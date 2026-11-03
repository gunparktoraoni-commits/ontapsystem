"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { CheckCircle2, AlertTriangle, Phone } from "lucide-react";
import {  InlineLoader, SectionLoader } from "@/app/components/Loader";
import type { SupportConversation } from "@/app/lib/supportMessaging";
import { devApiJson } from "@/app/dev/lib/devApi";
import { BizCardInfoActions } from "@/app/components/digital-card/BizCardInfoActions";
import {
  DigitalBizCardModal,
  sharePortfolioUrl,
} from "@/app/components/digital-card/DigitalBizCardModal";
import { buildDigitalBizCardData } from "@/app/components/digital-card/digitalBizCard.utils";
import { showToast } from "@/app/components/Toast";
import { getTheme } from "@/app/components/BizCardPreview";
import {
  toDigitalBizCardTheme,
} from "@/app/components/digital-card/digitalBizCard.theme";

interface Concern {
  id: string;
  user: string;
  subject: string;
  date: string;
  status: "Open" | "In Progress" | "Resolved";
}

interface SystemError {
  id: string;
  message: string;
  timestamp: string;
  severity: "Critical" | "High" | "Medium" | "Low";
}

interface ProfileCard {
  name: string;
  role: string;
  company: string;
  phone: string;
  email: string;
  portfolioUrl: string;
}

interface VCardSection {
  label: string;
  done: boolean;
}

function concernStatusClasses(status: Concern["status"]): string {
  switch (status) {
    case "Open":
      return "bg-blue-100  text-blue-700";
    case "In Progress":
      return "bg-amber-100 text-amber-700";
    case "Resolved":
      return "bg-green-100 text-green-700";
  }
}

function severityClasses(severity: SystemError["severity"]): string {
  switch (severity) {
    case "Critical":
      return "bg-red-100    text-red-700";
    case "High":
      return "bg-orange-100 text-orange-700";
    case "Medium":
      return "bg-amber-100  text-amber-700";
    case "Low":
      return "bg-gray-100   text-gray-600";
  }
}

function mapConcernStatus(status: string): Concern["status"] {
  const s = status.toLowerCase();
  if (s === "resolved" || s === "closed") return "Resolved";
  if (s === "open" || s === "waiting" || s === "queued") return "Open";
  return "In Progress";
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return "—";
  }
}

function isFinderRegion(row: number, col: number, size: number): boolean {
  return (row < 8 && col < 8) || (row < 8 && col >= size - 8) || (row >= size - 8 && col < 8);
}

async function generateBrowserQRDataUrl(text: string): Promise<string> {
  const DARK = "#1a1a2e";
  const LIGHT = "#ffffff";
  const PX = 8;
  const MARGIN = 3;
  const DOT_R = 0.3;
  const CARD_R = 10;

  try {
    const QRCode = (await import("qrcode")) as unknown as {
      default?: { create: (t: string, o: object) => { modules: { size: number; get: (r: number, c: number) => number | boolean } } };
      create?: (t: string, o: object) => { modules: { size: number; get: (r: number, c: number) => number | boolean } };
    };
    const create = QRCode.default?.create ?? QRCode.create;
    if (!create) throw new Error("qrcode unavailable");
    const qr = create(text, { errorCorrectionLevel: "M" });
    const size = qr.modules.size;
    const total = (size + MARGIN * 2) * PX;
    const rx = Math.round(PX * DOT_R);

    let rects = "";
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (isFinderRegion(r, c, size)) continue;
        if (!qr.modules.get(r, c)) continue;
        const x = (c + MARGIN) * PX;
        const y = (r + MARGIN) * PX;
        rects += `<rect x="${x}" y="${y}" width="${PX}" height="${PX}" rx="${rx}" ry="${rx}" fill="${DARK}"/>`;
      }
    }

    const outerR = PX * 1.0;
    const clearR = PX * 0.7;
    const dotR = PX * 0.9;
    const corners = [
      { r: 0, c: 0 },
      { r: 0, c: size - 7 },
      { r: size - 7, c: 0 },
    ];
    let finders = "";
    for (const { r, c } of corners) {
      const x = (c + MARGIN) * PX;
      const y = (r + MARGIN) * PX;
      finders += `<rect x="${x}" y="${y}" width="${7 * PX}" height="${7 * PX}" rx="${outerR}" ry="${outerR}" fill="${DARK}"/>`;
      finders += `<rect x="${x + PX}" y="${y + PX}" width="${5 * PX}" height="${5 * PX}" rx="${clearR}" ry="${clearR}" fill="${LIGHT}"/>`;
      finders += `<rect x="${x + 2 * PX}" y="${y + 2 * PX}" width="${3 * PX}" height="${3 * PX}" rx="${dotR}" ry="${dotR}" fill="${DARK}"/>`;
    }

    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${total}" viewBox="0 0 ${total} ${total}">` +
      `<rect width="${total}" height="${total}" rx="${CARD_R}" ry="${CARD_R}" fill="${LIGHT}"/>` +
      finders +
      rects +
      `</svg>`;
    return `data:image/svg+xml;base64,${btoa(svg)}`;
  } catch {
    const SIZE = 120;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">` +
      `<rect width="${SIZE}" height="${SIZE}" rx="10" fill="#f0f4ff"/>` +
      `<text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" ` +
      `font-family="system-ui,sans-serif" font-size="28" font-weight="700" fill="#2A4792">QR</text>` +
      `</svg>`;
    return `data:image/svg+xml;base64,${btoa(svg)}`;
  }
}

function DashboardCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
        <span
          className="inline-block h-4 w-1 rounded-full shrink-0"
          style={{ background: "linear-gradient(180deg,#2A4792,#4785B8)" }}
        />
        <h2 className="text-sm font-semibold text-gray-800 tracking-wide uppercase">{title}</h2>
      </div>
      <div className="px-5 py-4 flex-1">{children}</div>
    </div>
  );
}

function DigitalCardPreview({ profile }: { profile: ProfileCard | null }) {
  const [qrSrc, setQrSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!profile?.portfolioUrl) {
      setQrSrc(null);
      return;
    }
    let cancelled = false;
    generateBrowserQRDataUrl(profile.portfolioUrl).then((dataUrl) => {
      if (!cancelled) setQrSrc(dataUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [profile?.portfolioUrl]);

  if (!profile) {
    return (
      <DashboardCard title="Digital Card">
        <div className="flex justify-center py-10">
          <InlineLoader />
        </div>
      </DashboardCard>
    );
  }

  return (
    <DashboardCard title="Digital Card">
      <div
        className="relative w-full rounded-2xl overflow-hidden"
        style={{
          background: "linear-gradient(135deg, #1a2d6e 0%, #2A4792 45%, #3a6fa8 100%)",
          boxShadow: "0 8px 32px rgba(26,45,110,0.28), 0 2px 8px rgba(0,0,0,0.12)",
        }}
      >
        <div className="relative z-10 flex items-center gap-4 px-6 py-5 sm:gap-6 sm:px-7 sm:py-6">
          <div className="flex flex-col items-center gap-3 shrink-0">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-white/95 p-2 shadow-lg sm:h-16 sm:w-16">
              <Image
                src="/logotap.png"
                alt="OnTap logo"
                width={48}
                height={48}
                className="h-10 w-10 object-contain sm:h-12 sm:w-12"
                priority
                draggable={false}
              />
            </div>
          </div>
          <div className="h-20 w-px rounded-full bg-white/15 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-bold leading-tight text-white sm:text-lg">
              {profile.name}
            </p>
            <p className="mt-0.5 truncate text-sm font-medium text-white/80">{profile.role}</p>
            <p className="mt-0.5 truncate text-xs text-white/55">{profile.company}</p>
            <div className="mt-3 flex items-center gap-1.5">
              <Phone className="h-3.5 w-3.5 shrink-0 text-[#7EC8F0]" />
              <span className="text-xs font-medium tracking-wide text-white/80">
                {profile.phone || "—"}
              </span>
            </div>
          </div>
          <div className="shrink-0">
            <div className="flex flex-col items-center gap-1.5">
              <div className="flex items-center justify-center rounded-xl bg-white p-2 shadow-md">
                {qrSrc ? (
                  <img
                    src={qrSrc}
                    alt="Profile QR code"
                    width={72}
                    height={72}
                    className="h-[68px] w-[68px] sm:h-[80px] sm:w-[80px]"
                    draggable={false}
                  />
                ) : (
                  <div className="h-[68px] w-[68px] animate-pulse rounded-lg bg-gray-200 sm:h-[80px] sm:w-[80px]" />
                )}
              </div>
              <span className="text-[9px] font-medium uppercase tracking-widest text-white/40">
                Scan
              </span>
            </div>
          </div>
        </div>
        <div className="relative z-10 flex items-center justify-between border-t border-white/10 px-6 py-2.5 sm:px-7">
          <span className="text-[10px] text-white/40 italic">Scan to connect</span>
          <span className="text-[10px] font-semibold tracking-widest text-white/40 uppercase">
            ontap.ph
          </span>
        </div>
      </div>
    </DashboardCard>
  );
}

function VCardStatus({
  sections,
  percentage,
  onDownloadDigitalCard,
  onShare,
  onChecklist,
  checklistActive = false,
  downloadDisabled = false,
  shareDisabled = false,
}: {
  sections: VCardSection[];
  percentage: number;
  onDownloadDigitalCard: () => void;
  onShare: () => void;
  onChecklist: () => void;
  checklistActive?: boolean;
  downloadDisabled?: boolean;
  shareDisabled?: boolean;
}) {
  const total = sections.length || 1;
  const done = sections.filter((s) => s.done).length;

  return (
    <DashboardCard title="Bizcard Info">
      <div className="flex items-end justify-between mb-3">
        <div>
          <p className="text-3xl font-bold text-[#2A4792]">{percentage}%</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {done} of {total} sections complete
          </p>
        </div>
        <CheckCircle2 className="h-8 w-8 text-green-400" />
      </div>
      <div className="h-2.5 w-full rounded-full bg-gray-100 overflow-hidden mb-5">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${percentage}%`,
            background: "linear-gradient(90deg,#2A4792,#4785B8)",
          }}
        />
      </div>
      {checklistActive ? (
        <ul className="space-y-2 mb-5">
          {sections.map((s) => (
            <li key={s.label} className="flex items-center justify-between text-sm">
              <span className="text-gray-700">{s.label}</span>
              <span
                className={`text-xs font-semibold ${s.done ? "text-green-600" : "text-gray-400"}`}
              >
                {s.done ? "Done" : "Pending"}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-5 text-sm text-gray-500 leading-relaxed">
          Download your branded digital card, share your portfolio, or open the checklist to
          review remaining profile sections.
        </p>
      )}
      <div className="border-t border-gray-100 pt-5">
        <BizCardInfoActions
          onDownloadDigitalCard={onDownloadDigitalCard}
          onShare={onShare}
          onChecklist={onChecklist}
          downloadDisabled={downloadDisabled}
          shareDisabled={shareDisabled}
          checklistActive={checklistActive}
        />
      </div>
    </DashboardCard>
  );
}

function RecentConcerns({ concerns, loading }: { concerns: Concern[]; loading: boolean }) {
  return (
    <DashboardCard title="Recent Concerns">
      {loading ? (
        <div className="flex justify-center py-8">
          <InlineLoader />
        </div>
      ) : concerns.length === 0 ? (
        <p className="text-sm text-gray-400 py-6 text-center">No escalated concerns</p>
      ) : (
        <div className="overflow-x-auto -mx-5 px-5">
          <table className="w-full text-sm min-w-[420px]">
            <thead>
              <tr className="text-xs text-gray-400 font-semibold uppercase tracking-wide border-b border-gray-100">
                <th className="pb-2 text-left">User</th>
                <th className="pb-2 text-left">Subject</th>
                <th className="pb-2 text-left w-24">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {concerns.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50/60 transition-colors">
                  <td className="py-2.5 text-gray-800 font-medium truncate max-w-[120px]">
                    {c.user}
                  </td>
                  <td className="py-2.5 text-gray-500 truncate max-w-[180px]">{c.subject}</td>
                  <td className="py-2.5">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${concernStatusClasses(c.status)}`}
                    >
                      {c.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DashboardCard>
  );
}

function RecentSystemErrors({
  errors,
  loading,
}: {
  errors: SystemError[];
  loading: boolean;
}) {
  return (
    <DashboardCard title="Recent System Errors">
      {loading ? (
        <div className="flex justify-center py-8">
          <InlineLoader />
        </div>
      ) : errors.length === 0 ? (
        <p className="text-sm text-gray-400 py-6 text-center">No recent system errors</p>
      ) : (
        <div className="overflow-x-auto -mx-5 px-5">
          <table className="w-full text-sm min-w-[480px]">
            <thead>
              <tr className="text-xs text-gray-400 font-semibold uppercase tracking-wide border-b border-gray-100">
                <th className="pb-2 text-left w-20">ID</th>
                <th className="pb-2 text-left">Message</th>
                <th className="pb-2 text-left w-20">Severity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {errors.map((e) => (
                <tr key={e.id} className="hover:bg-gray-50/60 transition-colors">
                  <td className="py-2.5 font-mono text-xs text-gray-500">{e.id}</td>
                  <td className="py-2.5 text-gray-700 max-w-[260px] truncate">
                    <span className="flex items-center gap-1.5">
                      {(e.severity === "Critical" || e.severity === "High") && (
                        <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0" />
                      )}
                      {e.message}
                    </span>
                  </td>
                  <td className="py-2.5">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${severityClasses(e.severity)}`}
                    >
                      {e.severity}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DashboardCard>
  );
}

export default function DevDashboardPage() {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<ProfileCard | null>(null);
  const [concerns, setConcerns] = useState<Concern[]>([]);
  const [errors, setErrors] = useState<SystemError[]>([]);
  const [vcardSections, setVcardSections] = useState<VCardSection[]>([]);
  const [vcardPct, setVcardPct] = useState(0);
  const [detailsView, setDetailsView] = useState<"summary" | "checklist">("summary");
  const [digitalCardModalOpen, setDigitalCardModalOpen] = useState(false);
  const [activeThemeId, setActiveThemeId] = useState("elegant-dark");
  const [stats, setStats] = useState({
    activeUsers: 0,
    openConcerns: 0,
    systemErrors: 0,
    vcardComplete: "0%",
  });

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const [profileResult, clientsResult, escalationsResult, errorsResult, vcardResult, dashResult, vcardProfileResult] =
        await Promise.all([
          devApiJson<Record<string, unknown>>("/api/superadmin/settings/profile", { method: "GET" }),
          devApiJson<Record<string, unknown>>("/api/superadmin/clients/summary", { method: "GET" }),
          devApiJson<SupportConversation[]>("/api/superadmin/support/escalations", { method: "GET" }),
          devApiJson<{ items?: SystemError[] }>("/api/dev/error-logs?limit=8", { method: "GET" }),
          devApiJson<Record<string, unknown>>("/api/dashboard/vcard-completion", { method: "GET" }),
          devApiJson<Record<string, unknown>>("/api/dashboard", { method: "GET" }),
          devApiJson<{ profile?: Record<string, unknown> }>("/api/vcard/profile", { method: "GET" }),
        ]);

      if (profileResult.ok && profileResult.data) {
        const data = profileResult.data;
        const name =
          String(data.name ?? "").trim() ||
          `${String(data.first_name ?? "").trim()} ${String(data.last_name ?? "").trim()}`.trim();
        setProfile({
          name: name || "Developer",
          role: String(data.role ?? "dev"),
          company: "OnTap Technologies",
          phone: String(data.phone ?? ""),
          email: String(data.email ?? ""),
          portfolioUrl: "",
        });
      }

      if (dashResult.ok && dashResult.data) {
        const portfolioUrl = String(dashResult.data.portfolioUrl ?? "");
        setProfile((prev) =>
          prev
            ? { ...prev, portfolioUrl: portfolioUrl || prev.portfolioUrl }
            : {
                name: "Developer",
                role: "dev",
                company: "OnTap Technologies",
                phone: "",
                email: "",
                portfolioUrl,
              },
        );
      }

      if (vcardProfileResult.ok && vcardProfileResult.data?.profile) {
        const themeId = String(vcardProfileResult.data.profile.theme_id ?? "").trim();
        if (themeId) setActiveThemeId(themeId);
      }

      let openConcerns = 0;
      if (escalationsResult.ok) {
        const list = (escalationsResult.data ?? []) as SupportConversation[];
        openConcerns = list.filter(
          (c) => c.status !== "resolved" && c.status !== "closed",
        ).length;
        setConcerns(
          list.slice(0, 7).map((c) => ({
            id: c.id,
            user: c.client?.name ?? "Client",
            subject: c.lastMessagePreview || "Escalated support conversation",
            date: formatDate(c.escalatedAt ?? c.lastMessageAt),
            status: mapConcernStatus(c.status),
          })),
        );
      }

      let systemErrors = 0;
      if (errorsResult.ok) {
        const items = (errorsResult.data?.items ?? []) as SystemError[];
        const raw = errorsResult.raw as { data?: { summary?: { total?: number } } } | null;
        systemErrors = Number(raw?.data?.summary?.total ?? items.length);
        setErrors(items.slice(0, 8));
      }

      let activeUsers = 0;
      if (clientsResult.ok && clientsResult.data) {
        activeUsers = Number(
          clientsResult.data.total_active ?? clientsResult.data.total_clients ?? 0,
        );
      }

      let pct = 0;
      if (vcardResult.ok && vcardResult.data) {
        const payload = vcardResult.data;
        const fields = (payload.fields ?? {}) as Record<string, unknown>;
        pct = Number(payload.percentage ?? 0);
        setVcardPct(pct);
        setVcardSections([
          { label: "Basic Info", done: Boolean(fields.firstName && fields.lastName && fields.about) },
          { label: "Profile Photo", done: Boolean(fields.profilePhoto) },
          { label: "Contact Details", done: Boolean(fields.phone && fields.email) },
          { label: "Social Links", done: Boolean(fields.socials) },
          { label: "Services", done: Boolean(fields.services) },
          { label: "Portfolio", done: Boolean(fields.products) },
        ]);
      }

      setStats({
        activeUsers,
        openConcerns,
        systemErrors,
        vcardComplete: `${pct}%`,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const digitalCardData = useMemo(
    () =>
      profile?.portfolioUrl
        ? buildDigitalBizCardData({
            displayName: profile.name,
            jobTitle: profile.role,
            phone: profile.phone,
            email: profile.email,
            portfolioUrl: profile.portfolioUrl,
          })
        : null,
    [profile],
  );
  const digitalCardTheme = useMemo(
    () => toDigitalBizCardTheme(getTheme(activeThemeId)),
    [activeThemeId],
  );

  const handleSharePortfolio = async () => {
    if (!profile?.portfolioUrl) {
      showToast("Add your portfolio link before sharing.", "error");
      return;
    }
    const shared = await sharePortfolioUrl(profile.portfolioUrl, profile.name);
    if (shared) {
      showToast(
        typeof navigator !== "undefined" && typeof navigator.share === "function"
          ? "Portfolio shared."
          : "Portfolio link copied.",
        "success",
      );
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          {
            label: "Active Users",
            value: loading ? "…" : stats.activeUsers.toLocaleString(),
            color: "text-[#2A4792]",
          },
          {
            label: "Open Concerns",
            value: loading ? "…" : String(stats.openConcerns),
            color: "text-amber-600",
          },
          {
            label: "System Errors",
            value: loading ? "…" : String(stats.systemErrors),
            color: "text-red-600",
          },
          {
            label: "vCard Complete",
            value: loading ? "…" : stats.vcardComplete,
            color: "text-green-600",
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className="bg-white rounded-xl px-4 py-3 border border-gray-100 shadow-sm"
          >
            <p className="text-xs text-gray-400 font-medium">{stat.label}</p>
            <p className={`text-2xl font-bold mt-1 ${stat.color}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <DigitalCardPreview profile={profile} />
        <VCardStatus
          sections={vcardSections}
          percentage={vcardPct}
          onDownloadDigitalCard={() => {
            if (!digitalCardData) {
              showToast("Complete your portfolio link to download your digital card.", "error");
              return;
            }
            setDigitalCardModalOpen(true);
          }}
          onShare={() => {
            void handleSharePortfolio();
          }}
          onChecklist={() => setDetailsView("checklist")}
          downloadDisabled={!digitalCardData}
          shareDisabled={!profile?.portfolioUrl}
          checklistActive={detailsView === "checklist"}
        />
        <RecentConcerns concerns={concerns} loading={loading} />
        <RecentSystemErrors errors={errors} loading={loading} />
      </div>
      <DigitalBizCardModal
        isOpen={digitalCardModalOpen}
        onClose={() => setDigitalCardModalOpen(false)}
        data={digitalCardData}
        theme={digitalCardTheme}
      />
    </div>
  );
}
