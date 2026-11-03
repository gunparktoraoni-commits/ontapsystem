"use client";

import { useEffect, useState } from "react";
import { toServableMediaSrc } from "@/app/lib/portfolioDisplay";
import { getInitials } from "./messagesUtils";

const SIZE_PX = {
  sm: 40,
  md: 48,
  lg: 56,
  xl: 96,
} as const;

export default function ClientAvatar({
  name,
  profileUrl,
  size = "md",
}: {
  name: string;
  profileUrl?: string | null;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const sizeClasses = {
    sm: "h-10 w-10 text-xs",
    md: "h-12 w-12 text-sm",
    lg: "h-14 w-14 text-base",
    xl: "h-24 w-24 text-2xl",
  }[size];
  const px = SIZE_PX[size];

  const trimmed = profileUrl?.trim() ?? "";
  const servableSrc = trimmed ? toServableMediaSrc(trimmed) : "";
  const showImage = Boolean(servableSrc) && !imgFailed;

  useEffect(() => {
    setImgFailed(false);
  }, [servableSrc]);

  if (showImage) {
    return (
      <img
        src={servableSrc}
        alt={name}
        width={px}
        height={px}
        className={`${sizeClasses} shrink-0 rounded-full object-cover border border-gray-100 bg-white`}
        draggable={false}
        decoding="async"
        onError={() => setImgFailed(true)}
      />
    );
  }

  return (
    <div
      className={`${sizeClasses} shrink-0 rounded-full bg-[#2A4792] text-white font-semibold flex items-center justify-center border border-gray-100`}
      aria-hidden
    >
      {getInitials(name)}
    </div>
  );
}
