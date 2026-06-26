"use client";

/**
 * EndorseButton — a user-facing flow for submitting an on-chain endorsement.
 *
 * Implements all 6 required transaction states:
 *   1. Not connected      → prompt to connect wallet
 *   2. Awaiting confirmation → wallet popup open, user reviewing
 *   3. Transaction submitted → tx sent to mempool, awaiting block
 *   4. Transaction confirmed → tx mined, success UI
 *   5. User rejection       → user denied in wallet
 *   6. Contract/RPC failure  → revert, network error, or other failure
 *
 * Calls the `endorse(address, score)` function on the ProofOfDev contract,
 * which records that the connected wallet vouches for the endorsed address.
 *
 * Uses wagmi v2 hooks for state management.
 * Error classification distinguishes user rejection from technical failures.
 *
 * Demo mode: when NEXT_PUBLIC_DEMO_MODE=true or contract is not deployed,
 * the button simulates all 6 states without hitting the blockchain.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import {
  useAccount,
  useWriteContract,
  useWaitForTransactionReceipt,
  useChainId,
  useSwitchChain,
  useConnect,
  useReadContract,
} from "wagmi";
import { sepolia } from "wagmi/chains";
import { ReputationProfile, EndorsementState, EndorsementStatus } from "@/lib/types";
import { CONTRACT_ADDRESS, CONTRACT_ABI } from "@/lib/contract";
import { Spinner } from "@/components/ui/Spinner";

// ─── Demo mode detection ──────────────────────────────────────────────────────

const IS_DEMO_MODE =
  process.env.NEXT_PUBLIC_DEMO_MODE === "true" ||
  CONTRACT_ADDRESS === "0x0000000000000000000000000000000000000000";

// Demo scenario selector — set via NEXT_PUBLIC_DEMO_SCENARIO
// Options: "success", "reject", "error", "cycle" (cycles through all)
type DemoScenario = "success" | "reject" | "error" | "cycle";

function getDemoScenario(): DemoScenario {
  const env = process.env.NEXT_PUBLIC_DEMO_SCENARIO;
  if (env === "reject" || env === "error" || env === "cycle") return env;
  return "success";
}

// Simulated demo transaction hashes
const DEMO_TX_HASH = "0x" + "a".repeat(64);
const DEMO_BLOCK_NUMBER = 12345678;

// ─── Error classification ─────────────────────────────────────────────────────

/**
 * Classifies an error from a wagmi/ethers transaction into a user-facing category.
 *
 * User rejection (EIP-1193 code 4001 or common provider messages) is distinct
 * from RPC/contract failures so the UI can offer the right recovery action:
 *   - User rejection → "Try again" (no penalty, just re-prompt)
 *   - RPC failure    → "Check network / retry" (may need network switch)
 *   - Contract error → "Contract issue" (likely configuration problem)
 */
