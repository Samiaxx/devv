"use client";

/**
 * AttestButton — a user-facing flow for submitting an EAS delegated attestation.
 *
 * Implements all 6 required transaction states:
 *   1. Not connected          → prompt to connect wallet
 *   2. Awaiting confirmation  → wallet popup open, user reviewing
 *   3. Transaction submitted  → tx sent to mempool, awaiting block
 *   4. Transaction confirmed  → tx mined, attestation UID received
 *   5. User rejection         → user denied in wallet
 *   6. Contract/RPC failure   → server signing error, network error, or other
 *
 * Flow:
 *   1. Browser asks server to sign a delegated attestation (POST /api/attest)
 *   2. Server signs with ATTESTER_PRIVATE_KEY (no ETH needed server-side)
 *   3. Browser submits the signed payload to EAS contract on Sepolia (user pays gas)
 *   4. Attestation is permanently on-chain, verifiable by anyone
 *
 * Demo mode: when NEXT_PUBLIC_DEMO_MODE=true or ATTESTER_PRIVATE_KEY is not set,
 * the button simulates all 6 states without hitting the blockchain.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { useAccount, useWalletClient, useChainId, useSwitchChain, useConnect } from "wagmi";
import { sepolia } from "wagmi/chains";
import { BrowserProvider } from "ethers";
import { EAS } from "@ethereum-attestation-service/eas-sdk";
import { ReputationProfile, AttestationState } from "@/lib/types";
import { EAS_CONFIG, easScanUrl } from "@/lib/eas/config";
import { Spinner } from "@/components/ui/Spinner";

// ─── Demo mode detection ──────────────────────────────────────────────────────

const IS_DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

// Demo scenario selector
type DemoScenario = "success" | "reject" | "error" | "cycle";

function getDemoScenario(): DemoScenario {
  const env = process.env.NEXT_PUBLIC_DEMO_SCENARIO;
  if (env === "reject" || env === "error" || env === "cycle") return env;
  return "success";
}

// Simulated demo data
const DEMO_TX_HASH = "0x" + "b".repeat(64);
const DEMO_UID = "0x" + "c".repeat(64);

// ─── Error classification ─────────────────────────────────────────────────────

function classifyError(err: unknown): {
  message: string;
  category: "user_rejected" | "rpc_failure" | "server_error" | "network_error";
} {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();

  // EIP-1193 user rejection
  if (
    lower.includes("user rejected") ||
    lower.includes("user denied") ||
    lower.includes("user cancelled") ||
    lower.includes("code 4001") ||
    lower.includes("action_rejected")
  ) {
    return {
      message: "You rejected the transaction in your wallet.",
      category: "user_rejected",
    };
  }

  // Server-side signing errors
  if (
    lower.includes("server signing failed") ||
    lower.includes("attester_private_key") ||
    lower.includes("schema uid not configured") ||
    lower.includes("500")
  ) {
    return {
      message: "Server could not sign the attestation. Contact the project maintainer.",
      category: "server_error",
    };
  }

  // Insufficient funds
  if (lower.includes("insufficient funds") || lower.includes("insufficient balance")) {
    return {
      message: "Insufficient funds to cover gas fees.",
      category: "rpc_failure",
    };
  }

  // Network / RPC failure
  if (
    lower.includes("network") ||
    lower.includes("timeout") ||
    lower.includes("fetch failed") ||
    lower.includes("econnrefused") ||
    lower.includes("502") ||
    lower.includes("503") ||
    lower.includes("504")
  ) {
    return {
      message: "Network error. Please check your connection and try again.",
      category: "network_error",
    };
  }

  // Fallback
  return {
    message: raw.split("\n")[0].slice(0, 200),
    category: "server_error",
  };
}

// ─── Extended state (wraps AttestationState with UI-specific fields) ──────────

interface AttestUIState {
  status:
    | "notConnected"
    | "idle"
    | "awaitingConfirmation"
    | "submitted"
    | "confirmed"
    | "rejected"
    | "error";
  uid: string | null;
  txHash: string | null;
  error: string | null;
  errorCategory: "user_rejected" | "rpc_failure" | "server_error" | "network_error" | null;
}

const INITIAL_STATE: AttestUIState = {
  status: "idle",
  uid: null,
  txHash: null,
  error: null,
  errorCategory: null,
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface AttestButtonProps {
  profile: ReputationProfile;
  address: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AttestButton({ profile, address }: AttestButtonProps) {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { connect, connectors } = useConnect();
  const { data: walletClient } = useWalletClient();

  const [state, setState] = useState<AttestUIState>(INITIAL_STATE);
  const demoCycleRef = useRef(0);

  const isOnSepolia = chainId === sepolia.id;

  // ── Sync wallet connection ────────────────────────────────────────────────

  useEffect(() => {
    if (!isConnected) {
      setState({ ...INITIAL_STATE, status: "notConnected" });
    } else if (state.status === "notConnected") {
      setState((s) => ({ ...s, status: "idle" }));
    }
  }, [isConnected]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Demo mode handler ─────────────────────────────────────────────────────

  const runDemoScenario = useCallback((scenario: "success" | "reject" | "error") => {
    // Step 1: awaitingConfirmation (simulate server signing)
    setState({ ...INITIAL_STATE, status: "awaitingConfirmation" });

    if (scenario === "reject") {
      // After 1.5s, simulate user rejection
      setTimeout(() => {
        setState({
          ...INITIAL_STATE,
          status: "rejected",
          error: "You rejected the transaction in your wallet.",
          errorCategory: "user_rejected",
        });
      }, 1500);
      return;
    }

    // Step 2: submitted (after 1.5s — server signed, user confirmed in wallet)
    setTimeout(() => {
      setState({
        ...INITIAL_STATE,
        status: "submitted",
        txHash: DEMO_TX_HASH,
      });

      if (scenario === "error") {
        // After 2 more seconds, simulate EAS contract error
        setTimeout(() => {
          setState({
            ...INITIAL_STATE,
            status: "error",
            txHash: DEMO_TX_HASH,
            error: "Execution reverted: Schema not registered on this network.",
            errorCategory: "server_error",
          });
        }, 2000);
        return;
      }

      // Step 3: confirmed (after 2 more seconds)
      setTimeout(() => {
        setState({
          ...INITIAL_STATE,
          status: "confirmed",
          uid: DEMO_UID,
          txHash: DEMO_TX_HASH,
        });
      }, 2000);
    }, 1500);
  }, []);

  const handleDemoAttest = useCallback(() => {
    const scenario = getDemoScenario();
    if (scenario === "cycle") {
      const scenarios: Array<"success" | "reject" | "error"> = ["success", "reject", "error"];
      runDemoScenario(scenarios[demoCycleRef.current % 3]);
      demoCycleRef.current++;
    } else {
      runDemoScenario(scenario);
    }
  }, [runDemoScenario]);

  // ── Live attestation handler ──────────────────────────────────────────────

  const handleAttest = useCallback(async () => {
    if (IS_DEMO_MODE) {
      handleDemoAttest();
      return;
    }

    if (!walletClient) return;

    // Step 1: Ask server to sign
    setState({ ...INITIAL_STATE, status: "awaitingConfirmation" });

    try {
      const res = await fetch("/api/attest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, profile }),
      });

      const payload = await res.json();

      if (!res.ok) {
        throw new Error(payload.error ?? "Server signing failed");
      }

      // Step 2: Submit on-chain (user pays gas)
      setState((s) => ({ ...s, status: "submitted", txHash: null }));

      const provider = new BrowserProvider(walletClient.transport);
      const signer = await provider.getSigner();

      const eas = new EAS(payload.easContractAddress);
      eas.connect(signer);

      const tx = await eas.attestByDelegation({
        schema: payload.schemaUID,
        data: {
          recipient: payload.recipient,
          expirationTime: 0n,
          revocable: true,
          refUID: "0x0000000000000000000000000000000000000000000000000000000000000000",
          data: payload.encodedData,
          value: 0n,
        },
        signature: payload.signature,
        attester: payload.attester,
        deadline: 0n,
      });

      setState((s) => ({ ...s, txHash: tx.receipt?.hash ?? null }));

      // Step 3: Wait for confirmation
      const uid = await tx.wait();

      setState({
        ...INITIAL_STATE,
        status: "confirmed",
        uid: uid ?? null,
        txHash: tx.receipt?.hash ?? null,
      });
    } catch (err) {
      const classified = classifyError(err);
      setState({
        ...INITIAL_STATE,
        status: classified.category === "user_rejected" ? "rejected" : "error",
        error: classified.message,
        errorCategory: classified.category,
      });
    }
  }, [walletClient, address, profile, handleDemoAttest]);

  // ── Retry handler ─────────────────────────────────────────────────────────

  const handleRetry = useCallback(() => {
    // In demo cycle mode, auto-trigger next scenario
    if (IS_DEMO_MODE && getDemoScenario() === "cycle") {
      const scenarios: Array<"success" | "reject" | "error"> = ["success", "reject", "error"];
      const next = scenarios[demoCycleRef.current % 3];
      demoCycleRef.current++;
      setTimeout(() => runDemoScenario(next), 300);
      return;
    }

    setState(INITIAL_STATE);
  }, [runDemoScenario]);

  const handleConnect = useCallback(() => {
    const injected = connectors.find((c) => c.id === "injected");
    if (injected) {
      connect({ connector: injected });
    }
  }, [connect, connectors]);

  // ── Render: Not Connected ──────────────────────────────────────────────────

  if (state.status === "notConnected" || !isConnected) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-4 animate-fade-in-up">
        {IS_DEMO_MODE && (
          <DemoBanner text="Connect any wallet to preview all states" />
        )}
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center flex-shrink-0">
            <WalletIcon />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Connect Your Wallet</p>
            <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
              Connect your wallet to create an on-chain attestation of your reputation profile.
            </p>
          </div>
        </div>

        <div className="bg-slate-800/40 rounded-xl p-3 text-xs text-slate-500 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />
            <span>Attestation is recorded on Sepolia via EAS</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />
            <span>You pay a small gas fee (testnet ETH)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />
            <span>You can revoke the attestation at any time</span>
          </div>
        </div>

        <button
          onClick={handleConnect}
          className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl transition-colors text-sm flex items-center justify-center gap-2"
        >
          <WalletIcon className="w-4 h-4" />
          Connect Wallet
        </button>
      </div>
    );
  }

  // ── Render: Confirmed ──────────────────────────────────────────────────────

  if (state.status === "confirmed") {
    return (
      <div className="rounded-2xl border border-green-500/20 bg-green-500/8 p-5 space-y-3 animate-fade-in-up">
        {IS_DEMO_MODE && <DemoBanner text="State 4/6: Confirmed" />}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-green-500/15 flex items-center justify-center text-xl flex-shrink-0">
            ✅
          </div>
          <div>
            <p className="text-sm font-semibold text-green-400">Attestation Confirmed</p>
            <p className="text-xs text-slate-400 mt-0.5">
              Your reputation profile is now a verifiable on-chain credential.
            </p>
          </div>
        </div>

        <div className="bg-slate-800/60 rounded-xl p-3 space-y-2 text-xs font-mono">
          {state.uid && (
            <div className="flex items-start gap-2">
              <span className="text-slate-600 flex-shrink-0">UID</span>
              <span className="text-slate-300 break-all">
                {state.uid.slice(0, 20)}...
                {IS_DEMO_MODE && <span className="ml-1 text-amber-400 text-[10px]">(simulated)</span>}
              </span>
            </div>
          )}
          {state.txHash && (
            <div className="flex items-start gap-2">
              <span className="text-slate-600 flex-shrink-0">Tx</span>
              <span className="text-indigo-400 break-all">
                {state.txHash.slice(0, 20)}...
                {!IS_DEMO_MODE && (
                  <a
                    href={`https://sepolia.etherscan.io/tx/${state.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-1 hover:underline"
                  >
                    ↗
                  </a>
                )}
                {IS_DEMO_MODE && <span className="ml-1 text-amber-400 text-[10px]">(simulated)</span>}
              </span>
            </div>
          )}
          <div className="flex items-start gap-2">
            <span className="text-slate-600 flex-shrink-0">For</span>
            <span className="text-slate-300 break-all">{address}</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-slate-600 flex-shrink-0">Score</span>
            <span className="text-slate-300">{profile.score}/100</span>
          </div>
        </div>

        {!IS_DEMO_MODE && state.uid && (
          <a
            href={easScanUrl(state.uid)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium transition-colors border border-slate-700"
          >
            <EASIcon />
            View on EAS Explorer ↗
          </a>
        )}

        {IS_DEMO_MODE && (
          <button
            onClick={handleRetry}
            className="w-full py-2.5 px-4 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-xl transition-colors text-sm"
          >
            🎭 Try Next Scenario →
          </button>
        )}

        <p className="text-xs text-slate-600 text-center">
          {IS_DEMO_MODE ? "Demo" : "Attested by Proof of Dev"} · Sepolia testnet · Revocable
        </p>
      </div>
    );
  }

  // ── Render: Rejected ───────────────────────────────────────────────────────

  if (state.status === "rejected") {
    return (
      <div className="rounded-2xl border border-yellow-500/20 bg-yellow-500/8 p-5 space-y-4 animate-fade-in-up">
        {IS_DEMO_MODE && <DemoBanner text="State 5/6: User Rejection" />}
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-yellow-500/15 flex items-center justify-center text-xl flex-shrink-0">
            🚫
          </div>
          <div>
            <p className="text-sm font-semibold text-yellow-400">Transaction Rejected</p>
            <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
              {state.error}
            </p>
          </div>
        </div>

        <p className="text-xs text-slate-500">
          No funds were charged. You can try again whenever you&apos;re ready.
        </p>

        <button
          onClick={handleRetry}
          className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl transition-colors text-sm"
        >
          {IS_DEMO_MODE ? "🎭 Try Next Scenario →" : "Try Again"}
        </button>
      </div>
    );
  }

  // ── Render: Error ──────────────────────────────────────────────────────────

  if (state.status === "error") {
    return (
      <div className="rounded-2xl border border-red-500/20 bg-red-500/8 p-5 space-y-4 animate-fade-in-up">
        {IS_DEMO_MODE && <DemoBanner text="State 6/6: Error" />}
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-500/15 flex items-center justify-center text-xl flex-shrink-0">
            ⚠️
          </div>
          <div>
            <p className="text-sm font-semibold text-red-400">
              {state.errorCategory === "rpc_failure"
                ? "Network Error"
                : state.errorCategory === "server_error"
                  ? "Server Error"
                  : "Attestation Failed"}
            </p>
            <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
              {state.error}
            </p>
          </div>
        </div>

        {state.errorCategory === "rpc_failure" && (
          <p className="text-xs text-slate-500">
            Check that you are connected to the Sepolia network and have sufficient testnet ETH.
          </p>
        )}

        {state.errorCategory === "server_error" && (
          <p className="text-xs text-slate-500">
            The server could not sign the attestation. The EAS schema may not be registered or the attester key may be missing.
          </p>
        )}

        {state.errorCategory === "network_error" && (
          <p className="text-xs text-slate-500">
            Check your internet connection and try again.
          </p>
        )}

        <div className="flex gap-3">
          {!IS_DEMO_MODE && !isOnSepolia && (
            <button
              onClick={() => switchChain({ chainId: sepolia.id })}
              className="flex-1 py-2.5 px-4 bg-yellow-600 hover:bg-yellow-500 text-white font-semibold rounded-xl transition-colors text-sm"
            >
              Switch to Sepolia
            </button>
          )}
          <button
            onClick={handleRetry}
            className="flex-1 py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-xl transition-colors text-sm"
          >
            {IS_DEMO_MODE ? "🎭 Try Next Scenario →" : "Retry"}
          </button>
        </div>

        {state.txHash && !IS_DEMO_MODE && (
          <a
            href={`https://sepolia.etherscan.io/tx/${state.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-center text-xs text-indigo-400 hover:underline"
          >
            View failed transaction ↗
          </a>
        )}
      </div>
    );
  }

  // ── Render: Awaiting Confirmation / Submitted (in-progress states) ─────────

  const isBusy = state.status === "awaitingConfirmation" || state.status === "submitted";

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-4 animate-fade-in-up">
      {/* Demo mode banner */}
      {IS_DEMO_MODE && (
        <DemoBanner
          text={
            state.status === "idle"
              ? "— Click Get Attestation to simulate"
              : state.status === "awaitingConfirmation"
                ? "State 2/6: Awaiting Confirmation"
                : "State 3/6: Submitted"
          }
        />
      )}

      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center flex-shrink-0">
          <EASIcon className="text-indigo-400" />
        </div>
        <div>
          <p className="text-sm font-semibold text-white">EAS Attestation</p>
          <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
            Publish your reputation profile as a verifiable on-chain credential via the
            Ethereum Attestation Service. The server signs; you submit.
          </p>
        </div>
      </div>

      {/* Profile summary */}
      <div className="bg-slate-800/50 rounded-xl p-3 grid grid-cols-2 gap-2 text-xs">
        <DataRow label="Score" value={`${profile.score}/100`} />
        <DataRow label="Tier" value={profile.summary.tier} />
        <DataRow label="Contracts" value={String(profile.summary.contractCount)} />
        <DataRow label="Verified" value={String(profile.summary.verifiedContractCount)} />
        <DataRow label="ENS" value={profile.summary.hasENS ? "Yes" : "No"} />
        <DataRow label="Network" value={IS_DEMO_MODE ? "Sepolia (demo)" : "Sepolia"} />
      </div>

      {/* How it works */}
      {state.status === "idle" && (
        <details className="group">
          <summary className="text-xs text-slate-600 hover:text-slate-400 cursor-pointer select-none flex items-center gap-1 transition-colors">
            <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
            How does this work?
          </summary>
          <div className="mt-2 text-xs text-slate-500 space-y-1.5 pl-3 leading-relaxed border-l border-slate-800">
            <p>1. You click the button — your browser asks our server to sign the attestation data.</p>
            <p>2. The server signs with its attester key (no ETH needed on our side).</p>
            <p>3. Your wallet submits the signed payload to the EAS contract on Sepolia. You pay gas.</p>
            <p>4. The attestation is permanently on-chain, verifiable by anyone, and linked to your wallet.</p>
            <p className="text-slate-600 pt-1">You can revoke it at any time from the EAS Explorer.</p>
          </div>
        </details>
      )}

      {/* In-progress feedback */}
      {state.status === "awaitingConfirmation" && (
        <div className="bg-indigo-500/8 border border-indigo-500/20 rounded-xl p-3 flex items-center gap-3">
          <Spinner />
          <div>
            <p className="text-xs font-medium text-indigo-300">Server is signing attestation</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {IS_DEMO_MODE
                ? "Simulating server signature... (auto-advancing in 1.5s)"
                : "Please confirm the transaction in your wallet."}
            </p>
          </div>
        </div>
      )}

      {state.status === "submitted" && (
        <div className="bg-blue-500/8 border border-blue-500/20 rounded-xl p-3 space-y-2">
          <div className="flex items-center gap-3">
            <Spinner />
            <div>
              <p className="text-xs font-medium text-blue-300">Transaction submitted</p>
              <p className="text-xs text-slate-500 mt-0.5">
                {IS_DEMO_MODE
                  ? "Simulating on-chain confirmation... (auto-advancing in 2s)"
                  : "Waiting for blockchain confirmation..."}
              </p>
            </div>
          </div>
          {state.txHash && (
            <span className="block text-xs text-indigo-400 font-mono">
              {state.txHash.slice(0, 24)}...
              {IS_DEMO_MODE && <span className="ml-1 text-amber-400 text-[10px]">(simulated)</span>}
              {!IS_DEMO_MODE && (
                <a
                  href={`https://sepolia.etherscan.io/tx/${state.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-1 hover:underline"
                >
                  ↗
                </a>
              )}
            </span>
          )}
        </div>
      )}

      {/* Network switch or attest button */}
      {!IS_DEMO_MODE && !isOnSepolia ? (
        <button
          onClick={() => switchChain({ chainId: sepolia.id })}
          className="w-full py-2.5 px-4 bg-yellow-600 hover:bg-yellow-500 text-white font-semibold rounded-xl transition-colors text-sm"
        >
          Switch to Sepolia
        </button>
      ) : (
        <button
          onClick={handleAttest}
          disabled={isBusy}
          className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors text-sm flex items-center justify-center gap-2"
        >
          {isBusy ? (
            <>
              <Spinner />
              {state.status === "awaitingConfirmation" ? "Signing…" : "Confirming…"}
            </>
          ) : (
            <>
              <EASIcon className="w-4 h-4" />
              {IS_DEMO_MODE ? "Get Attestation (Demo)" : "Get Attestation"}
            </>
          )}
        </button>
      )}

      <p className="text-xs text-slate-700 text-center">
        {IS_DEMO_MODE ? "Demo" : "Sepolia testnet"} · Revocable · No personal data stored
      </p>
    </div>
  );
}

// ─── Helper components ────────────────────────────────────────────────────────

function DemoBanner({ text }: { text: string }) {
  return (
    <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-1.5 text-xs text-amber-400 text-center font-medium">
      🎭 Demo Mode {text}
    </div>
  );
}

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-slate-600">{label}</span>
      <span className="text-slate-300 font-medium">{value}</span>
    </div>
  );
}

function WalletIcon({ className }: { className?: string }) {
  return (
    <svg
      className={`w-4 h-4 flex-shrink-0 ${className ?? ""}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="6" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
      <path d="M16 14h2" />
    </svg>
  );
}

function EASIcon({ className }: { className?: string }) {
  return (
    <svg
      className={`w-4 h-4 flex-shrink-0 ${className ?? ""}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
