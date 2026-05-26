/**
 * ENS data normalizer.
 * Cleans raw ENS records into a consistent ENSProfile shape.
 */

import { ENSProfile } from "@/lib/types";

/**
 * Normalizes raw ENS data from the ENS service.
 * Trims strings, converts empty strings to null, validates URL format.
 */
export function normalizeENS(raw: Partial<ENSProfile> | null | undefined): ENSProfile {
  if (!raw) {
    return { name: null, avatar: null, url: null, github: null };
  }

  const safeStr = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const trimmed = v.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  // Sanitize GitHub handle — strip leading @ or full URL if present
  let github = safeStr(raw.github);
  if (github) {
    github = github
      .replace(/^https?:\/\/(www\.)?github\.com\//i, "")
      .replace(/^@/, "")
      .trim() || null;
  }

  // Sanitize URL — ensure it has a protocol
  let url = safeStr(raw.url);
  if (url && !url.match(/^https?:\/\//i)) {
    url = `https://${url}`;
  }

  return {
    name: safeStr(raw.name),
    avatar: safeStr(raw.avatar),
    url,
    github,
  };
}
