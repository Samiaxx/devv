"use client";

import { ReputationProfile } from "@/lib/types";
import { getScoreTier, SCORING_RULES } from "@/lib/core/scoring";
import { CAPS } from "@/lib/core/constants";
import { Card, CardBody, SectionLabel } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { NoticeBox } from "@/components/ui/NoticeBox";

interface ScoreCardProps {
  profile: ReputationProfile;
}

// Max possible points per category (for progress bar scaling)
const MAX_DEPLOY_PTS  = CAPS.MAX_DEPLOYMENTS_SCORED * SCORING_RULES.CONTRACT_DEPLOYMENT * 1.2;
const MAX_VERIFY_PTS  = CAPS.MAX_VERIFIED_SCORED    * SCORING_RULES.VERIFIED_CONTRACT   * 1.2;
const MAX_ENS_PTS     = SCORING_RULES.ENS_OWNERSHIP + SCORING_RULES.ENS_METADATA * 3;

export function ScoreCard({ profile }: ScoreCardProps) {
  const tier = getScoreTier(profile.score);
  const { breakdown, explanations, cappedAt } = profile;

  return (
    <Card className="flex flex-col">
      {/* ── Score hero ─────────────────────────────────────────────────────── */}
      <CardBody className="flex items-center justify-between gap-4 pb-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">
            Activity Score
          </p>
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="text-5xl font-bold text-white tabular-nums leading-none">
              {profile.score}
            </span>
            <span className={`text-base font-semibold ${tier.color}`}>
              {tier.label}
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1.5">{tier.description}</p>
        </div>
        <ScoreRing score={profile.score} color={tier.color} />
      </CardBody>

      {/* ── Horizontal breakdown bars ──────────────────────────────────────── */}
      <div className="px-6 pb-5 space-y-4 border-t border-slate-800 pt-5">
        <SectionLabel>Score Breakdown</SectionLabel>

        <BarRow
          label="Contract Deployments"
          points={breakdown.contractDeployments}
          max={MAX_DEPLOY_PTS}
          detail={explanations[0]}
          color="indigo"
        />
        <BarRow
          label="Verified Contracts"
          points={breakdown.verifiedContracts}
          max={MAX_VERIFY_PTS}
          detail={explanations[1]}
          color="green"
        />
        <BarRow
          label="ENS Identity"
          points={breakdown.ensOwnership + breakdown.ensMetadata}
          max={MAX_ENS_PTS}
          detail={explanations[2]}
          color="indigo"
        />

        {/* Time adjustment — show only if non-zero */}
        {breakdown.timeMultiplierBonus !== 0 && (
          <div className="flex items-center justify-between pt-1 border-t border-slate-800/60">
            <div className="flex items-center gap-2">
              <span className="text-slate-500 text-sm">⏳</span>
              <span className="text-sm text-slate-400">Time weight adjustment</span>
            </div>
            <span className={`text-sm font-semibold tabular-nums ${
              breakdown.timeMultiplierBonus > 0 ? "text-green-400" : "text-red-400"
            }`}>
              {breakdown.timeMultiplierBonus > 0 ? "+" : ""}{breakdown.timeMultiplierBonus}
            </span>
          </div>
        )}
      </div>

      {/* ── Cap notice ─────────────────────────────────────────────────────── */}
      {cappedAt !== null && (
        <div className="px-6 pb-5">
          <NoticeBox variant="warning">
            Deployment count capped at {cappedAt} for scoring — prevents spam boosting.
          </NoticeBox>
        </div>
      )}

      {/* ── Scoring rules disclosure ───────────────────────────────────────── */}
      <div className="px-6 pb-6">
        <details className="group">
          <summary className="text-xs text-slate-600 hover:text-slate-400 cursor-pointer transition-colors select-none flex items-center gap-1">
            <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
            How is this calculated?
          </summary>
          <div className="mt-3 p-4 bg-slate-800/50 rounded-xl text-xs text-slate-400 space-y-1.5 border border-slate-700/50">
            <p>+{SCORING_RULES.CONTRACT_DEPLOYMENT} pts per deployment <span className="text-slate-600">(max {CAPS.MAX_DEPLOYMENTS_SCORED})</span></p>
            <p>+{SCORING_RULES.VERIFIED_CONTRACT} pts per verified contract <span className="text-slate-600">(max {CAPS.MAX_VERIFIED_SCORED})</span></p>
            <p>+{SCORING_RULES.ENS_OWNERSHIP} pts for ENS name ownership</p>
            <p>+{SCORING_RULES.ENS_METADATA} pts per ENS metadata field <span className="text-slate-600">(avatar, url, github)</span></p>
            <div className="pt-2 mt-2 border-t border-slate-700 space-y-1">
              <p>Time multiplier: <span className="text-green-400">1.2×</span> if &gt;30 days old · <span className="text-yellow-400">0.8×</span> if &lt;30 days</p>
              <p>Burst penalty: <span className="text-yellow-400">0.8×</span> additional if 3+ deploys within 7 days</p>
            </div>
            <p className="pt-2 mt-2 border-t border-slate-700 text-slate-600">
              All rules are fixed and disclosed. Caps prevent spam boosting.
            </p>
          </div>
        </details>
      </div>
    </Card>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function BarRow({
  label,
  points,
  max,
  detail,
  color,
}: {
  label: string;
  points: number;
  max: number;
  detail?: string;
  color: "indigo" | "green";
}) {
  const pct = max > 0 ? Math.round((points / max) * 100) : 0;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-300">{label}</span>
        <span className={`text-sm font-semibold tabular-nums ${points > 0 ? "text-white" : "text-slate-600"}`}>
          +{points}
        </span>
      </div>
      <ProgressBar value={pct} color={color} />
      {detail && (
        <p className="text-xs text-slate-600 leading-relaxed">{detail}</p>
      )}
    </div>
  );
}

function ScoreRing({ score, color }: { score: number; color: string }) {
  const capped = Math.min(score, 100);
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const progress = (capped / 100) * circumference;

  // Map tier color class to a stroke color
  const strokeColor =
    color.includes("purple") ? "#a855f7" :
    color.includes("orange") ? "#f97316" :
    color.includes("yellow") ? "#eab308" :
    color.includes("green")  ? "#22c55e" :
    color.includes("blue")   ? "#3b82f6" :
    "#6366f1";

  return (
    <div className="relative w-20 h-20 flex items-center justify-center flex-shrink-0">
      <svg className="w-20 h-20 -rotate-90" viewBox="0 0 88 88">
        <circle cx="44" cy="44" r={radius} fill="none" stroke="#1e293b" strokeWidth="7" />
        <circle
          cx="44" cy="44" r={radius}
          fill="none"
          stroke={strokeColor}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - progress}
          className="transition-all duration-1000"
        />
      </svg>
      <span className="absolute text-sm font-bold text-white tabular-nums">
        {score > 100 ? "100+" : score}
      </span>
    </div>
  );
}
