"use client";

import React, { useState, useEffect } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { motion, type Variants } from "framer-motion";
import {
  Eye,
  Mail,
  BookmarkCheck,
  QrCode,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  ArrowLeft,
  Copy,
  PencilLine,
  Link2,
  Activity,
} from "lucide-react";
import { getFrontendApiBaseUrl } from "@/app/components/apiBase";
import { showToast } from "@/app/components/Toast";
import { recordLastAccessedBizcard, resolveBizcardDisplayName } from "@/app/lib/lastAccessedBizcard";
import {
  detectPortalFromPath,
  getBizcardDetailEditPath,
  getBizcardListPath,
} from "@/app/config/portalNavigation";
import {
  DualQRDisplay,
  formatBizcardLocation,
  useBizcardDualQR,
} from "@/app/themes/QRCardDownload";
import { InlineLoader } from "@/app/components/Loader";
import { toServableMediaSrc } from "@/app/lib/portfolioDisplay";

const API_BASE_URL = getFrontendApiBaseUrl();

const ACCENT = "#2A4792";
const ACCENT_LIGHT = "#4785B8";

const FIELD_LABELS: { key: string; label: string }[] = [
  { key: "firstName", label: "First Name" },
  { key: "lastName", label: "Last Name" },
  { key: "email", label: "Email" },
  { key: "contactNumber", label: "Phone" },
  { key: "profileImg", label: "Profile Photo" },
  { key: "coverImg", label: "Cover Photo" },
  { key: "professionalTitle", label: "Professional Title" },
  { key: "bio", label: "Bio" },
  { key: "socials", label: "Social Links" },
  { key: "services", label: "Services" },
];

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.06, duration: 0.35, ease: [0.22, 1, 0.36, 1] },
  }),
};

