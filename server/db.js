/**
 * Database layer — MongoDB via the official Node.js driver.
 *
 * Graceful degradation: if MongoDB is unavailable, all DB operations
 * are silently skipped and return null/false. The analysis pipeline
 * and queue transport continue working normally without persistence.
 *
 * Collections:
 *   wallet_profiles   — one doc per (wallet_address, chain_id)
 *   analysis_results  — one doc per (wallet_address, chain_id)
 *   job_results       — TTL 1h, stores queue job outcomes
 */

import { MongoClient } from "mongodb";
import { MONGO_URI, MONGO_DB } from "./config.js";

/** @type {MongoClient|null} */
let _client = null;

/** @type {boolean} */
let _mongoAvailable = true;

/**
 * Try to get a connected MongoClient.
 * Returns null if MongoDB is unreachable — never throws.
 * @returns {Promise<MongoClient|null>}
 */
async function getClient() {
  if (!_mongoAvailable) return null;
  if (_client) return _client;

  try {
    const client = new MongoClient(MONGO_URI, {
      serverSelectionTimeoutMS: 3000, // fail fast instead of hanging 30s
      connectTimeoutMS: 3000,
    });
    await client.connect();
    _client = client;

    // If MongoDB goes down after connecting, reset so next call retries
    client.on("close", () => {
      _client = null;
      _mongoAvailable = true; // allow retry on next request
      console.warn("[db] MongoDB connection closed — will retry on next operation");
    });

    return _client;
  } catch (err) {
    _mongoAvailable = false;
    _client = null;
    console.warn(`[db] MongoDB unavailable (${err.message}) — persistence disabled`);
    // Re-enable retry after 30s so it recovers if MongoDB starts later
    setTimeout(() => { _mongoAvailable = true; }, 30_000);
    return null;
  }
}

/**
 * Returns the database instance, or null if MongoDB is unavailable.
 * @returns {Promise<import('mongodb').Db|null>}
 */
async function getDb() {
  const client = await getClient();
  return client ? client.db(MONGO_DB) : null;
}

/**
 * Create indexes. Safe to call multiple times (idempotent).
 * Silently skips if MongoDB is unavailable.
 */
export async function ensureIndexes() {
  const db = await getDb();
  if (!db) {
    console.warn("[db] Skipping index creation — MongoDB unavailable");
    return;
  }

  try {
    await db.collection("wallet_profiles").createIndex(
      { wallet_address: 1, chain_id: 1 },
      { unique: true, name: "uq_wallet_chain" },
    );
    await db.collection("analysis_results").createIndex(
      { wallet_address: 1, chain_id: 1 },
      { unique: true, name: "uq_result_wallet_chain" },
    );
    await db.collection("analysis_results").createIndex(
      { score: -1 },
      { name: "idx_score_desc" },
    );
    await db.collection("job_results").createIndex(
      { created_at: 1 },
      { expireAfterSeconds: 3600, name: "ttl_job_results" },
    );
  } catch (err) {
    console.warn(`[db] Index creation failed: ${err.message}`);
  }
}

/**
 * Upsert wallet profile and analysis result.
 * Silently skips if MongoDB is unavailable.
 * @returns {Promise<boolean>} true if saved, false if skipped
 */
export async function saveAnalysisResult({
  walletAddress, chainId, score, tier,
  metricsBreakdown, contracts, ensName,
}) {
  const db = await getDb();
  if (!db) {
    console.warn(`[db] Skipping saveAnalysisResult for ${walletAddress} — MongoDB unavailable`);
    return false;
  }

  try {
    const now     = new Date();
    const address = walletAddress.toLowerCase();
    const filter  = { wallet_address: address, chain_id: chainId };

    await db.collection("wallet_profiles").updateOne(
      filter,
      {
        $set:         { last_analyzed_at: now },
        $setOnInsert: { first_seen_at: now },
      },
      { upsert: true },
    );

    await db.collection("analysis_results").updateOne(
      filter,
      {
        $set: {
          score,
          tier,
          metrics_breakdown:       metricsBreakdown,
          contract_count:          contracts.length,
          verified_contract_count: contracts.filter((c) => c.is_verified).length,
          ens_name:                ensName,
          analyzed_at:             now,
        },
        $setOnInsert: { unique_interactors: null },
      },
      { upsert: true },
    );

    return true;
  } catch (err) {
    console.warn(`[db] saveAnalysisResult failed: ${err.message}`);
    return false;
  }
}

/**
 * Update unique_interactors after enrichment.
 * Silently skips if MongoDB is unavailable.
 */
export async function updateUniqueInteractors(walletAddress, chainId, count) {
  const db = await getDb();
  if (!db) return;

  try {
    await db.collection("analysis_results").updateOne(
      { wallet_address: walletAddress.toLowerCase(), chain_id: chainId },
      { $set: { unique_interactors: count } },
    );
  } catch (err) {
    console.warn(`[db] updateUniqueInteractors failed: ${err.message}`);
  }
}

/**
 * Fetch the latest analysis result for a wallet.
 * Returns null if not found or MongoDB is unavailable.
 * @param {string} walletAddress
 * @returns {Promise<object|null>}
 */
export async function getLatestResult(walletAddress) {
  const db = await getDb();
  if (!db) return null;

  try {
    const doc = await db
      .collection("analysis_results")
      .findOne(
        { wallet_address: walletAddress.toLowerCase() },
        { sort: { analyzed_at: -1 } },
      );

    if (!doc) return null;
    const { _id, ...rest } = doc;
    return rest;
  } catch (err) {
    console.warn(`[db] getLatestResult failed: ${err.message}`);
    return null;
  }
}

/**
 * Persist a job result for GET /result/:jobId polling.
 * Silently skips if MongoDB is unavailable.
 * @returns {Promise<boolean>}
 */
export async function saveJobResult(jobId, { status, result = null, error = null }) {
  const db = await getDb();
  if (!db) {
    console.warn(`[db] Skipping saveJobResult for ${jobId} — MongoDB unavailable`);
    return false;
  }

  try {
    await db.collection("job_results").updateOne(
      { job_id: jobId },
      { $set: { job_id: jobId, status, result, error, created_at: new Date() } },
      { upsert: true },
    );
    return true;
  } catch (err) {
    console.warn(`[db] saveJobResult failed: ${err.message}`);
    return false;
  }
}

/**
 * Fetch a job result by ID.
 * Returns null if not found or MongoDB is unavailable.
 * @param {string} jobId
 * @returns {Promise<object|null>}
 */
export async function getJobResult(jobId) {
  const db = await getDb();
  if (!db) return null;

  try {
    const doc = await db.collection("job_results").findOne({ job_id: jobId });
    if (!doc) return null;
    const { _id, job_id, created_at, ...rest } = doc;
    return rest;
  } catch (err) {
    console.warn(`[db] getJobResult failed: ${err.message}`);
    return null;
  }
}
