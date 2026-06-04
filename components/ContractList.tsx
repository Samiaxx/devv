"use client";

import { NormalizedContract } from "@/lib/types";
import { Card, CardBody, SectionLabel } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

interface ContractListProps {
  contracts: NormalizedContract[];
  network: "mainnet" | "sepolia";
}

export function ContractList({ contracts, network }: ContractListProps) {
  const explorerBase =
    network === "sepolia" ? "https://sepolia.etherscan.io" : "https://etherscan.io";

  return (
    <Card>
      <CardBody>
        <div className="flex items-center justify-between mb-5">
          <SectionLabel>Deployed Contracts</SectionLabel>
          {contracts.length > 0 && (
            <Badge
              label={`${contracts.length} total`}
              variant="indigo"
            />
          )}
        </div>

        {contracts.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-2">
            {/* Table header */}
            <div className="hidden sm:grid grid-cols-[1fr_auto_auto_auto] gap-4 px-3 pb-2 border-b border-slate-800">
              <span className="text-xs text-slate-600 font-medium">Contract</span>
              <span className="text-xs text-slate-600 font-medium">Status</span>
              <span className="text-xs text-slate-600 font-medium">Deployed</span>
              <span className="text-xs text-slate-600 font-medium">Tx</span>
            </div>

            {contracts.map((contract) => (
              <ContractRow
                key={contract.contractAddress}
                contract={contract}
                explorerBase={explorerBase}
              />
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function ContractRow({
  contract,
  explorerBase,
}: {
  contract: NormalizedContract;
  explorerBase: string;
}) {
  const shortAddr = `${contract.contractAddress.slice(0, 8)}...${contract.contractAddress.slice(-6)}`;
  const shortTx   = contract.transactionHash
    ? `${contract.transactionHash.slice(0, 10)}...`
    : "—";
  const date = contract.timestamp
    ? new Date(contract.timestamp * 1000).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "Unknown";

  return (
    <div className="group grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto] gap-2 sm:gap-4 items-center px-3 py-3 rounded-xl hover:bg-slate-800/50 transition-colors">
      {/* Address */}
      <a
        href={`${explorerBase}/address/${contract.contractAddress}`}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-sm text-indigo-400 hover:text-indigo-300 transition-colors truncate"
        title={contract.contractAddress}
      >
        {shortAddr}
      </a>

      {/* Verified badge */}
      <div className="flex sm:justify-center">
        <Badge
          label={contract.isVerified ? "Verified" : "Unverified"}
          variant={contract.isVerified ? "green" : "gray"}
          dot
        />
      </div>

      {/* Date */}
      <span className="text-xs text-slate-500 sm:text-center">{date}</span>

      {/* Tx link */}
      {contract.transactionHash ? (
        <a
          href={`${explorerBase}/tx/${contract.transactionHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-xs text-slate-600 hover:text-slate-400 transition-colors sm:text-right"
          title={contract.transactionHash}
        >
          {shortTx} ↗
        </a>
      ) : (
        <span className="text-xs text-slate-700 sm:text-right">—</span>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <div className="w-12 h-12 rounded-2xl bg-slate-800 flex items-center justify-center text-2xl mb-3">
        📭
      </div>
      <p className="text-sm font-medium text-slate-400">No contracts detected</p>
      <p className="text-xs text-slate-600 mt-1 max-w-xs">
        No contract deployments were found for this address on the selected network.
      </p>
    </div>
  );
}