function computeCompletion(bizcard: any): { percentage: number; fields: Record<string, boolean> } {
  const fields: Record<string, boolean> = {};
  let completed = 0;
  const total = FIELD_LABELS.length;

  const check = (key: string, value: any) => {
    const done = !!value && (typeof value !== "string" || value.trim().length > 0);
    fields[key] = done;
    if (done) completed++;
  };

  check("firstName", bizcard.first_name);
  check("lastName", bizcard.last_name);
  check("email", bizcard.email);
  check("contactNumber", bizcard.contact_number);
  check("profileImg", bizcard.profile_img);
  check("coverImg", bizcard.cover_img);
  check("professionalTitle", bizcard.professional_title);
  check("bio", bizcard.bio);

  const socialList = bizcard.social_links ?? bizcard.socials ?? [];
  check("socials", Array.isArray(socialList) && socialList.length > 0);

  const serviceList = bizcard.services ?? [];
  check(
    "services",
    Array.isArray(serviceList) &&
      serviceList.some((s: any) => s.is_visible !== false || s.name),
  );

  const percentage = Math.round((completed / total) * 100);
  return { percentage, fields };
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

function buildPortfolioUrl(alias: string): string {
  const cleanAlias = alias.trim().replace(/^\/+/, "");
  if (!cleanAlias) return "";
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}/${cleanAlias}`;
  }
  return `/${cleanAlias}`;
}

function resolveQrCodeSrc(bizcard: {
  qr_code_url?: string | null;
}): string | null {
  const stored = typeof bizcard.qr_code_url === "string" ? bizcard.qr_code_url.trim() : "";
  if (stored && (stored.startsWith("data:") || /^https?:\/\//i.test(stored))) {
    return stored;
  }
  return null;
}

function ShareCardDualQR({
  bizcard,
  bizcardId,
  portfolioCopyUrl,
  downloadingQr,
  onDownloadVcard,
}: {
  bizcard: Record<string, unknown>;
  bizcardId: string;
  portfolioCopyUrl: string;
  downloadingQr: boolean;
  onDownloadVcard: () => void;
}) {
  const { portfolioQrSrc, vcardQrSrc, loading } = useBizcardDualQR(
    bizcard as Parameters<typeof useBizcardDualQR>[0],
    portfolioCopyUrl,
  );

  return (
    <DualQRDisplay
      portfolioQrSrc={portfolioQrSrc}
      vcardQrSrc={vcardQrSrc}
      loading={loading}
      bizcardId={bizcardId}
      portfolioUrl={portfolioCopyUrl}
      email={String(bizcard.email ?? "")}
      phone={String(bizcard.contact_number ?? "")}
      location={formatBizcardLocation(bizcard as Parameters<typeof formatBizcardLocation>[0])}
      onDownloadVcard={onDownloadVcard}
      downloadingVcard={downloadingQr}
    />
  );
}

export default function BizcardDashboardPage() {
  const params = useParams<{ bizcardId: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const bizcardId = params.bizcardId;
  const portal = detectPortalFromPath(pathname ?? "");
  const bizcardListPath = getBizcardListPath(portal);
  const bizcardDetailEditPath = getBizcardDetailEditPath(portal, bizcardId ?? "");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bizcard, setBizcard] = useState<any>(null);
  const [inquiries, setInquiries] = useState<any[]>([]);
  const [downloadingQr, setDownloadingQr] = useState(false);
  const [stats, setStats] = useState({
    views: 0,
    contactsSaved: 0,
    totalInquiries: 0,
    unreadInquiries: 0,
  });

  useEffect(() => {
    if (!bizcardId) return;

    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const headers = buildAuthHeaders();
        const bizRes = await fetch(`${API_BASE_URL}/api/user/bizcards/${bizcardId}`, {
          credentials: "include",
          headers,
        });
        if (!bizRes.ok) {
          if (bizRes.status === 404) throw new Error("Bizcard not found.");
          throw new Error("Failed to load bizcard.");
        }
        const bizData = await bizRes.json();
        if (!bizData.success) throw new Error(bizData.error?.message || "Failed to load bizcard.");
        const card = bizData.data.bizcard;
        setBizcard(card);
        recordLastAccessedBizcard({
          bizcard_id: String(card.bizcard_id ?? bizcardId),
          serial_id: String(card.serial_id ?? ""),
          bizcard_name: resolveBizcardDisplayName(card),
          bizcard_theme: String(card.bizcard_theme ?? "elegant-dark"),
          created_at: card.created_at ? String(card.created_at) : undefined,
        });

        const views = card.stats?.views_count ?? 0;
        const contactsSaved = card.stats?.contacts_saved ?? 0;
        setStats({
          views,
          contactsSaved,
          totalInquiries: card.stats?.total_inquiries ?? 0,
          unreadInquiries: card.stats?.unread_inquiries ?? 0,
        });

        const inqRes = await fetch(
          `${API_BASE_URL}/api/inquiries?bizcard_id=${encodeURIComponent(bizcardId)}&limit=5`,
          {
          credentials: "include",
          headers,
        });
        if (inqRes.ok) {
          const inqData = await inqRes.json();
          const items = inqData.inquiries ?? inqData.data?.inquiries ?? [];
          setInquiries(Array.isArray(items) ? items : []);
        } else {
          console.warn("Failed to fetch inquiries for bizcard");
        }
      } catch (err: any) {
        setError(err.message || "An unexpected error occurred.");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [bizcardId]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
        <InlineLoader />
        <p className="text-sm font-medium text-slate-500">Loading BizCard…</p>
      </div>
    );
  }

  if (error || !bizcard) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center p-6">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 max-w-md w-full text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-900 mb-2">Unable to load BizCard</h2>
          <p className="text-slate-600">{error || "Bizcard not found."}</p>
          <button
            type="button"
            onClick={() => router.back()}
            className="mt-6 inline-flex items-center gap-2 px-4 py-2 bg-[#2A4792] text-white rounded-lg hover:bg-[#1a3375]"
          >
            <ArrowLeft className="h-4 w-4" />
            Go Back
          </button>
        </div>
      </div>
    );
  }

  const completion = computeCompletion(bizcard);
  const pct = completion.percentage;
  const pendingCount = FIELD_LABELS.filter((f) => !completion.fields[f.key]).length;

  const displayName =
    [bizcard.first_name, bizcard.last_name].filter(Boolean).join(" ") ||
    bizcard.bizcard_name ||
    "BizCard";
  const initials =
    displayName
      .split(" ")
      .map((n: string) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "?";

  const recentInquiries = inquiries.slice(0, 5);
  const publicPortfolioUrl = bizcard.url_alias ? buildPortfolioUrl(bizcard.url_alias) : "";
  const portfolioCopyUrl =
    bizcard.portfolio_url?.trim() ||
    publicPortfolioUrl;

  const handleCopyUrl = async () => {
    if (!portfolioCopyUrl) return;
    try {
      await navigator.clipboard.writeText(portfolioCopyUrl);
      showToast("Link copied!", "success");
    } catch {
      showToast("Could not copy link.", "error");
    }
  };

  const handleDownloadQr = async () => {
    if (!bizcardId || downloadingQr) return;
    setDownloadingQr(true);
    try {
      const headers = buildAuthHeaders();
      const response = await fetch(
        `${API_BASE_URL}/api/user/bizcards/${bizcardId}/qr-code/download`,
        { credentials: "include", headers }
      );
      if (response.ok) {
        const blob = await response.blob();
        const fileUrl = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = fileUrl;
        const disposition = response.headers.get("Content-Disposition") ?? "";
        const filenameMatch = disposition.match(/filename="([^"]+)"/i);
        anchor.download =
          filenameMatch?.[1] ?? `bizcard-${bizcardId}-offline-qr.png`;
        anchor.click();
        URL.revokeObjectURL(fileUrl);
      } else {
        const fallbackSrc = resolveQrCodeSrc(bizcard);
        if (fallbackSrc) {
          window.open(fallbackSrc, "_blank", "noopener,noreferrer");
        }
      }

      const refreshRes = await fetch(`${API_BASE_URL}/api/user/bizcards/${bizcardId}`, {
        credentials: "include",
        headers,
      });
      if (refreshRes.ok) {
        const refreshData = await refreshRes.json();
        if (refreshData.success) {
          setBizcard(refreshData.data.bizcard);
        }
      }
    } catch {
      const fallbackSrc = resolveQrCodeSrc(bizcard);
      if (fallbackSrc) {
        window.open(fallbackSrc, "_blank", "noopener,noreferrer");
      }
    } finally {
      setDownloadingQr(false);
    }
  };

  const statItems = [
    { label: "Views", value: stats.views.toLocaleString(), icon: Eye },
    { label: "Saved", value: stats.contactsSaved.toLocaleString(), icon: BookmarkCheck },
    { label: "Inquiries", value: stats.totalInquiries.toLocaleString(), icon: Mail },
    { label: "Unread", value: stats.unreadInquiries.toLocaleString(), icon: Activity, highlight: stats.unreadInquiries > 0 },
  ];

  return (
    <div className="h-full w-full bg-slate-50">
      <div className="mx-auto max-w-6xl space-y-5 sm:space-y-6 py-5 sm:py-7">
        {/* Breadcrumb */}
        <motion.nav
          custom={0}
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="flex items-center gap-2 text-sm"
        >
          <Link
            href={bizcardListPath}
            className="inline-flex items-center gap-1.5 font-medium text-slate-500 hover:text-[#2A4792] transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            My BizCards
          </Link>
          <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
          <span className="font-semibold text-slate-800 truncate">{bizcard.bizcard_name}</span>
        </motion.nav>

        {/* Profile hero */}
        <motion.section
          custom={1}
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
        >
          <div className="relative h-28 sm:h-48">
            {bizcard.cover_img ? (
              <img
                src={toServableMediaSrc(bizcard.cover_img)}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <div
                className="h-full w-full"
                style={{
                  background: `linear-gradient(120deg, ${ACCENT} 0%, ${ACCENT_LIGHT} 55%, #5b9fd4 100%)`,
                }}
              />
            )}
            <div className="absolute inset-0 bg-linear-to-t from-black/35 via-black/5 to-transparent" />
          </div>

          <div className="relative px-5 sm:px-7 pb-5 sm:pb-6">
            <div className="-mt-10 sm:-mt-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex items-end gap-4 min-w-0">
                <div className="h-20 w-20 sm:h-24 sm:w-24 shrink-0 rounded-2xl border-4 border-white bg-slate-100 shadow-md overflow-hidden flex items-center justify-center text-lg font-bold text-[#2A4792]">
                  {bizcard.profile_img ? (
                    <img
                      src={toServableMediaSrc(bizcard.profile_img)}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    initials
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 sm:mb-1">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                        bizcard.is_active
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          bizcard.is_active ? "bg-emerald-500" : "bg-slate-400"
                        }`}
                      />
                      {bizcard.is_active ? "Active" : "Inactive"}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                      {bizcard.bizcard_type || "Virtual"}
                    </span>
                  </div>
                  <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight truncate">
                    {bizcard.bizcard_name}
                  </h1>
                  <p className="text-sm text-slate-500 font-medium truncate mt-0.5">
                    {displayName}
                    {bizcard.professional_title ? ` · ${bizcard.professional_title}` : ""}
                  </p>
                </div>
              </div>

              <div className="hidden flex-wrap gap-2 sm:flex sm:shrink-0">
                <Link
                  href={publicPortfolioUrl || "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:border-[#4785B8]/40 hover:text-[#2A4792] transition-all"
                >
                  <ExternalLink className="h-4 w-4" />
                  View Live
                </Link>
                <Link
                  href={bizcardDetailEditPath}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#2A4792] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#1a3375] transition-all"
                >
                  <PencilLine className="h-4 w-4" />
                  Edit
                </Link>
              </div>
            </div>
          </div>
        </motion.section>

        <div className="flex flex-wrap gap-2 sm:hidden">
          <Link
            href={publicPortfolioUrl || "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm"
          >
            <ExternalLink className="h-4 w-4" />
            View Live
          </Link>
          <Link
            href={bizcardDetailEditPath}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#2A4792] px-4 py-2.5 text-sm font-semibold text-white shadow-sm"
          >
            <PencilLine className="h-4 w-4" />
            Edit
          </Link>
        </div>

        {/* Stats ribbon */}
        <motion.div
          custom={2}
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="grid grid-cols-1 gap-3 rounded-2xl border border-gray-100 bg-white p-3 shadow-sm sm:grid-cols-2 lg:grid-cols-4 sm:gap-0 sm:divide-x sm:divide-slate-100 sm:p-0"
        >
          {statItems.map((s) => (
            <div key={s.label} className="flex items-center gap-3 px-4 py-4 sm:px-5 sm:py-5">
              <div
                className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0"
                style={{ backgroundColor: `${ACCENT}12` }}
              >
                <s.icon
                  className="h-4 w-4"
                  style={{ color: s.highlight ? "#B91C1C" : ACCENT }}
                />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  {s.label}
                </p>
                <p
                  className={`text-xl sm:text-2xl font-black tracking-tight ${
                    s.highlight ? "text-red-600" : "text-slate-900"
                  }`}
                >
                  {s.value}
                </p>
              </div>
            </div>
          ))}
        </motion.div>

        {/* Main content: QR sidebar + completion */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6">
          {/* Share & QR panel */}
          <motion.aside
            custom={3}
            variants={fadeUp}
            initial="hidden"
            animate="show"
            className="lg:col-span-4 rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col"
          >
            <div className="border-b border-slate-100 px-5 py-4 flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-[#4785B8]/10 flex items-center justify-center">
                <QrCode className="h-4 w-4 text-[#4785B8]" />
              </div>
              <div>
                <h2 className="text-sm font-extrabold text-slate-900">Share Card</h2>
                <p className="text-xs text-slate-500">Scan or copy your link</p>
              </div>
            </div>

            <div className="p-5 flex flex-col items-center flex-1">
              <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 p-4 w-full">
                <ShareCardDualQR
                  bizcard={bizcard}
                  bizcardId={bizcardId ?? ""}
                  portfolioCopyUrl={portfolioCopyUrl}
                  downloadingQr={downloadingQr}
                  onDownloadVcard={() => { void handleDownloadQr(); }}
                />
              </div>
              <p className="mt-2 text-[10px] font-medium text-slate-400 uppercase tracking-wider text-center">
                Tap a QR to download
              </p>

              {bizcard.url_alias && (
                <div className="mt-4 w-full">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                    Public URL
                  </p>
                  <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <Link2 className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    <span className="text-xs font-mono text-slate-600 truncate flex-1">
                      /{bizcard.url_alias}
                    </span>
                    <button
                      type="button"
                      onClick={handleCopyUrl}
                      className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-white hover:text-[#2A4792] transition-colors"
                      aria-label="Copy portfolio URL"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}

              <div className="mt-5 w-full grid grid-cols-2 gap-2">
                <a
                  href={publicPortfolioUrl || "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open
                </a>
                <Link
                  href={bizcardDetailEditPath}
                  className="flex items-center justify-center gap-1.5 rounded-xl bg-[#2A4792] py-2.5 text-xs font-bold text-white hover:bg-[#1a3375] transition-colors"
                >
                  <PencilLine className="h-3.5 w-3.5" />
                  Edit
                </Link>
              </div>
            </div>
          </motion.aside>

          {/* Completion checklist */}
          <motion.section
            custom={4}
            variants={fadeUp}
            initial="hidden"
            animate="show"
            className="lg:col-span-8 rounded-2xl border border-slate-200 bg-white shadow-sm flex flex-col overflow-hidden"
          >
            <div className="border-b border-slate-100 px-5 sm:px-6 py-4 sm:py-5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h2 className="text-sm font-extrabold text-slate-900">Profile Completeness</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {pct === 100
                      ? "Your card is fully set up."
                      : `${pendingCount} field${pendingCount !== 1 ? "s" : ""} still needed`}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 sm:w-40 h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700 ease-out"
                      style={{
                        width: `${pct}%`,
                        background: `linear-gradient(90deg, ${ACCENT}, ${ACCENT_LIGHT})`,
                      }}
                    />
                  </div>
                  <span className="text-lg font-black text-[#2A4792] tabular-nums w-12 text-right">
                    {pct}%
                  </span>
                </div>
              </div>
            </div>

            <div className="p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 gap-2 flex-1">
              {FIELD_LABELS.map(({ key, label }) => {
                const done = completion.fields[key] || false;
                return (
                  <div
                    key={key}
                    className={`flex items-center gap-3 rounded-xl px-3.5 py-3 border transition-colors ${
                      done
                        ? "border-emerald-100 bg-emerald-50/40"
                        : "border-slate-100 bg-slate-50/60 hover:border-[#4785B8]/25"
                    }`}
                  >
                    {done ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                    ) : (
                      <div className="h-4 w-4 rounded-full border-2 border-slate-300 shrink-0" />
                    )}
                    <span
                      className={`text-sm font-medium ${
                        done ? "text-slate-500 line-through decoration-slate-300" : "text-slate-800"
                      }`}
                    >
                      {label}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="border-t border-slate-100 px-5 py-4 bg-slate-50/50">
              <Link
                href={bizcardDetailEditPath}
                className="w-full flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white transition-all hover:opacity-90 active:scale-[0.99]"
                style={{
                  background:
                    pct === 100
                      ? "linear-gradient(135deg,#10b981,#059669)"
                      : `linear-gradient(135deg,${ACCENT},${ACCENT_LIGHT})`,
                }}
              >
                {pct === 100 ? "Manage BizCard" : "Complete Setup"}
                <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          </motion.section>
        </div>

        {/* Inquiries timeline */}
        <motion.section
          custom={5}
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden"
        >
          <div className="border-b border-slate-100 px-5 sm:px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-lg bg-[#4785B8]/10 flex items-center justify-center">
                <Mail className="h-4 w-4 text-[#4785B8]" />
              </div>
              <div>
                <h2 className="text-sm font-extrabold text-slate-900">Recent Inquiries</h2>
                <p className="text-xs text-slate-500">Messages from visitors</p>
              </div>
            </div>
            {stats.unreadInquiries > 0 && (
              <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-[10px] font-bold text-red-700">
                {stats.unreadInquiries} unread
              </span>
            )}
          </div>

          <div className="p-4 sm:p-5">
            {recentInquiries.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="h-14 w-14 rounded-2xl bg-slate-100 flex items-center justify-center mb-3">
                  <Mail className="h-6 w-6 text-slate-300" />
                </div>
                <p className="text-sm font-semibold text-slate-600">No inquiries yet</p>
                <p className="text-xs text-slate-400 mt-1 max-w-xs">
                  When visitors contact you through this BizCard, their messages will show up here.
                </p>
              </div>
            ) : (
              <div className="relative space-y-0">
                <div className="absolute left-[19px] top-3 bottom-3 w-px bg-slate-200 hidden sm:block" />
                {recentInquiries.map((inq, idx) => (
                  <div
                    key={inq.inquiry_id}
                    className={`relative flex gap-4 py-3 ${
                      idx !== recentInquiries.length - 1 ? "border-b border-slate-50 sm:border-0" : ""
                    }`}
                  >
                    <div className="relative z-10 h-10 w-10 shrink-0 rounded-full border-2 border-white bg-slate-100 shadow-sm flex items-center justify-center">
                      <span className="text-sm font-bold text-[#2A4792]">
                        {inq.visitor_name?.[0]?.toUpperCase() ?? "?"}
                      </span>
                      {(inq.status === "new" || inq.status === "unread") && (
                        <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-red-500 border-2 border-white" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1 pt-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-bold text-slate-900 truncate">
                          {inq.visitor_name || "Anonymous"}
                        </p>
                        <time className="text-[10px] font-semibold text-slate-400 shrink-0 tabular-nums">
                          {new Date(inq.created_at).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                          })}
                        </time>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5 truncate">
                        {inq.subject || "No subject"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </motion.section>
      </div>
    </div>
  );
}
