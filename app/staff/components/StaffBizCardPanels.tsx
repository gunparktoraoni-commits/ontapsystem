"use client";

import Link from "next/link";
import QRCode from "qrcode";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, ExternalLink } from "lucide-react";
import { InlineLoader } from "../../components/Loader";
import { getFrontendApiBaseUrl } from "../../components/apiBase";
import { getTheme } from "../../components/BizCardPreview";
import { normalizePortfolioThemeId } from "../../themes/ThemeLoader";
import { toServableMediaSrc } from "../../lib/portfolioDisplay";
import { showToast } from "../../components/Toast";
import { BizCardInfoActions } from "../../components/digital-card/BizCardInfoActions";
import {
  DigitalBizCardModal,
  sharePortfolioUrl,
} from "../../components/digital-card/DigitalBizCardModal";
import { buildDigitalBizCardData } from "../../components/digital-card/digitalBizCard.utils";
import { toDigitalBizCardTheme } from "../../components/digital-card/digitalBizCard.theme";

const API_BASE_URL = getFrontendApiBaseUrl();
const PORTAL_PREFIX = "/staff";

interface VCardProfile {
  first_name?: string;
  last_name?: string;
  vcard_name?: string;
  job_position?: string;
  custom_uri?: string;
  profile_url?: string;
  email?: string | null;
  contact?: string | null;
  socials?: Array<{ platform?: string; url?: string; is_visible?: boolean }>;
  theme_id?: string | null;
  theme_path?: string | null;
  user_id?: string | number;
}

interface CompletionData {
  percentage: number;
  fields?: Record<string, boolean>;
}

interface DashboardMetrics {
  metrics?: {
    totalViews?: number;
    totalConnections?: number;
    totalInquiries?: number;
    unreadInquiries?: number;
  };
  qrCode?: string | null;
  portfolioUrl?: string | null;
}

const FIELD_LABELS: Array<{ key: string; label: string }> = [
  { key: "firstName", label: "First Name" },
  { key: "lastName", label: "Last Name" },
  { key: "profilePhoto", label: "Profile Photo" },
  { key: "coverPhoto", label: "Cover Photo" },
  { key: "jobPosition", label: "Job Position" },
  { key: "about", label: "About / Bio" },
  { key: "email", label: "Email Address" },
  { key: "phone", label: "Phone Number" },
  { key: "address", label: "Address" },
  { key: "socials", label: "Social Links" },
  { key: "services", label: "Services" },
];

interface StaffPortalStats {
  clients: number;
  companies: number;
  unread_messages: number;
  inquiries: number;
}

interface StaffInquiry {
  inquiry_id: string;
  visitor_name: string | null;
  visitor_email: string | null;
  subject: string | null;
  message: string;
  created_at: string;
}

interface StaffOrder {
  shop_order_id: string;
  status: string;
  total_amount: string;
  created_at: string;
}

interface StaffMessage {
  user_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  unread_message_count: number;
  last_message_at: string | null;
}

const TODAY = new Date().toLocaleDateString("en-US", {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
});

function timeAgo(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds} sec ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
  return date.toLocaleDateString();
}

function readStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return (
    window.localStorage.getItem("auth_token") ||
    window.sessionStorage.getItem("auth_token") ||
    window.localStorage.getItem("superadmin_token") ||
    window.sessionStorage.getItem("superadmin_token") ||
    null
  );
}

function buildAuthHeaders(): HeadersInit {
  const token = readStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function readAuthUserName(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = localStorage.getItem("authUser") ?? localStorage.getItem("superadmin_profile");
    if (!raw) return "";
    const u = JSON.parse(raw) as Record<string, unknown>;
    const first = String(u.firstName ?? u.first_name ?? "").trim();
    const last = String(u.lastName ?? u.last_name ?? "").trim();
    return [first, last].filter(Boolean).join(" ").trim();
  } catch {
    return "";
  }
}

