"use client";

import { useEffect, useRef, useState } from "react";

type Status = "online" | "degraded" | "offline" | "checking";

interface WorkerHealth {
  status: string;
  mongodb: string;
  uptime?: number;
}

const POLL_INTERVAL = 20_000; // 20 seconds

export function WorkerStatus() {
  const [health, setHealth] = useState<WorkerHealth | null>(null);
  const [workerStatus, setWorkerStatus] = useState<Status>("checking");
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);

  async function fetchStatus() {
    try {
      const res = await fetch("/api/worker-status", { cache: "no-store" });
      const data: WorkerHealth = await res.json();
      setHealth(data);

      if (data.status === "offline" || data.status === "error") {
        setWorkerStatus("offline");
      } else if (data.mongodb === "unavailable") {
        setWorkerStatus("degraded");
      } else {
        setWorkerStatus("online");
      }
    } catch {
      setWorkerStatus("offline");
      setHealth(null);
    }
  }

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, []);

  // Close tooltip when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target as Node)) {
        setShowTooltip(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const dot: Record<Status, string> = {
    online:   "bg-emerald-400",
    degraded: "bg-yellow-400",
    offline:  "bg-red-500",
    checking: "bg-slate-600 animate-pulse",
  };

  const label: Record<Status, string> = {
    online:   "Worker online",
    degraded: "Worker degraded",
    offline:  "Worker offline",
    checking: "Checking…",
  };

  const tooltipContent: Record<Status, { title: string; body: string }> = {
    online: {
      title: "Worker is running",
      body:  "The background analysis worker and MongoDB are both available. Job results are persisted.",
    },
    degraded: {
      title: "Worker running, no persistence",
      body:  "The worker is processing jobs but MongoDB is unavailable. Analysis works normally — results won't be saved to history.",
    },
    offline: {
      title: "Worker is offline",
      body:  "The background worker (server/api.js) is not running. Analysis requests will fail. Run `npm run dev` to start it.",
    },
    checking: {
      title: "Checking worker status…",
      body:  "Connecting to the background worker to check its status.",
    },
  };

  const tooltip = tooltipContent[workerStatus];

  return (
    <div className="relative flex items-center gap-1.5" ref={tooltipRef}>
      {/* Status dot + label */}
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dot[workerStatus]}`} />
      <span className="text-xs text-slate-600">{label[workerStatus]}</span>

      {/* Info button */}
      <button
        onClick={() => setShowTooltip((v) => !v)}
        aria-label="Worker status info"
        className="w-4 h-4 rounded-full border border-slate-700 text-slate-600 hover:text-slate-400 hover:border-slate-500 flex items-center justify-center text-[10px] font-bold transition-colors leading-none"
      >
        i
      </button>

      {/* Tooltip — opens downward since component is in the header */}
      {showTooltip && (
        <div className="absolute top-full right-0 mt-2 w-64 bg-slate-900 border border-slate-700 rounded-xl p-3 shadow-xl z-50 text-left">
          <p className="text-xs font-semibold text-slate-200 mb-1">{tooltip.title}</p>
          <p className="text-xs text-slate-500 leading-relaxed">{tooltip.body}</p>
          {health?.uptime !== undefined && workerStatus !== "offline" && (
            <p className="text-xs text-slate-700 mt-2 pt-2 border-t border-slate-800">
              Uptime: {formatUptime(health.uptime)}
            </p>
          )}
          {/* Arrow */}
          <div className="absolute top-[-5px] right-4 w-2.5 h-2.5 bg-slate-900 border-l border-t border-slate-700 rotate-45" />
        </div>
      )}
    </div>
  );
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}
