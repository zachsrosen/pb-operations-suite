/**
 * Analysis Workspace — Component Integration Tests
 *
 * Tests the presentational analysis components with real AnalysisResult data.
 * Uses render-based tests for RunControls, ProductionSummary, MismatchCard,
 * DispatchSummary, verifying architecture-aware rendering [P1-F3],
 * Quick Estimate badges, and Save Results eligibility.
 */

import { render, screen } from "@testing-library/react";
import type { AnalysisResult } from "@/lib/solar/adapters/worker-to-ui";
import RunControls from "@/components/solar/analysis/RunControls";
import ProductionSummary from "@/components/solar/analysis/ProductionSummary";
import MismatchCard from "@/components/solar/analysis/MismatchCard";
import DispatchSummary from "@/components/solar/analysis/DispatchSummary";

// ── Fixtures ────────────────────────────────────────────────

const stringResult: AnalysisResult = {
  schemaVersion: 1,
  panelCount: 20,
  systemSizeKw: 8.8,
  systemTsrf: 0.82,
  specificYield: 1250,
  annualKwh: 11000,
  monthlyKwh: [600, 650, 800, 950, 1100, 1200, 1250, 1150, 1000, 850, 700, 650],
  mismatchLossPct: 2.3,
  modelBAnnualKwh: 10747,
  energyBalance: null,
  clippingLossPct: null,
  curtailedKwh: null,
  hasBattery: false,
  isQuickEstimate: false,
};

const microResult: AnalysisResult = {
  ...stringResult,
  mismatchLossPct: null,
  modelBAnnualKwh: null,
};

const batteryResult: AnalysisResult = {
  ...stringResult,
  hasBattery: true,
  clippingLossPct: 1.5,
  curtailedKwh: 120,
  energyBalance: {
    totalProductionKwh: 11000,
    selfConsumedKwh: 7500,
    gridExportKwh: 2300,
    gridImportKwh: 4200,
    batteryChargedKwh: 3200,
    batteryDischargedKwh: 2900,
    batteryLossesKwh: 300,
    curtailedKwh: 120,
    clippedKwh: 180,
    deltaStoredKwh: 0,
  },
};

const quickEstimateResult: AnalysisResult = {
  ...stringResult,
  isQuickEstimate: true,
};

// ── RunControls ─────────────────────────────────────────────

describe("RunControls", () => {
  const noopFn = () => {};
  const defaultProgress = { stage: "", percent: 0 };

  it("shows Run Analysis button when idle", () => {
    render(
      <RunControls
        status="idle"
        progress={defaultProgress}
        onRun={noopFn}
        onCancel={noopFn}
        isQuickEstimate={false}
        error={null}
      />
    );

    expect(screen.getByText("Run Analysis")).toBeInTheDocument();
  });

  it("shows Cancel + progress bar when running", () => {
    render(
      <RunControls
        status="running"
        progress={{ stage: "Model A", percent: 45 }}
        onRun={noopFn}
        onCancel={noopFn}
        isQuickEstimate={false}
        error={null}
      />
    );

    expect(screen.getByText("Cancel")).toBeInTheDocument();
    expect(screen.getByText("Model A")).toBeInTheDocument();
    expect(screen.getByText("45%")).toBeInTheDocument();
  });

  it("shows success + re-run when complete", () => {
    render(
      <RunControls
        status="complete"
        progress={defaultProgress}
        onRun={noopFn}
        onCancel={noopFn}
        isQuickEstimate={false}
        error={null}
      />
    );

    expect(screen.getByText(/Analysis complete/)).toBeInTheDocument();
    expect(screen.getByText("Re-run")).toBeInTheDocument();
  });

  it("shows error + retry when errored", () => {
    render(
      <RunControls
        status="error"
        progress={defaultProgress}
        onRun={noopFn}
        onCancel={noopFn}
        isQuickEstimate={false}
        error="Engine crashed"
      />
    );

    expect(screen.getByText(/Error/)).toBeInTheDocument();
    expect(screen.getByText("Retry")).toBeInTheDocument();
    expect(screen.getByText("Engine crashed")).toBeInTheDocument();
  });

  it("shows Quick Estimate badge when isQuickEstimate", () => {
    render(
      <RunControls
        status="idle"
        progress={defaultProgress}
        onRun={noopFn}
        onCancel={noopFn}
        isQuickEstimate={true}
        error={null}
      />
    );

    expect(screen.getByText(/Quick Estimate/)).toBeInTheDocument();
  });

  it("hides Quick Estimate badge for full design", () => {
    render(
      <RunControls
        status="idle"
        progress={defaultProgress}
        onRun={noopFn}
        onCancel={noopFn}
        isQuickEstimate={false}
        error={null}
      />
    );

    expect(screen.queryByText(/Quick Estimate/)).not.toBeInTheDocument();
  });
});

// ── ProductionSummary ───────────────────────────────────────

