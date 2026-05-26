/**
 * Lightweight server-side logger.
 * Structured output — no external service required.
 *
 * Logs to stdout/stderr with a consistent prefix so they're easy to
 * grep in Vercel logs or any other hosting platform.
 *
 * Usage:
 *   logger.info("Analysis complete", { address, score })
 *   logger.warn("Partial data", { source: "alchemy" })
 *   logger.error("Fetch failed", err.message)
 */

type LogLevel = "info" | "warn" | "error";

function log(level: LogLevel, message: string, detail?: unknown): void {
  const ts = new Date().toISOString();
  const prefix = `[proof-of-dev] [${level.toUpperCase()}] ${ts}`;
  const output = detail !== undefined ? `${prefix} ${message} ${JSON.stringify(detail)}` : `${prefix} ${message}`;

  if (level === "error") {
    console.error(output);
  } else if (level === "warn") {
    console.warn(output);
  } else {
    console.log(output);
  }
}

export const logger = {
  info: (message: string, detail?: unknown) => log("info", message, detail),
  warn: (message: string, detail?: unknown) => log("warn", message, detail),
  error: (message: string, detail?: unknown) => log("error", message, detail),
};
