"use client";

/**
 * Full-screen loading splash shown while the app hydrates wallet state.
 * Displayed for a minimum of ~1.5s so it feels intentional, not a flash.
 */
export function AppLoadingScreen({ message }: { message?: string }) {
  return (
    <div className="fixed inset-0 bg-[#030712] flex flex-col items-center justify-center z-50">
      {/* Logo mark */}
      <div className="relative mb-8">
        <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-3xl">
          🏅
        </div>
        {/* Pulse ring */}
        <div className="absolute inset-0 rounded-2xl border border-indigo-500/30 animate-ping opacity-30" />
      </div>

      {/* Brand */}
      <h1 className="text-lg font-semibold text-white mb-1">Proof of Dev</h1>
      <p className="text-xs text-slate-600 mb-8">On-chain developer activity profile</p>

      {/* Loading indicator */}
      <div className="flex items-center gap-2 text-slate-500 text-sm">
        <LoadingDots />
        <span>{message ?? "Loading"}</span>
      </div>
    </div>
  );
}

/** Three animated dots */
function LoadingDots() {
  return (
    <div className="flex items-center gap-1" aria-label="Loading">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce"
          style={{ animationDelay: `${i * 150}ms`, animationDuration: "0.8s" }}
        />
      ))}
    </div>
  );
}
