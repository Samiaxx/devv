/**
 * Blockchain service — fetches contract deployments for a wallet address.
 * Uses the Alchemy Asset Transfers API to find transactions where the
 * wallet sent a transaction with no "to" address (contract creation).
 */

import { ContractDeployment } from "@/lib/types";
import { alchemyUrl, config } from "@/lib/config";

interface AlchemyTransfer {
  hash: string;
  blockNum: string;
  from: string;
  to: string | null;
  asset: string | null;
  category: string;
  metadata: { blockTimestamp: string };
}

/**
 * Fetches all contract deployments made by a wallet address.
 * Contract deployments are identified as transactions with no "to" address.
 */
export async function getContractDeployments(
  address: string,
  network: "mainnet" | "sepolia" = "mainnet"
): Promise<ContractDeployment[]> {
  const url = alchemyUrl(network);

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method: "alchemy_getAssetTransfers",
      params: [
        {
          fromAddress: address,
          category: ["external"],
          withMetadata: true,
          excludeZeroValue: false,
          maxCount: `0x${config.limits.maxAlchemyTransfers.toString(16)}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Alchemy API error: ${response.statusText}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(`Alchemy RPC error: ${data.error.message}`);
  }

  const transfers: AlchemyTransfer[] = data.result?.transfers ?? [];
  const deploymentTxs = transfers.filter((tx) => tx.to === null);

  if (deploymentTxs.length === 0) return [];

  const deployments: ContractDeployment[] = [];

  await Promise.all(
    deploymentTxs.map(async (tx) => {
      try {
        const receiptRes = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: 1,
            jsonrpc: "2.0",
            method: "eth_getTransactionReceipt",
            params: [tx.hash],
          }),
        });

        const receiptData = await receiptRes.json();
        const receipt = receiptData.result;

        if (receipt?.contractAddress) {
          const timestamp = tx.metadata?.blockTimestamp
            ? Math.floor(new Date(tx.metadata.blockTimestamp).getTime() / 1000)
            : 0;

          deployments.push({
            contractAddress: receipt.contractAddress.toLowerCase(),
            transactionHash: tx.hash,
            blockNumber: parseInt(tx.blockNum, 16),
            timestamp,
            isVerified: false,
          });
        }
      } catch {
        // Skip failed receipt lookups — don't crash the whole analysis
      }
    })
  );

  return deployments;
}
