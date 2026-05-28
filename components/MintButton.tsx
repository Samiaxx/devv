"use client";

import { useState } from "react";
import {
  useAccount,
  useWriteContract,
  useWaitForTransactionReceipt,
  useChainId,
  useSwitchChain,
} from "wagmi";
import { sepolia } from "wagmi/chains";
import { CONTRACT_ADDRESS, CONTRACT_ABI } from "@/lib/contract";
import { ReputationProfile, AnalysisResponse } from "@/lib/types";
import { generateTextReport } from "@/lib/core/formatting";
import { Spinner } from "@/components/ui/Spinner";
import { NoticeBox } from "@/components/ui/NoticeBox";
import { Badge } from "@/components/ui/Badge";

interface MintButtonProps {
  profile: ReputationProfile;
  address: string;
  analysis: AnalysisResponse;
}

type MintStep = "options" | "confirm" | "done";

export function MintButton({ profile, address, analysis }: MintButtonProps) {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();

  const [step, setStep] = useState<MintStep>("options");
  const [understood, setUnderstood] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);

  const isOnSepolia = chainId === sepolia.id;
  const isContractDeployed =
    CONTRACT_ADDRESS !== "0x0000000000000000000000000000000000000000";

  const { writeContract, data: txHash, isPending: isWritePending, error: writeError } =
    useWriteContract();

  const { isLoading: isConfirming, isSuccess: isMinted } =
    useWaitForTransactionReceipt({ hash: txHash });

  if (isMinted && step !== "done") setStep("done");

  function handleConfirmMint() {
    setMintError(null);
    if (!isContractDeployed) {
      setMintError("Contract not deployed yet. See README for deployment instructions.");
      return;
    }
    writeContract({
      address: CONTRACT_ADDRESS as `0x${string}`,
      abi: CONTRACT_ABI,
      functionName: "mint",
      args: [
        BigInt(profile.score),
        BigInt(profile.summary.contractCount),
        BigInt(profile.summary.verifiedContractCount),
        profile.summary.hasENS,
      ],
    });
  }

  function handleDownloadReport() {
    const report = generateTextReport(analysis, analysis.includesENS);
    const blob = new Blob([report], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `proof-of-dev-${address.slice(0, 8)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!isConnected) return null;

  // ── Done ────────────────────────────────────────────────────────────────────
  if (step === "done") {
    return (
      <div className="bg-green-500/8 border border-green-500/20 rounded-2xl p-6 text-center animate-fade-in-up">
        <div className="w-12 h-12 rounded-2xl bg-green-500/15 flex items-center justify-center text-2xl mx-auto mb-3">
          🎉
        </div>
        <p className="text-base font-semibold text-green-400">Proof-of-Dev Minted!</p>
        <p className="text-sm text-slate-400 mt-1">
          Your soulbound activity profile NFT has been minted on Sepolia.
        </p>
        {txHash && (
          <a
            href={`https://sepolia.etherscan.io/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-3 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            View transaction ↗
          </a>
        )}
        <p className="text-xs text-slate-600 mt-4">
          This NFT reflects on-chain activity only and does not certify developer skill.
        </p>
      </div>
    );
  }

  // ── Confirm modal ───────────────────────────────────────────────────────────
  if (step === "confirm") {
    return (
      <>
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
          onClick={() => { setStep("options"); setUnderstood(false); }}
        />

        {/* Modal */}
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl animate-fade-in-up">
            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-800">
              <div>
                <h2 className="text-base font-semibold text-white">Confirm Mint</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Review what will be stored on-chain
                </p>
              </div>
              <button
                onClick={() => { setStep("options"); setUnderstood(false); }}
                className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {/* What gets minted */}
              <div className="bg-slate-800/60 rounded-xl p-4 space-y-2.5">
                <MetaRow label="Score" value={String(profile.score)} />
                <MetaRow label="Contracts deployed" value={String(profile.summary.contractCount)} />
                <MetaRow label="Verified contracts" value={String(profile.summary.verifiedContractCount)} />
                <MetaRow label="ENS included" value={profile.summary.hasENS ? "Yes" : "No"} />
                <MetaRow label="Network" value="Sepolia testnet" />
                <MetaRow
                  label="Transferable"
                  value="No"
                  valueNode={<Badge label="Soulbound" variant="indigo" />}
                />
              </div>

              {/* Disclaimer */}
              <NoticeBox variant="warning">
                This NFT reflects on-chain activity only and does not guarantee developer
                skill or code quality. It is permanently tied to your wallet and cannot
                be transferred.
              </NoticeBox>

              {/* Confirmation checkbox */}
              <label className="flex items-start gap-3 cursor-pointer group">
                <div className="relative mt-0.5 flex-shrink-0">
                  <input
                    type="checkbox"
                    checked={understood}
                    onChange={(e) => setUnderstood(e.target.checked)}
                    className="sr-only"
                  />
                  <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                    understood
                      ? "bg-indigo-600 border-indigo-600"
                      : "border-slate-600 group-hover:border-slate-500"
                  }`}>
                    {understood && (
                      <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 10 8">
                        <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                </div>
                <span className="text-sm text-slate-300 leading-relaxed">
                  I understand this is an activity-based profile, not a certification of skill.
                </span>
              </label>

              {/* Error */}
              {(mintError || writeError) && (
                <NoticeBox variant="error">
                  {mintError || writeError?.message?.split("\n")[0] || "Mint failed"}
                </NoticeBox>
              )}
            </div>

            {/* Actions */}
            <div className="px-6 pb-6 flex gap-3">
              <button
                onClick={() => { setStep("options"); setUnderstood(false); }}
                className="flex-1 py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-xl transition-colors text-sm"
              >
                Cancel
              </button>

              {!isOnSepolia ? (
                <button
                  onClick={() => switchChain({ chainId: sepolia.id })}
                  className="flex-1 py-2.5 px-4 bg-yellow-600 hover:bg-yellow-500 text-white font-semibold rounded-xl transition-colors text-sm"
                >
                  Switch to Sepolia
                </button>
              ) : (
                <button
                  onClick={handleConfirmMint}
                  disabled={!understood || isWritePending || isConfirming}
                  className="flex-1 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors text-sm flex items-center justify-center gap-2"
                >
                  {isWritePending || isConfirming ? (
                    <><Spinner />{isConfirming ? "Confirming..." : "Confirm in wallet..."}</>
                  ) : (
                    "Confirm & Mint"
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </>
    );
  }

  // ── Options (default) ───────────────────────────────────────────────────────
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
      <div className="flex items-start gap-4 mb-5">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-700 flex items-center justify-center flex-shrink-0 shadow-lg shadow-indigo-900/30">
          <span className="text-xl">🏅</span>
        </div>
        <div>
          <h3 className="text-base font-semibold text-white">Save your profile</h3>
          <p className="text-sm text-slate-500 mt-0.5">
            Download as a report or mint as a soulbound NFT on Sepolia. Both are optional.
          </p>
        </div>
      </div>

      {/* Summary chips */}
      <div className="flex flex-wrap gap-2 mb-5">
        <Badge label={`Score: ${profile.score}`} variant="indigo" />
        <Badge
          label={`${profile.summary.contractCount} contract${profile.summary.contractCount !== 1 ? "s" : ""}`}
          variant="gray"
        />
        {profile.summary.hasENS && <Badge label="ENS ✓" variant="green" />}
        {profile.cappedAt !== null && (
          <Badge label={`Capped at ${profile.cappedAt}`} variant="yellow" />
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={handleDownloadReport}
          className="flex-1 py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium rounded-xl transition-colors text-sm flex items-center justify-center gap-2 border border-slate-700 hover:border-slate-600"
        >
          <DownloadIcon />
          Download Report
        </button>
        <button
          onClick={() => setStep("confirm")}
          className="flex-1 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl transition-colors text-sm flex items-center justify-center gap-2 shadow-lg shadow-indigo-900/30"
        >
          <span>🏅</span>
          Mint as NFT
        </button>
      </div>

      <p className="text-xs text-slate-700 text-center mt-3">
        Sepolia testnet only · Soulbound (non-transferable)
      </p>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function MetaRow({
  label,
  value,
  valueNode,
}: {
  label: string;
  value?: string;
  valueNode?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-slate-500">{label}</span>
      {valueNode ?? <span className="text-sm text-slate-200 font-medium">{value}</span>}
    </div>
  );
}

function DownloadIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 2v8m0 0l-3-3m3 3l3-3M3 13h10" />
    </svg>
  );
}
