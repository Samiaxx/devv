"use client";

import { AnalysisResponse } from "@/lib/types";
import { ScoreCard } from "./ScoreCard";
import { ContractList } from "./ContractList";
import { ENSCard } from "./ENSCard";
import { MintButton } from "./MintButton";
import { AttestButton } from "./AttestButton";
import { EndorseButton } from "./EndorseButton";
import { NoticeBox } from "@/components/ui/NoticeBox";

interface AnalysisDashboardProps {
  analysis: AnalysisResponse;
  network: "mainnet" | "sepolia";
}

export function AnalysisDashboard({ analysis, network }: AnalysisDashboardProps) {
  const analyzedDate = new Date(analysis.analyzedAt * 1000).toLocaleString();
  const { profile } = analysis;

  // Last warning is always the base disclaimer; rest are data/scoring notices
  const notices = profile.warnings.slice(0, -1);
  const disclaimer = profile.warnings[profile.warnings.length - 1];

  return (
    <div className="space-y-4">
      {/* ── Disclaimer ─────────────────────────────────────────────────────── */}
      <div className="animate-fade-in-up">
        <NoticeBox variant="warning">{disclaimer}</NoticeBox>
      </div>

      {/* ── Data notices (burst, partial data, etc.) ────────────────────────── */}
      {notices.length > 0 && (
        <div className="space-y-2 animate-fade-in-up">
          {notices.map((notice, i) => (
            <NoticeBox key={i} variant="info">{notice}</NoticeBox>
          ))}
        </div>
      )}

      {/* ── Meta row ───────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between animate-fade-in-up">
        <p className="text-xs text-slate-600">
          Analyzed {analyzedDate}
        </p>
        <div className="flex items-center gap-2">
          {!analysis.includesENS && (
            <span className="text-xs text-slate-700">ENS not included</span>
          )}
          <span className="text-xs text-slate-700">·</span>
          <span className="text-xs text-slate-700">
            {analysis.contracts.length} contract{analysis.contracts.length !== 1 ? "s" : ""} found
          </span>
        </div>
      </div>

      {/* ── Identity + Score ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-fade-in-up">
        <ENSCard
          ens={analysis.ens}
          address={analysis.address}
          included={analysis.includesENS}
        />
        <ScoreCard profile={profile} />
      </div>

      {/* ── How score is calculated ─────────────────────────────────────────── */}
      <ScoringExplainer />

      {/* ── Contracts ───────────────────────────────────────────────────────── */}
      <div className="animate-fade-in-up">
        <ContractList contracts={analysis.contracts} network={network} />
      </div>

      {/* ── Actions ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 animate-fade-in-up">
        <AttestButton profile={profile} address={analysis.address} />
        <EndorseButton profile={profile} address={analysis.address} />
        <MintButton
          profile={profile}
          address={analysis.address}
          analysis={analysis}
        />
      </div>
    </div>
  );
}

/** Collapsible "How your score is calculated" section */
function ScoringExplainer() {
  return (
    <div className="animate-fade-in-up">
      <details className="group bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
        <summary className="flex items-center justify-between px-6 py-4 cursor-pointer select-none hover:bg-slate-800/40 transition-colors list-none">
          <div className="flex items-center gap-2">
            <span className="text-slate-400 text-sm">📐</span>
            <span className="text-sm font-medium text-slate-300">
              How your score is calculated
            </span>
          </div>
          <span className="text-slate-600 text-xs group-open:rotate-180 transition-transform">
            ▼
          </span>
        </summary>

        <div className="px-6 pb-5 pt-1 border-t border-slate-800">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
            <SignalRow icon="📦" label="+5 per contract deployed" sub="Capped at 10 deployments" />
            <SignalRow icon="✅" label="+10 per verified contract" sub="Capped at 10 verified" />
            <SignalRow icon="🔷" label="+2 for ENS name" sub="If ENS lookup is enabled" />
            <SignalRow icon="🔗" label="+3 per ENS metadata field" sub="Avatar, URL, GitHub" />
            <SignalRow icon="⏳" label="1.2× for activity >30 days" sub="Established track record" />
            <SignalRow icon="⚡" label="0.8× for recent activity" sub="Burst protection (<30 days)" />
          </div>
          <p className="text-xs text-slate-600 mt-4 pt-3 border-t border-slate-800">
            All rules are fixed, public, and applied consistently. This profile reflects
            on-chain activity only — it does not measure developer skill or code quality.
          </p>
        </div>
      </details>
    </div>
  );
}

function SignalRow({ icon, label, sub }: { icon: string; label: string; sub: string }) {
  return (
    <div className="flex items-start gap-2.5 p-3 bg-slate-800/40 rounded-xl">
      <span className="text-base flex-shrink-0">{icon}</span>
      <div>
        <p className="text-sm text-slate-200 font-medium">{label}</p>
        <p className="text-xs text-slate-600 mt-0.5">{sub}</p>
      </div>
    </div>
  );
}
