/**
 * Tests for the EagleView→HubSpot forward-stamping toggle resolver.
 *
 * The DB-backed toggle exists because Vercel's per-environment env-var size cap
 * blocked adding EAGLEVIEW_HUBSPOT_STAMP_ENABLED. Env stays as a local-dev /
 * emergency override; the SystemConfig row is the production switch.
 */
import { resolveStampEnabled } from "@/lib/eagleview-stamp-flag";

describe("resolveStampEnabled", () => {
  it("is enabled when the env override is 'true'", () => {
    expect(resolveStampEnabled("true", null)).toBe(true);
    expect(resolveStampEnabled("true", "false")).toBe(true);
  });

  it("is enabled when the DB toggle is 'true'", () => {
    expect(resolveStampEnabled(undefined, "true")).toBe(true);
    expect(resolveStampEnabled("false", "true")).toBe(true);
  });

  it("is disabled when neither is 'true'", () => {
    expect(resolveStampEnabled(undefined, null)).toBe(false);
    expect(resolveStampEnabled("false", "false")).toBe(false);
    expect(resolveStampEnabled("", undefined)).toBe(false);
    expect(resolveStampEnabled("1", "yes")).toBe(false); // only the exact string "true" enables
  });
});
