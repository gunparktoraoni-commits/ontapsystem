"use client";

export type MissionRewardPreview = {
  id: string;
  name: string;
  description: string | null;
  type: string;
  status: string;
  duration_days: number | null;
  theme_id: string | null;
  theme_name: string | null;
  theme_path: string | null;
  theme_preview_image: string | null;
  theme_tag: string | null;
  feature_key: string | null;
  user_reward_status: string | null;
  user_reward_id: string | null;
};

export function rewardTypeLabel(type: string) {
  if (type === "premium_access") return "Premium Access";
  if (type === "theme_access") return "Premium Theme";
  if (type === "feature_access") return "Feature Access";
  return type;
}

export function RewardPreviewBlock({
  reward,
  target,
  compact,
}: {
  reward: MissionRewardPreview | null;
  target: number;
  compact?: boolean;
}) {
  if (!reward) {
    return (
      <div className="rounded-xl border border-dashed border-[#d8deee] bg-[#F8FAFD] px-3 py-2.5 text-xs text-gray-500">
        No reward assigned yet.
      </div>
    );
  }

  const unlocked = Boolean(reward.user_reward_status);
  const title =
    reward.type === "theme_access"
      ? reward.theme_name || reward.name
      : reward.type === "premium_access"
        ? `${reward.duration_days ?? "—"} Days Premium`
        : reward.feature_key || reward.name;

  return (
    <div
      className={`flex gap-3 rounded-xl border border-[#e8edf7] bg-[#F8FAFD] ${
        compact ? "p-2.5" : "p-3"
      }`}
    >
      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-white border border-[#e8edf7]">
        {reward.type === "theme_access" && reward.theme_preview_image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={reward.theme_preview_image}
            alt={title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-lg">
            {reward.type === "premium_access"
              ? "🎁"
              : reward.type === "feature_access"
                ? "✨"
                : "🎨"}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-gray-900">{title}</p>
        <p className="text-[11px] font-semibold text-gray-500">
          {rewardTypeLabel(reward.type)}
        </p>
        <p className="mt-1 text-[11px] text-gray-500">
          {unlocked
            ? "✓ Unlocked"
            : `🔒 Unlock at ${target} qualified referrals`}
        </p>
      </div>
    </div>
  );
}
