"use client";

import { useState } from "react";

/**
 * Collapsible notice explaining how to connect hardware wallets.
 * Shown above the ConnectButton so users know what to prepare before clicking.
 */
export function HardwareWalletNotice() {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-800/40 transition-colors"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <span className="text-base">🔐</span>
          <span className="text-sm font-medium text-slate-300">
            Using a hardware wallet?
          </span>
        </div>
        <span
          className={`text-slate-600 text-xs transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        >
          ▼
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-slate-800 space-y-3">
          <HWRow
            device="Ledger"
            icon="🟦"
            steps={[
              <>Select <strong className="text-slate-200">Ledger</strong> in the wallet list — opens Ledger Live via WalletConnect.</>,
              <>Ledger Live must be open on your desktop with the <strong className="text-slate-200">Ethereum app</strong> active on the device.</>,
              <>Alternatively, use <strong className="text-slate-200">Frame</strong> with your Ledger plugged in as a hardware signer.</>,
            ]}
          />
          <HWRow
            device="Trezor"
            icon="🟩"
            steps={[
              <>Select <strong className="text-slate-200">Frame</strong> — Frame is a system wallet that accepts Trezor as a hardware signer. Install <a href="https://frame.sh" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">frame.sh</a>, plug in your Trezor, then connect.</>,
              <>Or select <strong className="text-slate-200">MetaMask</strong> → Settings → Advanced → <em>Connect Hardware Wallet</em>.</>,
              <>OneKey hardware devices also work via the <strong className="text-slate-200">OneKey</strong> option with Trezor compatibility mode enabled.</>,
            ]}
          />
        </div>
      )}
    </div>
  );
}

function HWRow({
  device,
  icon,
  steps,
}: {
  device: string;
  icon: string;
  steps: React.ReactNode[];
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
        <span>{icon}</span>
        {device}
      </p>
      <ol className="space-y-1 pl-1">
        {steps.map((step, i) => (
          <li key={i} className="flex items-start gap-2 text-xs text-slate-500 leading-relaxed">
            <span className="text-slate-700 font-mono mt-px flex-shrink-0">{i + 1}.</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
