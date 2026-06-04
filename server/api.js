/**
 * Express API — thin HTTP layer over the ZeroMQ push/pull queue.
 *
 * Endpoints:
 *   POST /analyze           — enqueue a wallet analysis job via ZeroMQ push socket
 *   GET  /result/:jobId     — poll for job result (stored in MongoDB)
 *   GET  /profile/:address  — fetch the latest stored result from MongoDB
 *   GET  /health            — health check
 *
 * Hot-path transport: ZeroMQ push socket bound on QUEUE_ENDPOINT.
 * The worker process connects a pull socket to the same port and processes
 * jobs round-robin.
 *
 * Run with:
 *   node src/api.js
 */

import { randomUUID } from "crypto";
import express from "express";
import { getPush, closePush } from "./push.js";
import { getLatestResult, getJobResult, ensureIndexes } from "./db.js";

const app  = express();
const PORT = parseInt(process.env.PORT ?? "8000", 10);

const ETH_ADDRESS_RE  = /^0x[0-9a-fA-F]{40}$/;
const ALLOWED_NETWORKS = new Set(["mainnet", "sepolia", "polygon", "arbitrum", "optimism", "base"]);

app.use(express.json());

// ─── Startup ──────────────────────────────────────────────────────────────────

// Try to ensure indexes but don't crash if MongoDB is unavailable
ensureIndexes().then(() => {
  console.info("[api] MongoDB ready");
}).catch(() => {
  // already warned inside ensureIndexes
});

// Initialise the push socket early so the first request isn't delayed
const push = await getPush();

// ─── Endpoints ────────────────────────────────────────────────────────────────

/**
 * POST /analyze
 * Enqueue a wallet analysis job via ZeroMQ push socket.
 * Returns { job_id, status: "PENDING" }
 */
app.post("/analyze", async (req, res) => {
  const { address, network = "mainnet", include_ens = false } = req.body ?? {};

  if (!address || !ETH_ADDRESS_RE.test(address)) {
    return res.status(400).json({ error: "Invalid Ethereum address" });
  }
  if (!ALLOWED_NETWORKS.has(network)) {
    return res.status(400).json({
      error: `network must be one of: ${[...ALLOWED_NETWORKS].join(", ")}`,
    });
  }

  try {
    const jobId   = randomUUID();
    const payload = JSON.stringify({
      jobId,
      walletAddress: address.toLowerCase(),
      network,
      includeEns: include_ens,
    });

    // Send job to worker via ZeroMQ push — round-robin across connected workers
    await push.send(payload);

    return res.status(202).json({ job_id: jobId, status: "PENDING" });
  } catch (err) {
    console.error("[api] Failed to enqueue job:", err);
    return res.status(500).json({ error: "Failed to enqueue analysis job" });
  }
});

/**
 * GET /result/:jobId
 * Poll for the result of an enqueued analysis job.
 *
 * Status values:
 *   PENDING  — job has been sent to a worker, not yet complete
 *   SUCCESS  — completed; result contains the analysis data
 *   FAILURE  — job raised an exception; error contains the message
 */
app.get("/result/:jobId", async (req, res) => {
  const { jobId } = req.params;

  try {
    const record = await getJobResult(jobId);

    if (!record) {
      // Either job is still pending or MongoDB is unavailable
      return res.json({ job_id: jobId, status: "PENDING", result: null });
    }

    if (record.status === "FAILURE") {
      return res.json({ job_id: jobId, status: "FAILURE", error: record.error });
    }

    return res.json({ job_id: jobId, status: "SUCCESS", result: record.result });
  } catch (err) {
    console.error("[api] Error fetching job result:", err);
    return res.status(500).json({ error: "Failed to fetch job result" });
  }
});

/**
 * GET /profile/:address
 * Fetch the latest stored analysis result for a wallet from MongoDB.
 * Returns 404 if the wallet has never been analyzed.
 */
app.get("/profile/:address", async (req, res) => {
  const { address } = req.params;

  if (!ETH_ADDRESS_RE.test(address)) {
    return res.status(400).json({ error: "Invalid Ethereum address" });
  }

  try {
    const doc = await getLatestResult(address);
    if (!doc) {
      return res.status(404).json({
        error: `No analysis found for ${address}. POST /analyze to run one.`,
        note: "If MongoDB is unavailable, historical profiles are not accessible.",
      });
    }

    if (doc.analyzed_at instanceof Date) {
      doc.analyzed_at = doc.analyzed_at.toISOString();
    }

    return res.json(doc);
  } catch (err) {
    console.error("[api] Error fetching profile:", err);
    return res.status(500).json({ error: "Failed to fetch profile" });
  }
});

/**
 * GET /health
 */
app.get("/health", async (_req, res) => {
  // Check MongoDB by attempting a lightweight ping
  let mongoStatus = "unavailable";
  try {
    const { getDb } = await import("./db.js");
    const db = await getDb();
    if (db) {
      await db.command({ ping: 1 });
      mongoStatus = "available";
    }
  } catch {
    mongoStatus = "unavailable";
  }

  res.json({
    status: "ok",
    mongodb: mongoStatus,
    uptime: Math.floor(process.uptime()),
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.info(`[api] Proof of Dev Worker API listening on http://0.0.0.0:${PORT}`);
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────

async function shutdown() {
  console.info("[api] Shutting down...");
  closePush();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT",  shutdown);