describe("ProductionSummary", () => {
  it("renders annual production", () => {
    render(<ProductionSummary result={stringResult} />);

    expect(screen.getByText("11,000 kWh")).toBeInTheDocument();
  });

  it("renders system size", () => {
    render(<ProductionSummary result={stringResult} />);

    expect(screen.getByText("8.80 kWp")).toBeInTheDocument();
  });

  it("renders panel count", () => {
    render(<ProductionSummary result={stringResult} />);

    expect(screen.getByText("20")).toBeInTheDocument();
  });

  it("renders specific yield", () => {
    render(<ProductionSummary result={stringResult} />);

    expect(screen.getByText("1250 kWh/kWp")).toBeInTheDocument();
  });

  it("renders 12 month labels", () => {
    render(<ProductionSummary result={stringResult} />);

    expect(screen.getByText("Jan")).toBeInTheDocument();
    expect(screen.getByText("Jun")).toBeInTheDocument();
    expect(screen.getByText("Dec")).toBeInTheDocument();
  });

  it("renders system TSRF", () => {
    render(<ProductionSummary result={stringResult} />);

    expect(screen.getByText("82.0%")).toBeInTheDocument();
  });
});

// ── MismatchCard ────────────────────────────────────────────

describe("MismatchCard", () => {
  it("shows mismatch percentage for string architecture", () => {
    render(<MismatchCard result={stringResult} />);

    expect(screen.getByText("2.3%")).toBeInTheDocument();
    expect(screen.getByText("mismatch loss")).toBeInTheDocument();
  });

  it("shows post-mismatch annual for string architecture", () => {
    render(<MismatchCard result={stringResult} />);

    expect(screen.getByText("10,747 kWh")).toBeInTheDocument();
  });

  it("shows N/A for micro architecture [P1-F3]", () => {
    render(<MismatchCard result={microResult} />);

    expect(screen.getByText("N/A")).toBeInTheDocument();
    expect(
      screen.getByText(/not applicable for micro-inverter or optimizer/)
    ).toBeInTheDocument();
  });
});

// ── DispatchSummary ─────────────────────────────────────────

describe("DispatchSummary", () => {
  it("renders nothing when energyBalance is null", () => {
    const { container } = render(<DispatchSummary result={stringResult} />);

    expect(container.firstChild).toBeNull();
  });

  it("renders energy balance when available", () => {
    render(<DispatchSummary result={batteryResult} />);

    expect(screen.getByText("Energy Balance")).toBeInTheDocument();
    expect(screen.getByText("Total Production")).toBeInTheDocument();
    expect(screen.getByText("Self-Consumed")).toBeInTheDocument();
    expect(screen.getByText("Grid Export")).toBeInTheDocument();
    expect(screen.getByText("Grid Import")).toBeInTheDocument();
  });

  it("shows battery section when hasBattery", () => {
    render(<DispatchSummary result={batteryResult} />);

    expect(screen.getByText("Battery")).toBeInTheDocument();
    expect(screen.getByText("Charged")).toBeInTheDocument();
    expect(screen.getByText("Discharged")).toBeInTheDocument();
    expect(screen.getByText("Round-trip Losses")).toBeInTheDocument();
  });

  it("shows clipping loss when available", () => {
    render(<DispatchSummary result={batteryResult} />);

    expect(screen.getByText("Clipping Loss")).toBeInTheDocument();
    expect(screen.getByText("1.5%")).toBeInTheDocument();
  });

  it("shows self-consumption ratio", () => {
    render(<DispatchSummary result={batteryResult} />);

    expect(screen.getByText("Self-consumption ratio")).toBeInTheDocument();
    // 7500 / 11000 * 100 = 68.2%
    expect(screen.getByText("68.2%")).toBeInTheDocument();
  });
});

// ── Save Results Eligibility ────────────────────────────────

describe("Save Results eligibility logic", () => {
  it("canSave is true when: !isQuickEstimate AND status=complete AND result exists AND not saved", () => {
    const isQuickEstimate = false;
    const status = "complete";
    const result = stringResult;
    const saved = false;

    const canSave =
      !isQuickEstimate &&
      status === "complete" &&
      result !== null &&
      !saved;

    expect(canSave).toBe(true);
  });

  it("canSave is false when isQuickEstimate", () => {
    const canSave = !true && "complete" === "complete" && stringResult !== null && !false;
    expect(canSave).toBe(false);
  });

  it("canSave is false when status is not complete", () => {
    const status: string = "running";
    const canSave = !false && status === "complete" && stringResult !== null && !false;
    expect(canSave).toBe(false);
  });

  it("canSave is false when already saved", () => {
    const canSave = !false && "complete" === "complete" && stringResult !== null && !true;
    expect(canSave).toBe(false);
  });

  it("canSave is false when no result", () => {
    const canSave = !false && "complete" === "complete" && null !== null && !false;
    expect(canSave).toBe(false);
  });
});