function classifyError(err: unknown): {
  message: string;
  category: EndorsementState["errorCategory"];
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

  // Insufficient funds
  if (lower.includes("insufficient funds") || lower.includes("insufficient balance")) {
    return {
      message: "Insufficient funds to cover gas fees.",
      category: "rpc_failure",
    };
  }

  // Contract revert
  if (
    lower.includes("execution reverted") ||
    lower.includes("revert") ||
    lower.includes("require(") ||
    lower.includes("already endorsed") ||
    lower.includes("cannot self-endorse")
  ) {
    return {
      message: "The contract rejected the transaction. This may be a configuration issue.",
      category: "contract_error",
    };
  }

  // Network / RPC failure
  if (
    lower.includes("network") ||
    lower.includes("timeout") ||
    lower.includes("fetch failed") ||
    lower.includes("econnrefused") ||
    lower.includes("server error") ||
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
    category: "contract_error",
  };
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface EndorseButtonProps {
  /** The reputation profile being endorsed */
  profile: ReputationProfile;
  /** The address being endorsed */
  address: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function EndorseButton({ profile, address }: EndorseButtonProps) {
  const { isConnected, address: connectedAddress } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { connect, connectors } = useConnect();

  const [endorseState, setEndorseState] = useState<EndorsementState>({
    status: "idle",
    txHash: null,
    blockNumber: null,
    error: null,
    errorCategory: null,
  });

  // Track which demo scenario to show next (for "cycle" mode)
  const demoCycleRef = useRef(0);

  const isOnSepolia = chainId === sepolia.id;
  const isContractConfigured =
    CONTRACT_ADDRESS !== "0x0000000000000000000000000000000000000000";

  // Check if current user has already endorsed this address
  const { data: alreadyEndorsed } = useReadContract({
    address: CONTRACT_ADDRESS as `0x${string}`,
    abi: CONTRACT_ABI,
    functionName: "hasEndorsed",
    args: connectedAddress && address ? [connectedAddress, address as `0x${string}`] : undefined,
    query: {
      enabled: !IS_DEMO_MODE && isContractConfigured && !!connectedAddress && !!address && isOnSepolia,
    },
  });

  // wagmi write hook
  const {
    writeContract,
    data: txHash,
    isPending: isWritePending,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  // wagmi wait-for-receipt hook
  const {
    data: receipt,
    isLoading: isConfirming,
    error: receiptError,
  } = useWaitForTransactionReceipt({
    hash: txHash,
    query: { enabled: !!txHash },
  });

  // ── State transitions based on wagmi hooks (live mode only) ────────────────

  // Sync wallet connection status
  useEffect(() => {
    if (!isConnected) {
      setEndorseState({
        status: "notConnected",
        txHash: null,
        blockNumber: null,
        error: null,
        errorCategory: null,
      });
    } else if (endorseState.status === "notConnected") {
      setEndorseState((s) => ({ ...s, status: "idle" }));
    }
  }, [isConnected]); // eslint-disable-line react-hooks/exhaustive-deps

  // awaitingConfirmation → writeContract is pending (wallet popup open)
  useEffect(() => {
    if (isWritePending && endorseState.status !== "awaitingConfirmation") {
      setEndorseState((s) => ({
        ...s,
        status: "awaitingConfirmation",
        error: null,
        errorCategory: null,
      }));
    }
  }, [isWritePending]); // eslint-disable-line react-hooks/exhaustive-deps

  // submitted → txHash received, waiting for block confirmation
  useEffect(() => {
    if (txHash && endorseState.status !== "submitted" && endorseState.status !== "confirmed") {
      setEndorseState((s) => ({
        ...s,
        status: "submitted",
        txHash,
      }));
    }
  }, [txHash]); // eslint-disable-line react-hooks/exhaustive-deps

  // confirmed → receipt received
  useEffect(() => {
    if (receipt && endorseState.status !== "confirmed") {
      setEndorseState({
        status: "confirmed",
        txHash: receipt.transactionHash,
        blockNumber: Number(receipt.blockNumber),
        error: null,
        errorCategory: null,
      });
    }
  }, [receipt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Error from writeContract hook
  useEffect(() => {
    if (writeError) {
      const classified = classifyError(writeError);
      setEndorseState({
        status: classified.category === "user_rejected" ? "rejected" : "error",
        txHash: null,
        blockNumber: null,
        error: classified.message,
        errorCategory: classified.category,
      });
      resetWrite();
    }
  }, [writeError, resetWrite]);

  // Error from receipt hook
  useEffect(() => {
    if (receiptError) {
      const classified = classifyError(receiptError);
      setEndorseState({
        status: "error",
        txHash: endorseState.txHash,
        blockNumber: null,
        error: classified.message,
        errorCategory: classified.category,
      });
    }
  }, [receiptError]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Demo mode handlers ────────────────────────────────────────────────────

  const runDemoScenario = useCallback(
    (scenario: "success" | "reject" | "error") => {
      // Step 1: awaitingConfirmation (after 500ms delay to simulate wallet popup)
      setEndorseState({
        status: "awaitingConfirmation",
        txHash: null,
        blockNumber: null,
        error: null,
        errorCategory: null,
      });

      if (scenario === "reject") {
        // After 1.5s, simulate user rejection
        setTimeout(() => {
          setEndorseState({
            status: "rejected",
            txHash: null,
            blockNumber: null,
            error: "You rejected the transaction in your wallet.",
            errorCategory: "user_rejected",
          });
        }, 1500);
        return;
      }

      // Step 2: submitted (after 1.5s)
      setTimeout(() => {
        setEndorseState({
          status: "submitted",
          txHash: DEMO_TX_HASH,
          blockNumber: null,
          error: null,
          errorCategory: null,
        });

        if (scenario === "error") {
          // After 2 more seconds, simulate contract error
          setTimeout(() => {
            setEndorseState({
              status: "error",
              txHash: DEMO_TX_HASH,
              blockNumber: null,
              error: "Execution reverted: Already endorsed this address.",
              errorCategory: "contract_error",
            });
          }, 2000);
          return;
        }

        // Step 3: confirmed (after 2 more seconds)
        setTimeout(() => {
          setEndorseState({
            status: "confirmed",
            txHash: DEMO_TX_HASH,
            blockNumber: DEMO_BLOCK_NUMBER,
            error: null,
            errorCategory: null,
          });
        }, 2000);
      }, 1500);
    },
    []
  );

  const handleDemoEndorse = useCallback(() => {
    const scenario = getDemoScenario();
    if (scenario === "cycle") {
      const scenarios: Array<"success" | "reject" | "error"> = [
        "success",
        "reject",
        "error",
      ];
      runDemoScenario(scenarios[demoCycleRef.current % 3]);
      demoCycleRef.current++;
    } else {
      runDemoScenario(scenario);
    }
  }, [runDemoScenario]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleEndorse = useCallback(() => {
    if (IS_DEMO_MODE) {
      handleDemoEndorse();
      return;
    }

    if (!isContractConfigured) {
      setEndorseState({
        status: "error",
        txHash: null,
        blockNumber: null,
        error: "Contract not deployed. See README for deployment instructions.",
        errorCategory: "contract_error",
      });
      return;
    }

    if (alreadyEndorsed) {
      setEndorseState({
        status: "error",
        txHash: null,
        blockNumber: null,
        error: "You have already endorsed this address.",
        errorCategory: "contract_error",
      });
      return;
    }

    setEndorseState({
      status: "awaitingConfirmation",
      txHash: null,
      blockNumber: null,
      error: null,
      errorCategory: null,
    });

    writeContract({
      address: CONTRACT_ADDRESS as `0x${string}`,
      abi: CONTRACT_ABI,
      functionName: "endorse",
      args: [address as `0x${string}`, BigInt(profile.score)],
    });
  }, [isContractConfigured, alreadyEndorsed, address, profile.score, writeContract, handleDemoEndorse]);

  const handleRetry = useCallback(() => {
    // In demo cycle mode, auto-trigger next scenario
    if (IS_DEMO_MODE && getDemoScenario() === "cycle") {
      const scenarios: Array<"success" | "reject" | "error"> = [
        "success",
        "reject",
        "error",
      ];
      const next = scenarios[demoCycleRef.current % 3];
      demoCycleRef.current++;
      // Small delay so the user sees the reset before the next scenario starts
      setTimeout(() => runDemoScenario(next), 300);
      return;
    }

    setEndorseState((s) => ({
      ...s,
      status: "idle",
      error: null,
      errorCategory: null,
    }));
    resetWrite();
  }, [resetWrite, runDemoScenario]);

  const handleConnect = useCallback(() => {
    const injected = connectors.find((c) => c.id === "injected");
    if (injected) {
      connect({ connector: injected });
    }
  }, [connect, connectors]);

  // ── Render: Not Connected ──────────────────────────────────────────────────

  if (endorseState.status === "notConnected" || !isConnected) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-4 animate-fade-in-up">
        {IS_DEMO_MODE && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-1.5 text-xs text-amber-400 text-center font-medium">
            🎭 Demo Mode — Connect any wallet to preview all states
          </div>
        )}
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center flex-shrink-0">
            <WalletIcon />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Connect Your Wallet</p>
            <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
              Connect your wallet to endorse this developer profile on-chain.
            </p>
          </div>
        </div>

        <div className="bg-slate-800/40 rounded-xl p-3 text-xs text-slate-500 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />
            <span>Endorsement is recorded on Sepolia testnet</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />
            <span>You pay a small gas fee (testnet ETH)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />
            <span>The endorsement is permanent and public</span>
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

  // ── Render: Already Endorsed (live mode only) ─────────────────────────────

  if (!IS_DEMO_MODE && alreadyEndorsed && endorseState.status === "idle") {
    return (
      <div className="rounded-2xl border border-green-500/20 bg-green-500/8 p-5 space-y-3 animate-fade-in-up">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-green-500/15 flex items-center justify-center text-xl flex-shrink-0">
            ✅
          </div>
          <div>
            <p className="text-sm font-semibold text-green-400">Already Endorsed</p>
            <p className="text-xs text-slate-400 mt-0.5">
              You have already endorsed this developer&apos;s profile on-chain.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Render: Confirmed ──────────────────────────────────────────────────────

  if (endorseState.status === "confirmed") {
    return (
      <div className="rounded-2xl border border-green-500/20 bg-green-500/8 p-5 space-y-3 animate-fade-in-up">
        {IS_DEMO_MODE && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-1.5 text-xs text-amber-400 text-center font-medium">
            🎭 Demo Mode — State 4/6: Confirmed
          </div>
        )}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-green-500/15 flex items-center justify-center text-xl flex-shrink-0">
            ✅
          </div>
          <div>
            <p className="text-sm font-semibold text-green-400">Endorsement Confirmed</p>
            <p className="text-xs text-slate-400 mt-0.5">
              Your endorsement has been recorded on the {IS_DEMO_MODE ? "simulated " : ""}Sepolia blockchain.
            </p>
          </div>
        </div>

        <div className="bg-slate-800/60 rounded-xl p-3 space-y-2 text-xs font-mono">
          {endorseState.txHash && (
            <div className="flex items-start gap-2">
              <span className="text-slate-600 flex-shrink-0">Tx</span>
              <span className="text-indigo-400 break-all">
                {endorseState.txHash.slice(0, 20)}...
                {!IS_DEMO_MODE && (
                  <a
                    href={`https://sepolia.etherscan.io/tx/${endorseState.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-1 hover:underline"
                  >
                    ↗
                  </a>
                )}
                {IS_DEMO_MODE && <span className="ml-1 text-amber-400">(simulated)</span>}
              </span>
            </div>
          )}
          {endorseState.blockNumber && (
            <div className="flex items-start gap-2">
              <span className="text-slate-600 flex-shrink-0">Block</span>
              <span className="text-slate-300">
                {endorseState.blockNumber}
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

        {!IS_DEMO_MODE && (
          <a
            href={`https://sepolia.etherscan.io/tx/${endorseState.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium transition-colors border border-slate-700"
          >
            View on Etherscan ↗
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
          {IS_DEMO_MODE ? "Demo" : "Endorsed on Proof of Dev"} · Sepolia testnet
        </p>
      </div>
    );
  }

  // ── Render: Rejected ───────────────────────────────────────────────────────

  if (endorseState.status === "rejected") {
    return (
      <div className="rounded-2xl border border-yellow-500/20 bg-yellow-500/8 p-5 space-y-4 animate-fade-in-up">
        {IS_DEMO_MODE && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-1.5 text-xs text-amber-400 text-center font-medium">
            🎭 Demo Mode — State 5/6: User Rejection
          </div>
        )}
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-yellow-500/15 flex items-center justify-center text-xl flex-shrink-0">
            🚫
          </div>
          <div>
            <p className="text-sm font-semibold text-yellow-400">Transaction Rejected</p>
            <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
              {endorseState.error}
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

  if (endorseState.status === "error") {
    return (
      <div className="rounded-2xl border border-red-500/20 bg-red-500/8 p-5 space-y-4 animate-fade-in-up">
        {IS_DEMO_MODE && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-1.5 text-xs text-amber-400 text-center font-medium">
            🎭 Demo Mode — State 6/6: Error
          </div>
        )}
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-500/15 flex items-center justify-center text-xl flex-shrink-0">
            ⚠️
          </div>
          <div>
            <p className="text-sm font-semibold text-red-400">
              {endorseState.errorCategory === "rpc_failure"
                ? "Network Error"
                : endorseState.errorCategory === "contract_error"
                  ? "Contract Error"
                  : "Transaction Failed"}
            </p>
            <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
              {endorseState.error}
            </p>
          </div>
        </div>

        {endorseState.errorCategory === "rpc_failure" && (
          <p className="text-xs text-slate-500">
            Check that you are connected to the Sepolia network and have sufficient testnet ETH.
          </p>
        )}

        {endorseState.errorCategory === "contract_error" && (
          <p className="text-xs text-slate-500">
            The contract may not be deployed on this network. Contact the project maintainer.
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

        {endorseState.txHash && !IS_DEMO_MODE && (
          <a
            href={`https://sepolia.etherscan.io/tx/${endorseState.txHash}`}
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

  const isBusy =
    endorseState.status === "awaitingConfirmation" || endorseState.status === "submitted";

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-4 animate-fade-in-up">
      {/* Demo mode banner */}
      {IS_DEMO_MODE && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-1.5 text-xs text-amber-400 text-center font-medium">
          🎭 Demo Mode
          {endorseState.status === "idle" && " — Click Endorse to simulate"}
          {endorseState.status === "awaitingConfirmation" && " — State 2/6: Awaiting Confirmation"}
          {endorseState.status === "submitted" && " — State 3/6: Submitted"}
        </div>
      )}

      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center flex-shrink-0">
          <EndorseIcon className="text-indigo-400" />
        </div>
        <div>
          <p className="text-sm font-semibold text-white">Endorse Developer</p>
          <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
            Record your endorsement of this developer&apos;s on-chain activity on the {IS_DEMO_MODE ? "simulated " : ""}Sepolia blockchain.
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

      {/* In-progress feedback */}
      {endorseState.status === "awaitingConfirmation" && (
        <div className="bg-indigo-500/8 border border-indigo-500/20 rounded-xl p-3 flex items-center gap-3">
          <Spinner />
          <div>
            <p className="text-xs font-medium text-indigo-300">Awaiting wallet confirmation</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {IS_DEMO_MODE
                ? "Simulating wallet popup... (auto-advancing in 1.5s)"
                : "Please confirm the transaction in your wallet."}
            </p>
          </div>
        </div>
      )}

      {endorseState.status === "submitted" && (
        <div className="bg-blue-500/8 border border-blue-500/20 rounded-xl p-3 space-y-2">
          <div className="flex items-center gap-3">
            <Spinner />
            <div>
              <p className="text-xs font-medium text-blue-300">Transaction submitted</p>
              <p className="text-xs text-slate-500 mt-0.5">
                {IS_DEMO_MODE
                  ? "Simulating block confirmation... (auto-advancing in 2s)"
                  : "Waiting for blockchain confirmation..."}
              </p>
            </div>
          </div>
          {endorseState.txHash && (
            <span className="block text-xs text-indigo-400 font-mono">
              {endorseState.txHash.slice(0, 24)}...
              {IS_DEMO_MODE && <span className="ml-1 text-amber-400 text-[10px]">(simulated)</span>}
              {!IS_DEMO_MODE && (
                <a
                  href={`https://sepolia.etherscan.io/tx/${endorseState.txHash}`}
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

      {/* Network switch or endorse button */}
      {!IS_DEMO_MODE && !isOnSepolia ? (
        <button
          onClick={() => switchChain({ chainId: sepolia.id })}
          className="w-full py-2.5 px-4 bg-yellow-600 hover:bg-yellow-500 text-white font-semibold rounded-xl transition-colors text-sm"
        >
          Switch to Sepolia
        </button>
      ) : (
        <button
          onClick={handleEndorse}
          disabled={isBusy || (!IS_DEMO_MODE && !!alreadyEndorsed)}
          className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors text-sm flex items-center justify-center gap-2"
        >
          {isBusy ? (
            <>
              <Spinner />
              {endorseState.status === "awaitingConfirmation"
                ? "Confirming..."
                : "Processing..."}
            </>
          ) : (
            <>
              <EndorseIcon className="w-4 h-4" />
              {IS_DEMO_MODE ? "Endorse (Demo)" : "Endorse"}
            </>
          )}
        </button>
      )}

      <p className="text-xs text-slate-700 text-center">
        {IS_DEMO_MODE ? "Demo" : "Sepolia testnet"} · Permanent · Public
      </p>
    </div>
  );
}

// ─── Helper components ────────────────────────────────────────────────────────

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

function EndorseIcon({ className }: { className?: string }) {
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
