import { ReactNode } from "react";
import { cn } from "@/lib/utils";

type NoticeVariant = "warning" | "info" | "error" | "success";

interface NoticeBoxProps {
  variant?: NoticeVariant;
  children: ReactNode;
  className?: string;
}

const styles: Record<NoticeVariant, { wrap: string; icon: string; iconChar: string }> = {
  warning: {
    wrap: "bg-yellow-500/8 border border-yellow-500/20",
    icon: "text-yellow-400",
    iconChar: "⚠",
  },
  info: {
    wrap: "bg-slate-800/60 border border-slate-700/60",
    icon: "text-slate-400",
    iconChar: "ℹ",
  },
  error: {
    wrap: "bg-red-500/8 border border-red-500/20",
    icon: "text-red-400",
    iconChar: "✕",
  },
  success: {
    wrap: "bg-green-500/8 border border-green-500/20",
    icon: "text-green-400",
    iconChar: "✓",
  },
};

export function NoticeBox({ variant = "info", children, className }: NoticeBoxProps) {
  const s = styles[variant];
  return (
    <div className={cn("rounded-xl px-4 py-3 flex items-start gap-3", s.wrap, className)}>
      <span className={cn("text-sm flex-shrink-0 mt-0.5 font-medium", s.icon)}>
        {s.iconChar}
      </span>
      <div className="text-sm text-slate-300/90 leading-relaxed">{children}</div>
    </div>
  );
}
