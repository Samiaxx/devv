import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface CardProps {
  children: ReactNode;
  className?: string;
  /** Adds a left-side colored accent border */
  accent?: "indigo" | "green" | "yellow" | "red" | "none";
}

const accentMap = {
  indigo: "border-l-4 border-l-indigo-500",
  green:  "border-l-4 border-l-green-500",
  yellow: "border-l-4 border-l-yellow-500",
  red:    "border-l-4 border-l-red-500",
  none:   "",
};

export function Card({ children, className, accent = "none" }: CardProps) {
  return (
    <div
      className={cn(
        "bg-slate-900 border border-slate-800 rounded-2xl",
        accentMap[accent],
        className
      )}
    >
      {children}
    </div>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("px-6 py-5", className)}>{children}</div>;
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4">
      {children}
    </p>
  );
}
