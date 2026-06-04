"use client";

import { useEffect, useRef } from "react";
import { useAccount, useDisconnect } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";

/**
 * Opens the RainbowKit connect modal once per page load.
 *
 * Strategy:
 *   - `reconnectOnMount: false` in wagmiConfig means status settles to
 *     "disconnected" quickly and reliably.
 *   - Once disconnected, we wait 300ms for RainbowKit to finish its own
 *     internal init (WalletConnect socket, Lit components, etc.), then
 *     call openConnectModal via a stable ref so we always get the latest
 *     value regardless of when the timeout fires.
 *   - didOpenRef ensures we open exactly once per page load.
 */
export function useAutoConnect(appReady: boolean) {
  const { isConnected, status } = useAccount();
  const { disconnect } = useDisconnect();
  const { openConnectModal } = useConnectModal();

  const didDisconnectRef = useRef(false);
  const didOpenRef       = useRef(false);
  const openModalRef     = useRef(openConnectModal);

  // Always keep the ref pointing at the latest openConnectModal value
  openModalRef.current = openConnectModal;

  // Step 1 — disconnect once on mount if silently reconnected
  useEffect(() => {
    if (!appReady || didDisconnectRef.current) return;
    didDisconnectRef.current = true;
    if (isConnected) disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appReady]);

  // Step 2 — once disconnected, wait 300ms then open modal via ref
  useEffect(() => {
    if (!appReady)                        return;
    if (!didDisconnectRef.current)        return;
    if (didOpenRef.current)               return;
    if (status !== "disconnected")        return;

    const timer = setTimeout(() => {
      if (didOpenRef.current) return; // guard against double-fire
      const open = openModalRef.current;
      if (!open) return;
      didOpenRef.current = true;
      open();
    }, 300);

    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appReady, status]);
}
