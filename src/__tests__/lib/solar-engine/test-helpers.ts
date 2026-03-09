/**
 * Solar Engine Test Helpers
 *
 * Shared assertion helpers and fixtures for engine tests.
 * [P2 clarification] Single global tolerance helper for consistency.
 */

/**
 * Assert that `actual` is within `tolerance` of `expected`.
 * Provides clear failure messages with both values and tolerance.
 */
export function expectClose(
  actual: number,
  expected: number,
  tolerance: number,
  label?: string
): void {
  const diff = Math.abs(actual - expected);
  const prefix = label ? `[${label}] ` : "";
  if (diff > tolerance) {
    throw new Error(
      `${prefix}Expected ${expected} ± ${tolerance}, got ${actual} (diff: ${diff.toFixed(6)})`
    );
  }
}

/**
 * Assert that `actual` is within a percentage of `expected`.
 * E.g., `expectClosePercent(100, 105, 10)` passes (within 10%).
 */
export function expectClosePercent(
  actual: number,
  expected: number,
  tolerancePct: number,
  label?: string
): void {
  const tolerance = Math.abs(expected * tolerancePct / 100);
  expectClose(actual, expected, tolerance, label);
}

/**
 * Assert that `actual` is within the given range [min, max] inclusive.
 */
export function expectInRange(
  actual: number,
  min: number,
  max: number,
  label?: string
): void {
  const prefix = label ? `[${label}] ` : "";
  if (actual < min || actual > max) {
    throw new Error(
      `${prefix}Expected value in [${min}, ${max}], got ${actual}`
    );
  }
}
