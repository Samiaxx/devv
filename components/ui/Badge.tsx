import { cn } from "@/lib/utils";

type BadgeVariant = "green" | "gray" | "indigo" | "yellow" | "red";

interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
  dot?: boolean;
}

const variantMap: Record<BadgeVariant, string> = {
  green:  "bg-green-500/10 text-green-400 ring-1 ring-green-500/20",
  gray:   "bg-slate-700/60 text-slate-400 ring-1 ring-slate-600/40",
  indigo: "bg-indigo-500/10 text-indigo-400 ring-1 ring-indigo-500/20",
  yellow: "bg-yellow-500/10 text-yellow-400 ring-1 ring-yellow-500/20",
  red:    "bg-red-500/10 text-red-400 ring-1 ring-red-500/20",
};

const dotMap: Record<BadgeVariant, string> = {
  green:  "bg-green-400",
  gray:   "bg-slate-400",
  indigo: "bg-indigo-400",
  yellow: "bg-yellow-400",
  red:    "bg-red-400",
};

export function Badge({ label, variant = "gray", dot = false }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium",
        variantMap[variant]
      )}
    >
      {dot && (
        <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", dotMap[variant])} />
      )}
      {label}
    </span>
  );
}
