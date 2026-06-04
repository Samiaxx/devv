/**
 * Etherscan service — checks contract verification status.
 * Also used as a fallback to detect contract deployments via tx list.
 */

import { ContractDeployment } from "@/lib/types";
import { etherscanUrl, config } from "@/lib/config";

interface EtherscanSourceResult {
  SourceCode: string;
  ABI: string;
  ContractName: string;
}

/**
 * Checks if a contract is verified on Etherscan.
 * Returns { isVerified: false } on any error — never throws.
 */
export async function getContractVerification(
  contractAddress: string,
  network: "mainnet" | "sepolia" = "mainnet"
): Promise<{ isVerified: boolean; abi?: object[] }> {
  const base = etherscanUrl(network);

  try {
    const res = await fetch(
      `${base}?module=contract&action=getsourcecode&address=${contractAddress}&apikey=${config.etherscan.apiKey}`
    );

    if (!res.ok) return { isVerified: false };

    const data = await res.json();
    if (data.status !== "1" || !data.result?.[0]) return { isVerified: false };

    const result: EtherscanSourceResult = data.result[0];

    const isVerified =
      result.SourceCode !== "" &&
      result.SourceCode !== "1" &&
      result.ABI !== "Contract source code not verified";

    if (!isVerified) return { isVerified: false };

    let abi: object[] | undefined;
    try {
      abi = JSON.parse(result.ABI);
    } catch {
      // ABI parse failed — still mark as verified
    }

    return { isVerified: true, abi };
  } catch {
    return { isVerified: false };
  }
}

/**
 * Enriches a list of contract deployments with verification status.
 * Batched to respect Etherscan free-tier rate limits (5 req/s).
 */
export async function enrichWithVerification(
  deployments: ContractDeployment[],
  network: "mainnet" | "sepolia" = "mainnet"
): Promise<ContractDeployment[]> {
  const { etherscanBatchSize, etherscanBatchDelayMs } = config.limits;
  const enriched: ContractDeployment[] = [];

  for (let i = 0; i < deployments.length; i += etherscanBatchSize) {
    const batch = deployments.slice(i, i + etherscanBatchSize);

    const results = await Promise.all(
      batch.map(async (deployment) => {
        const verification = await getContractVerification(
          deployment.contractAddress,
          network
        );
        return { ...deployment, ...verification };
      })
    );

    enriched.push(...results);

    if (i + etherscanBatchSize < deployments.length) {
      await new Promise((resolve) => setTimeout(resolve, etherscanBatchDelayMs));
    }
  }

  return enriched;
}

/**
 * Fallback: fetch contract deployments from Etherscan's tx list.
 * Used when Alchemy is unavailable or returns no results.
 */
export async function getDeploymentsFromEtherscan(
  address: string,
  network: "mainnet" | "sepolia" = "mainnet"
): Promise<ContractDeployment[]> {
  const base = etherscanUrl(network);

  try {
    const res = await fetch(
      `${base}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&sort=asc&apikey=${config.etherscan.apiKey}`
    );

    if (!res.ok) return [];

    const data = await res.json();
    if (data.status !== "1" || !Array.isArray(data.result)) return [];

    return data.result
      .filter(
        (tx: { to: string; contractAddress: string; isError: string }) =>
          tx.to === "" && tx.contractAddress !== "" && tx.isError === "0"
      )
      .map(
        (tx: {
          contractAddress: string;
          hash: string;
          blockNumber: string;
          timeStamp: string;
        }) => ({
          contractAddress: tx.contractAddress.toLowerCase(),
          transactionHash: tx.hash,
          blockNumber: parseInt(tx.blockNumber),
          timestamp: parseInt(tx.timeStamp),
          isVerified: false,
        })
      );
  } catch {
    return [];
  }
}
