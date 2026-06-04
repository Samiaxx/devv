/**
 * ZeroMQ push socket — hot-path analysis queue.
 *
 * The push socket is created once and kept alive for the lifetime of the
 * API process. It binds to QUEUE_ENDPOINT and distributes jobs round-robin
 * to all connected pull workers.
 */

import { Push } from "zeromq";
import { QUEUE_ENDPOINT } from "./config.js";

/** @type {Push | null} */
let _push = null;

/** @type {Promise<Push> | null} */
let _binding = null;

/**
 * Returns the singleton push socket, creating and binding it on first call.
 * @returns {Promise<Push>}
 */
export async function getPush() {
  if (_push) return _push;
  if (_binding) return _binding;

  _binding = (async () => {
    const push = new Push();
    await push.bind(QUEUE_ENDPOINT);
    _push = push;
    console.info(`[push] Bound on ${QUEUE_ENDPOINT}`);
    return push;
  })();

  try {
    return await _binding;
  } finally {
    _binding = null;
  }
}

/**
 * Close the push socket (called on graceful shutdown).
 */
export function closePush() {
  if (_push) {
    _push.close();
    _push = null;
    console.info("[push] Socket closed");
  }
}
