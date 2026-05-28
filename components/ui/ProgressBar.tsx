"use client";

import { cn } from "@/lib/utils";

interface ProgressBarProps {
  value: number;   // 0–100
  color?: "indigo" | "green" | "yellow";
  className?: string;
}

const colorMap = {
  indigo: "bg-indigo-500",
  green:  "bg-green-500",
  yellow: "bg-yellow-500",
};

export function ProgressBar({ value, color = "indigo", className }: ProgressBarProps) {
  const pct = Math.min(100, Math.max(0, value));

  return (
    <div className={cn("h-1.5 w-full bg-slate-800 rounded-full overflow-hidden", className)}>
      <div
        className={cn("h-full rounded-full progress-fill", colorMap[color])}
        style={{ "--target-width": `${pct}%`, width: `${pct}%` } as React.CSSProperties}
      />
    </div>
  );
}
