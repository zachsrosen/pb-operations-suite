/**
 * Solar V12 Engine — Test Helpers
 *
 * Shared assertion utilities for engine tests.
 * Adapted from existing src/__tests__/lib/solar-engine/test-helpers.ts
 */

/**
 * Assert that `actual` is within `tolerance` of `expected`.
 */
export function expectClose(
  actual: number,
  expected: number,
  tolerance: number,
  label = ''
): void {
  const diff = Math.abs(actual - expected);
  if (diff > tolerance) {
    throw new Error(
      `${label ? label + ': ' : ''}Expected ${expected} ± ${tolerance}, got ${actual} (diff ${diff})`
    );
  }
}

/**
 * Assert that `actual` is within [min, max].
 */
export function expectInRange(
  actual: number,
  min: number,
  max: number,
  label = ''
): void {
  if (actual < min || actual > max) {
    throw new Error(
      `${label ? label + ': ' : ''}Expected [${min}, ${max}], got ${actual}`
    );
  }
}

/**
 * Build a minimal PanelGeometry for testing.
 */
export function makePanelGeometry(overrides: Partial<import('@/lib/solar/v12-engine/types').PanelGeometry> & { id: string }) {
  return {
    x: 0,
    y: 0,
    width: 1.02,
    height: 1.82,
    azimuth: 180,
    tilt: 30,
    shadePointIds: [],
    ...overrides,
  };
}

/**
 * Build a minimal SiteConditions for testing.
 */
export function makeSiteConditions(overrides: Partial<import('@/lib/solar/v12-engine/types').SiteConditions> = {}) {
  return {
    tempMin: -10,
    tempMax: 45,
    groundAlbedo: 0.2,
    clippingThreshold: 1.0,
    exportLimitW: 0,
    ...overrides,
  };
}
