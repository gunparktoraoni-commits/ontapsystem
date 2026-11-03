"use client";

import { motion } from "framer-motion";

export function progressPercent(current: number, target: number) {
  if (target <= 0) return 0;
  return Math.min(100, Math.round((current / target) * 100));
}

export function ProgressBar({
  current,
  target,
  completed,
}: {
  current: number;
  target: number;
  completed?: boolean;
}) {
  const pct = progressPercent(current, target);
  return (
    <div className="h-2 overflow-hidden rounded-full bg-[#D5DDEF]">
      <motion.div
        className={`h-full rounded-full ${
          completed
            ? "bg-emerald-500"
            : "bg-[linear-gradient(90deg,#20387D,#4785B8)]"
        }`}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.45, ease: "easeOut" }}
      />
    </div>
  );
}

export type MilestoneItem = {
  key: string;
  title: string;
  target: number;
  completed: boolean;
};

export function ProgressMilestoneBar({
  milestones,
  qualified,
}: {
  milestones: MilestoneItem[];
  qualified: number;
}) {
  if (!milestones.length) return null;
  const max = Math.max(...milestones.map((m) => m.target), 1);
  const fill = Math.min(100, (qualified / max) * 100);

  return (
    <div className="mt-5">
      <div className="relative h-1.5 rounded-full bg-[#D5DDEF]">
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full bg-[linear-gradient(90deg,#20387D,#4785B8)]"
          initial={{ width: 0 }}
          animate={{ width: `${fill}%` }}
          transition={{ duration: 0.5 }}
        />
        {milestones.map((m) => {
          const left = (m.target / max) * 100;
          const reached = qualified >= m.target;
          return (
            <div
              key={m.key}
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${left}%` }}
              title={`${m.title}: ${m.target}`}
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full border-2 text-[9px] font-bold ${
                  reached
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : "border-[#2A4792] bg-white text-[#2A4792]"
                }`}
              >
                {reached ? "✓" : m.target}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex justify-between text-[10px] font-semibold text-gray-400">
        <span>Start</span>
        <span>{max} qualified</span>
      </div>
    </div>
  );
}
