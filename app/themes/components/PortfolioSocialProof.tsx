"use client";

import React, { useEffect, useState } from "react";
import { Users } from "lucide-react";
import type { PortfolioData } from "@/app/types";

export type PortfolioSocialProofTheme = {
  surface: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  accentSoft?: string;
  divider?: string;
  shadow?: string;
  radius?: string;
  backdropFilter?: string;
  fontFamily?: string;
};

type MutualAssociate = {
  id: string;
  name: string;
  profileUrl: string | null;
  portfolioUrl: string | null;
  position: string | null;
};

type SocialProofPayload = {
  showAssociateCount: boolean;
  showMutualAssociates: boolean;
  associateCount: number | null;
  associateCountLabel: string | null;
  viewerAuthenticated: boolean;
  isOwner?: boolean;
  mutuals: MutualAssociate[];
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export default function PortfolioSocialProof({
  data,
  mini = false,
  theme,
  className = "",
}: {
  data?: PortfolioData;
  mini?: boolean;
  theme: PortfolioSocialProofTheme;
  className?: string;
}) {
  const alias = data?.bizCard?.urlAlias?.trim() ?? "";
  const enabled =
    Boolean(data?.showAssociateCount) || Boolean(data?.showMutualAssociates);
  const [payload, setPayload] = useState<SocialProofPayload | null>(
    enabled
      ? {
          showAssociateCount: Boolean(data?.showAssociateCount),
          showMutualAssociates: Boolean(data?.showMutualAssociates),
          associateCount: data?.associateCount ?? null,
          associateCountLabel: data?.associateCountLabel ?? null,
          viewerAuthenticated: false,
          mutuals: data?.mutualAssociates ?? [],
        }
      : null,
  );

  useEffect(() => {
    if (!enabled || !alias || mini) return;
    let cancelled = false;
    void fetch(`/api/portfolio/${encodeURIComponent(alias)}/social-proof`, {
      credentials: "include",
      cache: "no-store",
    })
      .then(async (res) => (res.ok ? ((await res.json()).data as SocialProofPayload) : null))
      .then((next) => {
        if (!cancelled && next) setPayload(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [alias, enabled, mini]);

  if (!enabled || !payload) return null;

  const countLabel =
    payload.associateCountLabel ||
    (mini && payload.showAssociateCount ? "Associates" : null);
  const showCount = Boolean(payload.showAssociateCount && countLabel);
  const showMutuals =
    Boolean(payload.showMutualAssociates) &&
    (mini || (payload.viewerAuthenticated && !payload.isOwner));
  if (!showCount && !showMutuals) return null;

  const avatarBg = theme.accentSoft ?? `${theme.accent}22`;
  const divider = theme.divider ?? theme.border;

  return (
    <div className={`w-full ${className}`.trim()}>
      <div
        style={{
          background: theme.surface,
          border: `1px solid ${theme.border}`,
          boxShadow: theme.shadow,
          borderRadius: theme.radius ?? 20,
          backdropFilter: theme.backdropFilter,
          WebkitBackdropFilter: theme.backdropFilter,
          fontFamily: theme.fontFamily,
          padding: mini ? "10px 12px" : "14px 16px",
        }}
      >
        {showCount && (
          <div
            className="flex items-center justify-center gap-2 text-sm font-semibold"
            style={{ color: theme.accent }}
          >
            <Users className="h-4 w-4 shrink-0" />
            <span>{countLabel}</span>
          </div>
        )}

        {showMutuals && (
          <div
            className={showCount ? "mt-3 pt-3" : ""}
            style={showCount ? { borderTop: `1px solid ${divider}` } : undefined}
          >
            {mini && payload.mutuals.length === 0 ? (
              <p className="text-center text-xs" style={{ color: theme.muted }}>
                Mutual associates appear here for signed-in visitors.
              </p>
            ) : payload.mutuals.length === 0 ? (
              <p className="text-center text-xs" style={{ color: theme.muted }}>
                No mutual associates yet.
              </p>
            ) : (
              <div>
                <p
                  className="mb-2 text-center text-[11px] font-semibold uppercase tracking-wide"
                  style={{ color: theme.muted }}
                >
                  {payload.mutuals.length} mutual associate
                  {payload.mutuals.length === 1 ? "" : "s"}
                </p>
                <div className="flex justify-center gap-2 overflow-x-auto pb-1">
                  {payload.mutuals.map((person) => {
                    const content = (
                      <>
                        {person.profileUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={person.profileUrl}
                            alt=""
                            className="h-10 w-10 rounded-full object-cover"
                            style={{ border: `1px solid ${theme.border}` }}
                          />
                        ) : (
                          <span
                            className="flex h-10 w-10 items-center justify-center rounded-full text-[11px] font-bold"
                            style={{ background: avatarBg, color: theme.accent }}
                          >
                            {initials(person.name)}
                          </span>
                        )}
                        <span
                          className="w-16 truncate text-center text-[11px] font-medium"
                          style={{ color: theme.text }}
                        >
                          {person.name.split(" ")[0]}
                        </span>
                      </>
                    );
                    return person.portfolioUrl ? (
                      <a
                        key={person.id}
                        href={person.portfolioUrl}
                        className="flex w-16 shrink-0 flex-col items-center gap-1 rounded-xl p-1 transition-opacity hover:opacity-80"
                        title={person.name}
                      >
                        {content}
                      </a>
                    ) : (
                      <div
                        key={person.id}
                        className="flex w-16 shrink-0 flex-col items-center gap-1 p-1"
                        title={person.name}
                      >
                        {content}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
