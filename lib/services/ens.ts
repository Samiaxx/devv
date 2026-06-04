/**
 * ENS service — resolves ENS name and fetches text records for a wallet.
 * Uses ethers.js with the Alchemy provider for reliable resolution.
 * ENS is always resolved against mainnet regardless of the selected network.
 */

import { ethers } from "ethers";
import { ENSData } from "@/lib/types";
import { config } from "@/lib/config";

function getProvider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(config.alchemy.mainnetUrl);
}

/**
 * Resolves ENS name and fetches text records for an address.
 * Returns null values for any records that don't exist.
 * Never throws — returns empty data on any failure.
 */
export async function getENSData(address: string): Promise<ENSData> {
  const provider = getProvider();

  try {
    const name = await provider.lookupAddress(address);

    if (!name) {
      return { name: null, avatar: null, url: null, github: null };
    }

    const resolver = await provider.getResolver(name);

    if (!resolver) {
      return { name, avatar: null, url: null, github: null };
    }

    const [avatar, url, github] = await Promise.all([
      resolver.getText("avatar").catch(() => null),
      resolver.getText("url").catch(() => null),
      resolver.getText("com.github").catch(() => null),
    ]);

    return {
      name,
      avatar: avatar || null,
      url: url || null,
      github: github || null,
    };
  } catch {
    return { name: null, avatar: null, url: null, github: null };
  }
}
