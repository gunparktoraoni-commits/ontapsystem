"use client";

import { useEffect, useState } from "react";
import { BookmarkCheck, MapPin } from "lucide-react";
import { InlineLoader } from "./Loader";
import { toServableMediaSrc } from "../lib/portfolioDisplay";
import { buildImpersonationHeaders } from "@/app/lib/superadminImpersonationHandoff";

type ContactSaveItem = {
  id: string;
  isAnonymous: boolean;
  name: string;
  profileUrl: string | null;
  customUri: string | null;
  saveType: string;
  location: string | null;
  createdAt: string;
  timeAgo: string;
};

export default function ContactSavesPage() {
  const [items, setItems] = useState<ContactSaveItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/dashboard/contact-saves", {
          credentials: "include",
          headers: { ...buildImpersonationHeaders() },
        });
        if (!res.ok) throw new Error("Unable to load contact saves.");
        const payload = (await res.json()) as { items?: ContactSaveItem[] };
        if (!cancelled) setItems(Array.isArray(payload.items) ? payload.items : []);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unable to load contact saves.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">Contact Saves</h1>
        <p className="mt-1 text-sm text-gray-500">
          People who saved your contact, including guests and where they accessed your portfolio.
        </p>
      </div>

      <div className="overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <InlineLoader />
          </div>
        ) : error ? (
          <p className="px-6 py-12 text-center text-sm font-medium text-rose-600">{error}</p>
        ) : items.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#2A4792]/10">
              <BookmarkCheck className="h-5 w-5 text-[#2A4792]" />
            </div>
            <p className="text-sm font-semibold text-gray-800">No contact saves yet</p>
            <p className="mt-1 text-xs text-gray-500">
              When someone saves your card, they will appear here.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-50">
            {items.map((item) => {
              const src = item.profileUrl ? toServableMediaSrc(item.profileUrl) : null;
              const content = (
                <div className="flex items-start gap-3 px-5 py-4">
                  {src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={src}
                      alt=""
                      className="h-11 w-11 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#2A4792] text-xs font-bold text-white">
                      {item.name.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-gray-900">{item.name}</p>
                    <p className="mt-0.5 text-xs font-medium capitalize text-gray-500">
                      Saved as {item.saveType === "phone" ? "phone contact" : "vCard"}
                    </p>
                    {item.isAnonymous && (
                      <p className="mt-1 inline-flex items-center gap-1 text-xs text-gray-500">
                        <MapPin className="h-3.5 w-3.5" />
                        {item.location || "Location unavailable"}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 text-[11px] font-semibold text-gray-400">
                    {item.timeAgo}
                  </span>
                </div>
              );
              return (
                <li key={item.id}>
                  {item.customUri ? (
                    <a href={`/${encodeURIComponent(item.customUri)}`} className="block hover:bg-slate-50">
                      {content}
                    </a>
                  ) : (
                    content
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
