"use client";

import { useState } from "react";
import { WorkerStatus } from "@/components/WorkerStatus";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import { AnalysisDashboard } from "@/components/AnalysisDashboard";
import { SkeletonDashboard } from "@/components/SkeletonDashboard";
import { AppLoadingScreen } from "@/components/AppLoadingScreen";
import { HardwareWalletNotice } from "@/components/HardwareWalletNotice";
import { NoticeBox } from "@/components/ui/NoticeBox";
import { Spinner } from "@/components/ui/Spinner";
import { useAppReady } from "@/hooks/useAppReady";
import { AnalysisResponse, AnalysisState } from "@/lib/types";

export default function Home() {
  const { address, isConnected } = useAccount();
  const { ready } = useAppReady(1500);
  const [network, setNetwork] = useState<"mainnet" | "sepolia">("mainnet");
  const [includeENS, setIncludeENS] = useState(false);
  const [state, setState] = useState<AnalysisState>({
    status: "idle",
    data: null,
    error: null,
  });

  // Show splash while hydrating — prevents flash of wrong state
  if (!ready) return <AppLoadingScreen />;

  async function analyzeWallet() {
    if (!address) return;
    setState({ status: "loading", data: null, error: null });

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, network, includeENS }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Analysis failed");
      }

      const status = res.status === 206 ? "partial" : "success";
      setState({ status, data: data as AnalysisResponse, error: null });
    } catch (err) {
      setState({
        status: "error",
        data: null,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  const isLoading = state.status === "loading";
  const hasResults = state.status === "success" || state.status === "partial";

  return (
    <div className="min-h-screen bg-[#030712] flex flex-col">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-[#030712]/90 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg">🏅</span>
              <span className="font-semibold text-white text-sm sm:text-base">
                Proof of Dev
              </span>
            </div>
            <p className="text-xs text-slate-600 hidden sm:block">
              On-chain developer activity profile
            </p>
          </div>
          <div className="flex items-center gap-4">
            <WorkerStatus />
            <ConnectButton />
          </div>
        </div>
      </header>

      {/* ── Main ───────────────────────────────────────────────────────────── */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 py-10">

        {/* ── Hero (shown until first analysis) ──────────────────────────── */}
        {!hasResults && (
          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-medium mb-5">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
              Transparent · Privacy-first · No data stored
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold text-white mb-3 tracking-tight">
              On-Chain Activity Profile
            </h1>
            <p className="text-slate-400 text-base sm:text-lg max-w-lg mx-auto leading-relaxed">
              Analyze your smart contract deployments and generate a transparent,
              explainable activity profile.
            </p>
            <p className="text-slate-600 text-sm mt-2">
              Not a skill test — just your verifiable on-chain history.
            </p>
          </div>
        )}

        {/* ── Connect / Analyze panel ─────────────────────────────────────── */}
        {!isConnected ? (
          <ConnectPrompt />
        ) : (
          <div className="space-y-6">
            {/* Controls card */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5">
              <div className="flex flex-col sm:flex-row gap-5">
                {/* Network */}
                <div className="flex-1">
                  <FieldLabel>Network</FieldLabel>
                  <div className="flex gap-2">
                    {(["mainnet", "sepolia"] as const).map((net) => (
                      <button
                        key={net}
                        onClick={() => setNetwork(net)}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                          network === net
                            ? "bg-indigo-600 text-white shadow-lg shadow-indigo-900/30"
                            : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
                        }`}
                      >
                        {net === "mainnet" ? "Ethereum" : "Sepolia"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Wallet */}
                <div className="flex-1 min-w-0">
                  <FieldLabel>Wallet</FieldLabel>
                  <p className="text-sm font-mono text-slate-300 bg-slate-800 px-3 py-2 rounded-lg truncate border border-slate-700">
                    {address}
                  </p>
                </div>
              </div>

              {/* ENS opt-in */}
              <div className="rounded-xl border border-slate-800 bg-slate-800/30 p-4">
                <label className="flex items-start gap-3 cursor-pointer group">
                  {/* Custom checkbox */}
                  <div className="relative mt-0.5 flex-shrink-0">
                    <input
                      type="checkbox"
                      checked={includeENS}
                      onChange={(e) => setIncludeENS(e.target.checked)}
                      className="sr-only"
                    />
                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                      includeENS
                        ? "bg-indigo-600 border-indigo-600"
                        : "border-slate-600 group-hover:border-slate-500"
                    }`}>
                      {includeENS && (
                        <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 10 8">
                          <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-200">
                      Include ENS data in analysis
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                      Resolves your ENS name and fetches public records (avatar, website,
                      GitHub). Optional — leave unchecked to skip.
                    </p>
                  </div>
                </label>
              </div>

              {/* Privacy note */}
              <p className="text-xs text-slate-600 flex items-center gap-1.5">
                <span>🔒</span>
                We analyze your public on-chain activity. No data is stored.
              </p>

              {/* Analyze button */}
              <button
                onClick={analyzeWallet}
                disabled={isLoading}
                className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all text-sm flex items-center justify-center gap-2 shadow-lg shadow-indigo-900/20 hover:shadow-indigo-900/40"
              >
                {isLoading ? (
                  <><Spinner />Analyzing...</>
                ) : (
                  <>
                    <span>🔍</span>
                    Analyze My Wallet
                  </>
                )}
              </button>
            </div>

            {/* Loading skeleton */}
            {isLoading && <SkeletonDashboard includesENS={includeENS} />}

            {/* Error state */}
            {state.status === "error" && (
              <div className="animate-fade-in-up">
                <NoticeBox variant="error">
                  <div className="space-y-2">
                    <p className="font-medium">Unable to fetch full data</p>
                    <p className="text-slate-400">{state.error}</p>
                    <button
                      onClick={analyzeWallet}
                      className="mt-1 px-3 py-1.5 bg-red-500/15 hover:bg-red-500/25 text-red-400 text-xs font-medium rounded-lg transition-colors border border-red-500/20"
                    >
                      Try Again
                    </button>
                  </div>
                </NoticeBox>
              </div>
            )}

            {/* Results */}
            {hasResults && state.data && (
              <AnalysisDashboard analysis={state.data} network={network} />
            )}
          </div>
        )}
      </main>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="border-t border-slate-800/60 py-6 mt-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-700">
          <p>Proof of Dev · Powered by Alchemy & Etherscan</p>
          <p>Activity-based only · Does not measure developer skill</p>
        </div>
      </footer>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ConnectPrompt() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center animate-fade-in-up">
      <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-3xl mb-5">
        🔗
      </div>
      <h2 className="text-lg font-semibold text-white mb-2">Connect your wallet</h2>
      <p className="text-slate-500 text-sm max-w-xs mb-6 leading-relaxed">
        Connect with MetaMask or WalletConnect to analyze your on-chain developer activity.
      </p>

      {/* Hardware wallet instructions */}
      <div className="w-full max-w-md mb-6">
        <HardwareWalletNotice />
      </div>

      <ConnectButton label="Connect Wallet" />

      <p className="text-xs text-slate-700 mt-4">
        Read-only analysis · No transactions required to analyze
      </p>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">
      {children}
    </label>
  );
}
