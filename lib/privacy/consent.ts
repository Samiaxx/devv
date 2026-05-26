/**
 * Consent configuration — represents what the user has explicitly allowed.
 *
 * All analysis must be gated through a ConsentConfig.
 * Nothing is processed unless the user has opted in.
 */

export interface ConsentConfig {
  /** User explicitly requested ENS lookup */
  includeENS: boolean;
  /** User has confirmed they want to mint an NFT (set at mint time) */
  allowMint: boolean;
}

/**
 * Creates a default ConsentConfig with everything off.
 * This is the safe starting point — nothing is included unless opted in.
 */
export function defaultConsent(): ConsentConfig {
  return {
    includeENS: false,
    allowMint: false,
  };
}

/**
 * Builds a ConsentConfig from the raw API request body.
 * Defaults to the most restrictive settings for any missing field.
 */
export function consentFromRequest(body: Record<string, unknown>): ConsentConfig {
  return {
    includeENS: body.includeENS === true,
    allowMint: false, // mint consent is never set at analysis time
  };
}