function ProgressRing({ pct, accent }: { pct: number; accent: string }) {
  const sz = 88;
  const sw = 8;
  const r = (sz - sw * 2) / 2;
  const c = r * 2 * Math.PI;
  return (
    <svg width={sz} height={sz} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={sz / 2} cy={sz / 2} r={r} fill="none" stroke="#e5e7eb" strokeWidth={sw} />
      <circle
        cx={sz / 2}
        cy={sz / 2}
        r={r}
        fill="none"
        stroke={accent}
        strokeWidth={sw}
        strokeDasharray={c}
        strokeDashoffset={c - (pct / 100) * c}
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function StaffBizCardPanels() {
  const [profile, setProfile] = useState<VCardProfile | null>(null);
  const [dashboard, setDashboard] = useState<DashboardMetrics | null>(null);
  const [completion, setCompletion] = useState<CompletionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [detailsView, setDetailsView] = useState<"summary" | "checklist">("summary");
  const [digitalCardModalOpen, setDigitalCardModalOpen] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const headers = buildAuthHeaders();
      const [dashRes, compRes, vcardRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/dashboard`, { credentials: "include", headers }).then((r) =>
          r.ok ? r.json() : null,
        ),
        fetch(`${API_BASE_URL}/api/dashboard/vcard-completion`, {
          credentials: "include",
          headers,
          cache: "no-store",
        }).then((r) => (r.ok ? r.json() : null)),
        fetch(`${API_BASE_URL}/api/vcard/profile`, {
          credentials: "include",
          headers,
          cache: "no-store",
        }).then((r) => (r.ok ? r.json() : null)),
      ]);
      if (dashRes) setDashboard(dashRes);
      if (compRes) setCompletion(compRes);
      if (vcardRes?.profile) setProfile(vcardRes.profile as VCardProfile);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const alias = profile?.custom_uri ?? "";
  const displayName =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
    profile?.vcard_name ||
    readAuthUserName() ||
    "Staff Member";
  const pct = completion?.percentage ?? 0;
  const activeTheme = useMemo(
    () => getTheme(normalizePortfolioThemeId(profile?.theme_id ?? alias)),
    [alias, profile?.theme_id],
  );
  const digitalCardTheme = useMemo(
    () => toDigitalBizCardTheme(activeTheme),
    [activeTheme],
  );
  const portfolioHref = alias ? `/${alias.replace(/^\/+/, "")}` : "#";
  const portfolioCopyUrl =
    dashboard?.portfolioUrl?.trim() ||
    (alias && typeof window !== "undefined"
      ? `${window.location.origin}/${alias.replace(/^\/+/, "")}`
      : "");
  const scannableUrl = portfolioCopyUrl;
  const digitalCardData = useMemo(
    () =>
      buildDigitalBizCardData({
        firstName: profile?.first_name,
        lastName: profile?.last_name,
        displayName: profile?.vcard_name,
        jobTitle: profile?.job_position,
        phone: profile?.contact,
        email: profile?.email,
        profileImageUrl: profile?.profile_url
          ? toServableMediaSrc(profile.profile_url)
          : "",
        alias,
        portfolioUrl: portfolioCopyUrl,
        socials: profile?.socials ?? [],
      }),
    [alias, portfolioCopyUrl, profile],
  );

  useEffect(() => {
    let cancelled = false;
    const generate = async () => {
      if (!scannableUrl) {
        if (!cancelled) setQrCodeDataUrl(null);
        return;
      }
      try {
        const dataUrl = await QRCode.toDataURL(scannableUrl, {
          errorCorrectionLevel: "H",
          type: "image/png",
          margin: 1,
          width: 220,
        });
        if (!cancelled) setQrCodeDataUrl(dataUrl);
      } catch {
        if (!cancelled) setQrCodeDataUrl(dashboard?.qrCode ?? null);
      }
    };
    void generate();
    return () => {
      cancelled = true;
    };
  }, [scannableUrl, dashboard?.qrCode]);

  const pendingCount = completion?.fields
    ? Object.values(completion.fields).filter((v) => !v).length
    : 0;
  const qrSrc = (qrCodeDataUrl ?? dashboard?.qrCode ?? "").trim();
  const role = profile?.job_position || "Staff";

  const handleSharePortfolio = async () => {
    if (!portfolioCopyUrl) {
      showToast("Add your portfolio link before sharing.", "error");
      return;
    }
    const shared = await sharePortfolioUrl(portfolioCopyUrl, displayName);
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
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-6">
        <div
          className="relative overflow-hidden rounded-3xl shadow-xl hover:shadow-2xl transition-all duration-500 group"
          style={{
            background: activeTheme.gradient,
            boxShadow: `0 24px 48px -12px ${activeTheme.accentSoft}, 0 8px 24px -8px rgba(15,23,42,0.35)`,
          }}
        >
          <div className="relative z-10 p-6 sm:p-8 flex flex-col h-full min-h-[360px]">
            <div className="flex items-center justify-between mb-6">
              <span className="font-extrabold text-sm tracking-wide text-white">OnTap</span>
              <span className="px-3 py-1 rounded-full text-[10px] font-bold tracking-widest uppercase bg-white/20 text-white">
                Digital Card
              </span>
            </div>
            <div className="flex-1 flex flex-col items-center justify-center">
              <div className="rounded-2xl p-4 bg-white shadow-2xl">
                {qrSrc ? (
                  <img
                    src={qrSrc}
                    alt="Staff digital card QR code"
                    className="h-32 w-32 object-contain"
                  />
                ) : (
                  <div className="h-32 w-32 flex items-center justify-center">
                    <InlineLoader />
                  </div>
                )}
              </div>
              <p className="mt-4 text-sm font-semibold text-white/90">{displayName}</p>
              <p className="text-xs text-white/70">{role}</p>
            </div>
            <Link
              href={portfolioHref}
              className="mt-6 flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-bold text-[#2A4792] bg-white hover:bg-gray-50 transition-colors"
            >
              View Card <ExternalLink className="h-4 w-4" />
            </Link>
          </div>
        </div>

        <div className="bg-white border border-gray-100 rounded-3xl shadow-sm hover:shadow-md flex flex-col overflow-hidden">
          <div className="px-6 pt-6 pb-5 border-b border-gray-50">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-extrabold text-gray-900 tracking-tight">BizCard Details</h3>
                {loading ? (
                  <p className="text-sm text-gray-400 mt-1.5 flex items-center gap-2">
                    <InlineLoader /> Loading progress…
                  </p>
                ) : detailsView === "checklist" ? (
                  <p className="text-sm text-gray-500 mt-1.5 font-medium">
                    Complete each field to strengthen your card.
                  </p>
                ) : (
                  <p className="text-sm text-gray-500 mt-1.5 font-medium">
                    {pct === 100 ? (
                      "Your card is fully set up!"
                    ) : (
                      <>
                        <span className="text-[#2A4792] font-bold">{pendingCount}</span> field
                        {pendingCount !== 1 ? "s" : ""} still needed
                      </>
                    )}
                  </p>
                )}
              </div>
              <div className="relative shrink-0 bg-[#F8FAFC] rounded-full p-1.5 shadow-inner">
                <ProgressRing pct={pct} accent="#2A4792" />
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-black text-[#2A4792] leading-none">{pct}</span>
                  <span className="text-[10px] font-bold text-[#4785B8]">%</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 max-h-[280px]">
            {detailsView === "checklist" ? (
              <div className="space-y-2">
                {FIELD_LABELS.map(({ key, label }) => {
                  const done = completion?.fields?.[key] ?? false;
                  return (
                    <Link
                      key={key}
                      href={`${PORTAL_PREFIX}/bizcard`}
                      className={`group flex items-center justify-between px-4 py-3 rounded-2xl transition-all duration-200 ${
                        done
                          ? "bg-emerald-50/50 border border-transparent hover:bg-emerald-50"
                          : "bg-[#F8FAFC] border border-gray-100 hover:border-[#4785B8]/30 hover:bg-[#F0F5F9]"
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {done ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                        ) : (
                          <div className="h-4 w-4 rounded-full border-[1.5px] border-gray-300 shrink-0" />
                        )}
                        <span
                          className={`text-sm font-semibold ${
                            done ? "text-gray-500" : "text-gray-800 group-hover:text-[#2A4792]"
                          }`}
                        >
                          {label}
                        </span>
                      </div>
                      <span
                        className={`text-[10px] uppercase tracking-wider font-extrabold px-2.5 py-1 rounded-full ${
                          done
                            ? "text-emerald-600 bg-emerald-100/80"
                            : "text-gray-400 bg-gray-100"
                        }`}
                      >
                        {done ? "Done" : "Needed"}
                      </span>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-3 px-2 py-2">
                <p className="text-sm text-gray-600 leading-relaxed">
                  Download your branded digital card, share your portfolio link, or review your
                  profile checklist.
                </p>
                <Link
                  href={`${PORTAL_PREFIX}/bizcard`}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 px-4 py-3 text-sm font-bold text-[#2A4792] hover:bg-gray-50 transition-colors"
                >
                  Edit BizCard Details
                </Link>
              </div>
            )}
          </div>

          <div className="p-6 border-t border-gray-50 bg-gray-50/30">
            <BizCardInfoActions
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
              shareDisabled={!portfolioCopyUrl}
              checklistActive={detailsView === "checklist"}
            />
          </div>
        </div>
      </div>

      <DigitalBizCardModal
        isOpen={digitalCardModalOpen}
        onClose={() => setDigitalCardModalOpen(false)}
        data={digitalCardData}
        theme={digitalCardTheme}
      />
    </>
  );
}

export { TODAY, readAuthUserName, buildAuthHeaders, timeAgo };
export type { StaffPortalStats, StaffInquiry, StaffOrder, StaffMessage };
