/**
 * Solar Surveyor — Native Mode Kill Switch
 *
 * Resolves whether the Solar Surveyor page renders the native React
 * project browser or the Classic V12 iframe.
 *
 * Chain (fail-safe = Classic):
 *   1. SOLAR_NATIVE_FORCE_CLASSIC=true  → Classic, toggle disabled
 *   2. SOLAR_NATIVE_DEFAULT=true        → Native
 *   3. Missing / unset                  → Classic
 *
 * This function is the single migration point for Edge Config adoption.
 */

export type SolarMode = "native" | "classic";

export type ModeReason =
  | "env_force_classic"
  | "env_native_default"
  | "default_classic";

export function resolveNativeMode(): {
  mode: SolarMode;
  reason: ModeReason;
} {
  // Tier 1: emergency override — hard lock to Classic
  if (process.env.SOLAR_NATIVE_FORCE_CLASSIC === "true") {
    return { mode: "classic", reason: "env_force_classic" };
  }

  // Tier 2: runtime flag (env var now, Edge Config later)
  if (process.env.SOLAR_NATIVE_DEFAULT === "true") {
    return { mode: "native", reason: "env_native_default" };
  }

  // Tier 3: fail-safe default
  return { mode: "classic", reason: "default_classic" };
}
