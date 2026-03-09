/**
 * Runner — Full Pipeline Integration Tests
 *
 * Tests the orchestrator that ties Model A → Model B → Dispatch together.
 * Validates schemaVersion [P2-F4], nullable modelB [P1-F3], and full pipeline output.
 */

import { runAnalysis, SCHEMA_VERSION } from "@/lib/solar/engine/runner";
import { expectInRange, expectClose } from "./test-helpers";
import type { WorkerProgressMessage } from "@/lib/solar/types";
import type { RunnerInput } from "@/lib/solar/engine/engine-types";
import singlePanelFixture from "./fixtures/fixture-single-panel.json";
import microFixture from "./fixtures/fixture-micro-arch.json";

const noopProgress = (_msg: WorkerProgressMessage) => {};

describe("Runner — Full Pipeline (String Architecture)", () => {
  it("produces valid result with schemaVersion [P2-F4]", () => {
    const input = singlePanelFixture as unknown as RunnerInput;
    const result = runAnalysis(input, noopProgress);

    expect(result.schemaVersion).toBe(SCHEMA_VERSION);
    expect(result.schemaVersion).toBe(1);
  });

  it("produces non-zero annual output for single panel", () => {
    const input = singlePanelFixture as unknown as RunnerInput;
    const result = runAnalysis(input, noopProgress);

    expect(result.modelA.annualKwh).toBeGreaterThan(0);
    expect(result.panelCount).toBe(1);
    expect(result.systemSizeKw).toBeCloseTo(0.44, 1);
  });

  it("has 12 monthly values in modelA", () => {
    const input = singlePanelFixture as unknown as RunnerInput;
    const result = runAnalysis(input, noopProgress);

    expect(result.modelA.monthlyKwh).toHaveLength(12);
    const monthlySum = result.modelA.monthlyKwh.reduce((a, b) => a + b, 0);
    expectClose(monthlySum, result.modelA.annualKwh, 0.1, "monthly sum ≈ annual");
  });

  it("modelB is NOT null for string architecture [P1-F3]", () => {
    const input = singlePanelFixture as unknown as RunnerInput;
    const result = runAnalysis(input, noopProgress);

    expect(result.modelB).not.toBeNull();
    expect(result.modelB!.annualKwh).toBeGreaterThan(0);
    expect(result.modelB!.monthlyKwh).toHaveLength(12);
    expect(typeof result.modelB!.mismatchLossPct).toBe("number");
  });

  it("specificYield is reasonable", () => {
    const input = singlePanelFixture as unknown as RunnerInput;
    const result = runAnalysis(input, noopProgress);

    // Specific yield (kWh/kWp) should be in a reasonable range
    // for synthetic weather: ~800-1400 kWh/kWp
    expectInRange(result.specificYield, 500, 1800, "specific yield");
  });

  it("systemTsrf reflects panel TSRF", () => {
    const input = singlePanelFixture as unknown as RunnerInput;
    const result = runAnalysis(input, noopProgress);

    expectClose(result.systemTsrf, 0.85, 0.01, "system TSRF");
  });

  it("reports progress from 0% to 100%", () => {
    const input = singlePanelFixture as unknown as RunnerInput;
    const progressReports: number[] = [];

    runAnalysis(input, (msg) => progressReports.push(msg.payload.percent));

    expect(progressReports.length).toBeGreaterThan(0);
    expect(progressReports[progressReports.length - 1]).toBe(100);
    // Should be monotonically non-decreasing
    for (let i = 1; i < progressReports.length; i++) {
      expect(progressReports[i]).toBeGreaterThanOrEqual(progressReports[i - 1]);
    }
  });
});

describe("Runner — Micro Architecture [P1-F3]", () => {
  it("modelB is null for micro architecture", () => {
    const input = microFixture as unknown as RunnerInput;
    const result = runAnalysis(input, noopProgress);

    expect(result.modelB).toBeNull();
  });

  it("schemaVersion is 1", () => {
    const input = microFixture as unknown as RunnerInput;
    const result = runAnalysis(input, noopProgress);

    expect(result.schemaVersion).toBe(1);
  });

  it("produces output for 4 micro-inverter panels", () => {
    const input = microFixture as unknown as RunnerInput;
    const result = runAnalysis(input, noopProgress);

    expect(result.panelCount).toBe(4);
    expect(result.systemSizeKw).toBeCloseTo(1.76, 1); // 4 × 440W
    expect(result.modelA.annualKwh).toBeGreaterThan(0);
  });

  it("micro architecture has 0% mismatch (no modelB)", () => {
    const input = microFixture as unknown as RunnerInput;
    const result = runAnalysis(input, noopProgress);

    // modelB should be null for micro — consumers use optional chaining
    expect(result.modelB?.mismatchLossPct).toBeUndefined();
  });
});

describe("Runner — Empty System", () => {
  it("returns empty result for zero panels", () => {
    const input: RunnerInput = {
      ...(singlePanelFixture as unknown as RunnerInput),
      panels: [],
    };
    const result = runAnalysis(input, noopProgress);

    expect(result.schemaVersion).toBe(1);
    expect(result.panelCount).toBe(0);
    expect(result.modelA.annualKwh).toBe(0);
    expect(result.modelB).toBeNull();
    expect(result.systemSizeKw).toBe(0);
    expect(result.specificYield).toBe(0);
  });
});
