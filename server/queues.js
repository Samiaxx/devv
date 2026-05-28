/**
 * Queue interface — standardized across the application.
 *
 * Hot-path  (analysis queue):  ZeroMQ push/pull over TCP.
 *   Zero broker overhead — messages go directly from API to worker process.
 *   Round-robin distribution when multiple worker processes are running.
 *
 * Non-hot-path (enrichment):   simple in-process async queue backed by a
 *   plain array + setImmediate, keeping Redis out of the picture entirely.
 *
 * Both queues expose the same interface so callers don't need to know
 * which transport is underneath.
 */

// ─── Analysis queue (ZeroMQ hot-path) ────────────────────────────────────────

export { getPush, closePush } from "./push.js";

// ─── Enrichment queue (lightweight in-process queue) ─────────────────────────

/** @type {Array<{ data: object, attempts: number, maxAttempts: number }>} */
const _enrichmentQueue = [];

/** @type {((job: object) => Promise<void>) | null} */
let _enrichmentHandler = null;

/**
 * Add a job to the enrichment queue.
 * @param {object} data
 * @param {{ attempts?: number }} [opts]
 */
export function enqueueEnrichment(data, opts = {}) {
  _enrichmentQueue.push({ data, attempts: 0, maxAttempts: opts.attempts ?? 3 });
  _drainEnrichment();
}

/**
 * Register the handler that processes enrichment jobs.
 * @param {(data: object) => Promise<void>} handler
 */
export function setEnrichmentHandler(handler) {
  _enrichmentHandler = handler;
  _drainEnrichment();
}

async function _drainEnrichment() {
  if (!_enrichmentHandler || _enrichmentQueue.length === 0) return;

  const job = _enrichmentQueue.shift();
  setImmediate(async () => {
    try {
      await _enrichmentHandler(job.data);
    } catch (err) {
      console.warn(`[enrichment-queue] Job failed (attempt ${job.attempts + 1}): ${err.message}`);
      if (job.attempts + 1 < job.maxAttempts) {
        // Re-queue with incremented attempt count after a short delay
        setTimeout(() => {
          _enrichmentQueue.push({ ...job, attempts: job.attempts + 1 });
          _drainEnrichment();
        }, 30_000);
      } else {
        console.error("[enrichment-queue] Job exhausted retries, dropping:", job.data);
      }
    }
    _drainEnrichment();
  });
}
