/**
 * Worker process — pulls jobs from the ZeroMQ push socket and processes them.
 *
 * Transport: ZeroMQ pull socket connecting to QUEUE_ENDPOINT.
 * The API server binds the push socket; this process connects to it.
 * Multiple worker processes can run in parallel — ZeroMQ distributes
 * jobs round-robin across all connected pull sockets.
 */

import { Pull } from "zeromq";
import { analyzeWallet, countUniqueInteractors } from "./tasks.js";
import { QUEUE_ENDPOINT } from "./config.js";
import { ensureIndexes, saveJobResult } from "./db.js";
import { setEnrichmentHandler } from "./queues.js";

// ─── Startup ──────────────────────────────────────────────────────────────────

// Try to ensure indexes but don't crash if MongoDB is unavailable
ensureIndexes().then(() => {
  console.info("[worker] MongoDB ready");
}).catch(() => {
  // already warned inside ensureIndexes
});

// Register the enrichment handler (non-hot-path, in-process queue)
setEnrichmentHandler(countUniqueInteractors);
console.info("[worker] Enrichment handler registered");

// ─── ZeroMQ pull socket ───────────────────────────────────────────────────────

const pull = new Pull();
pull.connect(QUEUE_ENDPOINT);
console.info(`[worker] Connected to queue on ${QUEUE_ENDPOINT}`);

// ─── Graceful shutdown ────────────────────────────────────────────────────────

function shutdown() {
  console.info("[worker] Shutting down...");
  pull.close();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT",  shutdown);

async function run() {
  console.info("[worker] Ready — waiting for jobs on ZeroMQ pull socket");

  for await (const [raw] of pull) {
    let job;
    try {
      job = JSON.parse(raw.toString());
    } catch (err) {
      console.error("[worker] Failed to parse job message:", err.message);
      continue;
    }

    const { jobId, walletAddress, network, includeEns } = job;
    console.info(`[worker] Received job ${jobId}: address=${walletAddress} chain=${network}`);

    try {
      const result = await analyzeWallet({ walletAddress, network, includeEns });
      await saveJobResult(jobId, { status: "SUCCESS", result });
      console.info(`[worker] Job ${jobId} completed`);
    } catch (err) {
      console.error(`[worker] Job ${jobId} failed: ${err.message}`);
      await saveJobResult(jobId, { status: "FAILURE", error: err.message }).catch(() => {});
    }
  }
}

run().catch((err) => {
  console.error("[worker] Pull loop failed:", err.message);
  process.exit(1);
});
