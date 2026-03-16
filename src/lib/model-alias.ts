/**
 * Model Alias Normalizer
 *
 * Strips non-meaningful suffixes from equipment model strings so that
 * equivalent products converge during Zoho search and (future) canonical
 * key generation.
 *
 * Runs BEFORE canonicalToken(). Does NOT replace canonicalToken — that
 * stays as the final blunt normalizer for DB keys. This layer handles
 * product-identity equivalences that canonicalToken can't express
 * (e.g., "SE7600H-US000BNU4" and "SE7600H" are the same inverter).
 *
 * Guiding principle: only strip suffixes that are demonstrably
 * non-meaningful for product identity. When in doubt, keep the suffix.
 *
 * Used by: Zoho search term generation (bom-snapshot, bom-so-create).
 * Future: canonical key generation (requires DB backfill plan).
 */

// ---------------------------------------------------------------------------
// SolarEdge inverter extended ordering codes
// SE7600H-US → SE7600H, SE10000H-US000BNU4 → SE10000H, SE11400H-USNNR2 → SE11400H
// The base model (SE####H) is the product; everything after is config/market.
// ---------------------------------------------------------------------------
const SE_INVERTER_EXT = /^(SE\d{3,5}H)[-].+$/i;

// ---------------------------------------------------------------------------
// SolarEdge optimizer connector/mounting suffixes
// P505-5R-M4M → P505, S440-1GM4MRX → S440, S500B-1GM4MRX → S500B
// The base code (S/P + 3 digits + optional B for bifacial) is the product.
// ---------------------------------------------------------------------------
const SE_OPTIMIZER_EXT = /^([SP]\d{3}B?)[-]\d.+$/i;

// ---------------------------------------------------------------------------
// Trailing market/region code
// Strips -US, -EU, -AU, -NA (and any further dash-segments after) from the
// end of a model string. Handles: IQ8A-72-M-US, SB7.7-1SP-US-41, AGT-R1V1-US
// ---------------------------------------------------------------------------
const TRAILING_MARKET = /-(US|EU|AU|NA|JP|KR|IN)(?:-[\w]+)*$/i;

/**
 * Normalize a model string by stripping non-meaningful suffixes.
 *
 * Returns the original string (trimmed) if no alias rule matches.
 * Returns empty string for falsy input.
 */
export function normalizeModelAlias(model: string | null | undefined): string {
  if (!model) return "";
  const m = model.trim();
  if (!m) return "";

  // SolarEdge inverter extended ordering codes
  const seInv = m.match(SE_INVERTER_EXT);
  if (seInv) return seInv[1];

  // SolarEdge optimizer connector suffixes
  const seOpt = m.match(SE_OPTIMIZER_EXT);
  if (seOpt) return seOpt[1];

  // Trailing market suffix — only accept if remainder is still ≥3 chars
  const stripped = m.replace(TRAILING_MARKET, "");
  if (stripped !== m && stripped.length >= 3) return stripped;

  return m;
}
