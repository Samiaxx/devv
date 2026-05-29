# Proof of Dev — On-Chain Developer Reputation

A full-stack web app that analyzes an Ethereum wallet's on-chain developer activity and generates a transparent, explainable reputation score. Optionally mint it as a soulbound (non-transferable) NFT on Sepolia.

---

## Features

- **Wallet Connection** — MetaMask or WalletConnect via RainbowKit
- **Contract Deployment Detection** — finds all contracts deployed by the wallet using Alchemy, with Etherscan as automatic fallback
- **Verification Check** — checks each contract against Etherscan for source verification (batched, rate-limit safe)
- **ENS Resolution** — opt-in; resolves ENS name, avatar, URL, and GitHub handle
- **Reputation Scoring** — pure, deterministic scoring engine with time-based multipliers and burst detection
- **Proof-of-Dev NFT** — soulbound ERC-721 on Sepolia, minted directly from the UI
- **Downloadable Report** — plain-text off-chain report with full score breakdown
- **Privacy-first** — ENS is opt-in, no data is stored server-side

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Fill in `.env.local`:

| Variable | Where to get it |
|---|---|
| `NEXT_PUBLIC_ALCHEMY_API_KEY` | [dashboard.alchemy.com](https://dashboard.alchemy.com) |
| `ETHERSCAN_API_KEY` | [etherscan.io/myapikey](https://etherscan.io/myapikey) |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | [cloud.walletconnect.com](https://cloud.walletconnect.com) |
| `NEXT_PUBLIC_CONTRACT_ADDRESS` | Set after deploying the contract (see below) |
| `NEXT_PUBLIC_EAS_SCHEMA_UID` | Set after running `scripts/registerSchema.ts` (see below) |
| `ATTESTER_PRIVATE_KEY` | Private key of the server-side attester wallet (never exposed to client) |

### 3. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## How Scoring Works

The scoring engine lives in `lib/core/scoring.ts` — pure functions, no side effects.

| Signal | Points |
|---|---|
| Contract deployment | +5 per contract |
| Verified contract (Etherscan) | +10 per verified contract |
| ENS name ownership | +2 |
| ENS metadata (avatar / url / github) | +3 per field |
| Activity older than 30 days | 1.2× multiplier |
| Activity within last 30 days | 0.8× multiplier |
| Burst deployment (3+ in 7 days) | additional 0.8× penalty |

Caps: max 10 deployments scored, max 10 verified contracts scored.

### Score Tiers

| Score | Tier |
|---|---|
| 0 | No Activity |
| 1–9 | Early Activity |
| 10–29 | Active Builder |
| 30–59 | Established |
| 60–99 | Prolific |
| 100+ | Extensive |

---

## EAS Attestation Setup

The attestation feature uses the [Ethereum Attestation Service](https://attest.org) on Sepolia.

### 1. Register the schema (once)

```bash
export ATTESTER_PRIVATE_KEY=0x...
export NEXT_PUBLIC_ALCHEMY_API_KEY=...

npx ts-node scripts/registerSchema.ts
```

Copy the printed UID into `.env.local`:
```
NEXT_PUBLIC_EAS_SCHEMA_UID=0x...
```

### 2. Set the attester key

`ATTESTER_PRIVATE_KEY` is a server-side wallet that signs delegated attestations. It does **not** need ETH — the user pays gas when they submit. Generate a fresh wallet for this purpose; never reuse a personal key.

### How it works

1. User clicks "Get Attestation" after analyzing their wallet.
2. The browser calls `POST /api/attest` with the profile data.
3. The server signs a delegated EAS attestation using `ATTESTER_PRIVATE_KEY`.
4. The signed payload is returned to the browser.
5. The user's wallet submits it to the EAS contract on Sepolia (user pays gas).
6. The attestation UID is shown with a link to [sepolia.easscan.org](https://sepolia.easscan.org).

The user can revoke their attestation at any time from the EAS Explorer.

---

## Deploying the NFT ContractThe `ProofOfDev.sol` contract is a minimal soulbound ERC-721. Deploy it to Sepolia:

### Option A: Remix IDE (easiest)

1. Open [remix.ethereum.org](https://remix.ethereum.org)
2. Create a new file, paste the contents of `contracts/ProofOfDev.sol`
3. Compile with Solidity 0.8.20
4. Deploy to Sepolia with constructor arg: `"https://your-domain.com/api/token"`
5. Copy the deployed address into `.env.local`:
   ```
   NEXT_PUBLIC_CONTRACT_ADDRESS=0x...
   ```

### Option B: Script

```bash
# Install ts-node if needed
npm install -D ts-node

# Set env vars
export DEPLOYER_PRIVATE_KEY=0x...
export NEXT_PUBLIC_ALCHEMY_API_KEY=...

# Compile first (requires solc)
npx solc --abi --bin --output-dir artifacts contracts/ProofOfDev.sol

# Deploy
npx ts-node scripts/deploy.ts
```

---

## Project Structure

```
proof-of-dev/
├── app/
│   ├── api/
│   │   ├── analyze/route.ts        # POST: analyze wallet
│   │   └── token/[id]/route.ts     # GET: ERC-721 token metadata
│   ├── providers.tsx               # Wagmi + RainbowKit providers
│   ├── layout.tsx
│   └── page.tsx                    # Main UI
├── components/
│   ├── AnalysisDashboard.tsx       # Orchestrates result display
│   ├── AppLoadingScreen.tsx        # Hydration splash screen
│   ├── ScoreCard.tsx               # Score + breakdown
│   ├── ContractList.tsx            # Deployed contracts table
│   ├── ENSCard.tsx                 # ENS identity card
│   ├── MintButton.tsx              # NFT mint flow (with confirm modal)
│   ├── SkeletonDashboard.tsx       # Loading skeleton
│   └── ui/                        # Badge, Card, NoticeBox, ProgressBar, Spinner
├── contracts/
│   └── ProofOfDev.sol              # Soulbound ERC-721
├── hooks/
│   └── useAppReady.ts              # Hydration-ready hook
├── lib/
│   ├── api/
│   │   └── analyzeController.ts   # Pipeline orchestrator
│   ├── core/
│   │   ├── constants.ts           # Scoring weights, caps, time thresholds
│   │   ├── formatting.ts          # Display formatting + text report generator
│   │   ├── reputation.ts          # ReputationProfile builder
│   │   ├── scoring.ts             # Pure scoring engine + tier labels
│   │   └── validation.ts          # Input validation and sanitization
│   ├── errors/
│   │   ├── AppError.ts            # Typed error class with HTTP status
│   │   ├── errorCodes.ts          # Error code registry
│   │   └── errorHandler.ts        # API route error → NextResponse converter
│   ├── normalizers/
│   │   ├── contracts.ts           # ContractDeployment → NormalizedContract
│   │   ├── ens.ts                 # ENSData → ENSProfile
│   │   └── index.ts               # Re-exports
│   ├── privacy/
│   │   ├── consent.ts             # ConsentConfig — gates all data processing
│   │   └── filters.ts             # Apply consent before scoring
│   ├── services/
│   │   ├── blockchain.ts          # Alchemy: contract deployment detection
│   │   ├── ens.ts                 # ethers.js ENS resolution (mainnet only)
│   │   └── etherscan.ts           # Verification check + deployment fallback
│   ├── config.ts                  # All env vars and feature flags
│   ├── contract.ts                # ABI + address config
│   ├── logger.ts                  # Server-side logger
│   ├── scoring.ts                 # Legacy re-export (use lib/core/scoring.ts)
│   ├── types.ts                   # Shared TypeScript types
│   ├── utils.ts                   # Shared utilities
│   └── wagmi.ts                   # Wagmi config (clears session on every load)
├── scripts/
│   └── deploy.ts                  # Contract deployment script
└── .env.local                     # API keys (not committed)
```

---

## Architecture Notes

### Data Flow

```
POST /api/analyze
  → validateAnalysisRequest()
  → fetchContracts()        (Alchemy → Etherscan fallback, parallel with ENS)
  → fetchENS()              (opt-in, mainnet only)
  → enrichWithVerification() (Etherscan, batched)
  → normalizeContracts() + deduplicateContracts()
  → filterContracts() + filterENS()  (consent gates)
  → buildReputationProfile()
  → AnalysisResponse
```

### Type Layers

| Prefix | Meaning |
|---|---|
| `Raw*` | Data as returned by external APIs |
| `Normalized*` | Validated, sanitized, safe for scoring |
| `*Profile` | Structured output ready for the UI |
| `*Response` | Shape of an API response |

### Session Policy

Wagmi connector state is cleared from `localStorage` on every page load (`lib/wagmi.ts`). Users must reconnect their wallet after each app restart — intentional, to avoid stale session issues.

---

## API Reference

### `POST /api/analyze`

Analyzes a wallet address.

**Body:**
```json
{
  "address": "0x...",
  "network": "mainnet" | "sepolia",
  "includeENS": true | false
}
```

**Response:** `AnalysisResponse` (see `lib/types.ts`)

---

### `GET /api/token/[id]`

Returns ERC-721 token metadata for a minted Proof-of-Dev NFT.

---

## Tech Stack

- **Next.js 16.2.4** (App Router) + TypeScript
- **React 19** + **TailwindCSS 3**
- **RainbowKit v2 + Wagmi v2** for wallet connection
- **ethers.js v6** for ENS resolution
- **Alchemy API** for contract deployment detection
- **Etherscan API** for verification status
- **Solidity 0.8.20** for the soulbound NFT contract
