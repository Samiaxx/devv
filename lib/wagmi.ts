/**
 * Wagmi + RainbowKit configuration.
 * Supports Ethereum Mainnet and Sepolia testnet.
 *
 * Wallet groups:
 *   Hardware — Ledger (via Ledger Live + WalletConnect), Frame (Ledger + Trezor
 *              hardware signer), OneKey (hardware wallet + Trezor-compatible mode)
 *   Popular  — MetaMask (also supports Ledger/Trezor via its hardware flow),
 *              Rabby, Coinbase, Brave, Phantom, Zerion
 *   More     — Rainbow, OKX, Trust, Uniswap, Bybit
 *   Other    — injectedWallet (any unlisted extension), walletConnectWallet, Safe
 *
 * Hardware wallet connection paths:
 *   Ledger  → use "Ledger" (opens Ledger Live desktop app via WalletConnect)
 *             OR use "Frame" (Frame system wallet with Ledger as hardware signer)
 *             OR use "MetaMask" → Settings → Connect Hardware Wallet
 *   Trezor  → use "Frame" (Frame system wallet with Trezor as hardware signer)
 *             OR use "MetaMask" → Settings → Connect Hardware Wallet
 *             OR use "OneKey" with Trezor compatibility mode enabled
 */

import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  ledgerWallet,
  frameWallet,
  oneKeyWallet,
  metaMaskWallet,
  rabbyWallet,
  coinbaseWallet,
  braveWallet,
  phantomWallet,
  zerionWallet,
  rainbowWallet,
  okxWallet,
  trustWallet,
  uniswapWallet,
  bybitWallet,
  injectedWallet,
  walletConnectWallet,
  safeWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { mainnet, sepolia } from "wagmi/chains";

const projectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "demo";

// ─── Wallet list ──────────────────────────────────────────────────────────────

const connectors = connectorsForWallets(
  [
    {
      groupName: "Hardware Wallets",
      wallets: [ledgerWallet, frameWallet, oneKeyWallet],
    },
    {
      groupName: "Popular",
      wallets: [
        metaMaskWallet,
        rabbyWallet,
        coinbaseWallet,
        braveWallet,
        phantomWallet,
        zerionWallet,
      ],
    },
    {
      groupName: "More",
      wallets: [
        rainbowWallet,
        okxWallet,
        trustWallet,
        uniswapWallet,
        bybitWallet,
      ],
    },
    {
      groupName: "Other",
      wallets: [injectedWallet, walletConnectWallet, safeWallet],
    },
  ],
  {
    appName: "Proof of Dev",
    projectId,
  }
);

// ─── Wagmi config ─────────────────────────────────────────────────────────────

export const wagmiConfig = createConfig({
  connectors,
  chains: [mainnet, sepolia],
  transports: {
    [mainnet.id]: http(),
    [sepolia.id]: http(),
  },
});
