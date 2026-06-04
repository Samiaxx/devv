"use client";

import { useState } from "react";
import { useAccount, useWalletClient, useChainId, useSwitchChain } from "wagmi";
import { sepolia } from "wagmi/chains";
import { EAS } from "@ethereum-attestation-service/eas-sdk";
import { BrowserProvider } from "ethers";
import { ReputationProfile, AttestationState } from "@/lib/types";
import { easScanUrl } from "@/lib/eas/config";
import { Spinner } from "@/components/ui/Spinner";
import { NoticeBox } from "@/components/ui/NoticeBox";

interface AttestButtonProps {
  profile: ReputationProfile;
  address: string;
}

export function AttestButton({ profile, address }: AttestButtonProps) {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { data: walletClient } = useWalletClient();

  const [state, setState] = useState<AttestationState>({
    status: "idle",
    uid: null,
    txHash: null,
    error: null,
  });

  const isOnSepolia = chainId === sepolia.id;

  async function handleAttest() {
    if (!walletClient) return;

    setState({ status: "signing", uid: null, txHash: null, error: null });

    try {
      // Step 1 — Ask server to sign a delegated attestation
      const res = await fetch("/api/attest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, profile }),
      });

      const payload = await res.json();

      if (!res.ok) {
        throw new Error(payload.error ?? "Server signing failed");
      }

      // Step 2 — Submit the delegated attestation on-chain (user pays gas)
      setState((s) => ({ ...s, status: "pending" }));

      // Bridge wagmi's WalletClient to an ethers.js Signer for the EAS SDK
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

      // wait() resolves to the attestation UID directly
      const uid = await tx.wait();

      setState({ status: "success", uid: uid ?? null, txHash: tx.receipt?.hash ?? null, error: null });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message.split("\n")[0] : "Attestation failed";
      setState({ status: "error", uid: null, txHash: null, error: msg });
    }
  }

  if (!isConnected) return null;

  // ── Success ──────────────────────────────────────────────────────────────────
  if (state.status === "success") {
    return (
      <div className="rounded-2xl border border-green-500/20 bg-green-500/8 p-5 space-y-3 animate-fade-in-up">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-green-500/15 flex items-center justify-center text-xl flex-shrink-0">
            ✅
          </div>
          <div>
            <p className="text-sm font-semibold text-green-400">Attestation confirmed</p>
            <p className="text-xs text-slate-400 mt-0.5">
              Your reputation profile is now a verifiable on-chain credential.
            </p>
          </div>
        </div>

        <div className="bg-slate-800/60 rounded-xl p-3 space-y-2 text-xs font-mono">
          {state.uid && (
            <div className="flex items-start gap-2">
              <span className="text-slate-600 flex-shrink-0">UID</span>
              <span className="text-slate-300 break-all">{state.uid}</span>
            </div>
          )}
          {state.txHash && (
            <div className="flex items-start gap-2">
              <span className="text-slate-600 flex-shrink-0">Tx </span>
              <a
                href={`https://sepolia.etherscan.io/tx/${state.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-400 hover:underline break-all"
              >
                {state.txHash.slice(0, 20)}… ↗
              </a>
            </div>
          )}
        </div>

        {state.uid && (
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

        <p className="text-xs text-slate-600 text-center">
          Attested by Proof of Dev · Sepolia testnet · Revocable
        </p>
      </div>
    );
  }

  const isBusy = state.status === "signing" || state.status === "pending";

  // ── Default / error ───────────────────────────────────────────────────────────
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-4 animate-fade-in-up">
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

      {/* What gets attested */}
      <div className="bg-slate-800/50 rounded-xl p-3 grid grid-cols-2 gap-2 text-xs">
        <DataRow label="Score" value={String(profile.score)} />
        <DataRow label="Tier" value={profile.summary.tier} />
        <DataRow label="Contracts" value={String(profile.summary.contractCount)} />
        <DataRow label="Verified" value={String(profile.summary.verifiedContractCount)} />
        <DataRow label="ENS" value={profile.summary.hasENS ? "Yes" : "No"} />
        <DataRow label="Network" value="Sepolia" />
      </div>

      {/* How it works */}
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

      {/* Error */}
      {state.status === "error" && (
        <NoticeBox variant="error">{state.error}</NoticeBox>
      )}

      {/* Action */}
      {!isOnSepolia ? (
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
              {state.status === "signing" ? "Signing…" : "Confirming…"}
            </>
          ) : (
            <>
              <EASIcon />
              {state.status === "error" ? "Retry Attestation" : "Get Attestation"}
            </>
          )}
        </button>
      )}

      <p className="text-xs text-slate-700 text-center">
        Sepolia testnet · Revocable · No personal data stored
      </p>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-slate-600">{label}</span>
      <span className="text-slate-300 font-medium">{value}</span>
    </div>
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
