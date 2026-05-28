"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";

/**
 * Tracks whether the app has finished hydrating wallet state.
 *
 * Wagmi with ssr:true always starts with isConnected=false on the server.
 * On the client, it re-hydrates from localStorage asynchronously.
 *
 * This hook returns `ready=false` until ALL of:
 *   1. The component has mounted (client-side only)
 *   2. A minimum display time has elapsed (splash feels intentional)
 *   3. Wagmi has settled — OR a hard timeout has fired
 *
 * The hard timeout (default 4s) prevents the app from being stuck on the
 * loading screen forever when WalletConnect fails to initialize (e.g. 403
 * from an invalid project ID). After the timeout, we proceed regardless
 * of wagmi's status — the user will simply see the connect prompt.
 *
 * @param minDisplayMs   Minimum ms to show the loading screen (default 1500)
 * @param maxWaitMs      Hard timeout — give up waiting for wagmi (default 4000)
 */
export function useAppReady(minDisplayMs = 1500, maxWaitMs = 4000) {
  const { status } = useAccount();
  const [mounted, setMounted] = useState(false);
  const [minElapsed, setMinElapsed] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  // Step 1: mark mounted after first client render
  useEffect(() => {
    setMounted(true);
  }, []);

  // Step 2: minimum display time
  useEffect(() => {
    const timer = setTimeout(() => setMinElapsed(true), minDisplayMs);
    return () => clearTimeout(timer);
  }, [minDisplayMs]);

  // Step 3: hard timeout — stop waiting for wagmi after maxWaitMs
  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), maxWaitMs);
    return () => clearTimeout(timer);
  }, [maxWaitMs]);

  // Wagmi has settled when status is connected or disconnected
  // OR when the hard timeout fires (handles WalletConnect 403 hang)
  const wagmiSettled =
    status === "connected" ||
    status === "disconnected" ||
    timedOut;

  const ready = mounted && minElapsed && wagmiSettled;

  return { ready, status };
}
