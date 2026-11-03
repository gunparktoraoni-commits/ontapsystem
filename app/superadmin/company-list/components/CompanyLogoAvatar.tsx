"use client";

import { useEffect, useState } from "react";
import { toServableMediaSrc } from "@/app/lib/portfolioDisplay";

type CompanyLogoAvatarProps = {
  name: string;
  logoUrl: string | null | undefined;
  className?: string;
};

export function CompanyLogoAvatar({ name, logoUrl, className }: CompanyLogoAvatarProps) {
  const [failed, setFailed] = useState(false);
  const trimmed = logoUrl?.trim() ?? "";
  const servableSrc = trimmed ? toServableMediaSrc(trimmed) : "";
  const showImage = Boolean(servableSrc) && !failed;

  useEffect(() => {
    setFailed(false);
  }, [servableSrc]);

  const initials = (() => {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    const first = parts[0]?.[0] ?? "";
    const second = parts[1]?.[0] ?? parts[0]?.[1] ?? "";
    return `${first}${second}`.toUpperCase() || "--";
  })();

  // Always keep a flex shell so fallback initials stay centered even when
  // callers pass image-oriented classes (e.g. object-cover) via className.
  const shellClassName = [
    "inline-flex shrink-0 items-center justify-center overflow-hidden bg-primary/10 text-sm font-semibold text-primary",
    className ?? "aspect-square h-12 w-12 rounded-xl",
  ].join(" ");

  return (
    <span className={shellClassName}>
      {showImage ? (
        <img
          src={servableSrc}
          alt={`${name} logo`}
          width={48}
          height={48}
          className="h-full w-full object-cover"
          draggable={false}
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        initials
      )}
    </span>
  );
}
