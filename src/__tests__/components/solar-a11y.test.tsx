/**
 * Solar Surveyor — Phase 5 A11y & Responsive Attribute Tests
 *
 * Verifies ARIA attributes, roles, semantic markup, and responsive
 * class patterns across all solar components.
 *
 * These are structural tests that validate attributes on rendered output
 * without requiring full integration (no API mocking needed).
 */

import { render, screen } from "@testing-library/react";

// ── Shared mocks ────────────────────────────────────────────────

// Mock useActivityTracking
jest.mock("@/hooks/useActivityTracking", () => ({
  useActivityTracking: () => ({
    trackFeature: jest.fn(),
  }),
}));

// Mock useSimulation
jest.mock("@/lib/solar/hooks/useSimulation", () => ({
  useSimulation: () => ({
    state: { status: "idle", progress: { percent: 0, stage: "" }, result: null, error: null },
    run: jest.fn(),
    cancel: jest.fn(),
  }),
}));

// ── WizardStepper Tests ─────────────────────────────────────────

describe("WizardStepper a11y", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const WizardStepper = require("@/components/solar/wizard/WizardStepper").default;

  it("renders as nav with aria-label", () => {
    const { container } = render(
      <WizardStepper steps={["Basics", "Equipment", "Shade", "Review"]} currentStep={1} />
    );
    const nav = container.querySelector("nav");
    expect(nav).toBeTruthy();
    expect(nav?.getAttribute("aria-label")).toContain("wizard");
  });

  it("uses ordered list for steps", () => {
    const { container } = render(
      <WizardStepper steps={["A", "B", "C"]} currentStep={0} />
    );
    expect(container.querySelector("ol")).toBeTruthy();
    expect(container.querySelectorAll("li")).toHaveLength(3);
  });

  it("marks current step with aria-current", () => {
    render(
      <WizardStepper steps={["A", "B", "C"]} currentStep={1} />
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons[0].getAttribute("aria-current")).toBeNull();
    expect(buttons[1].getAttribute("aria-current")).toBe("step");
    expect(buttons[2].getAttribute("aria-current")).toBeNull();
  });

  it("includes step labels in aria-label", () => {
    render(
      <WizardStepper steps={["Basics", "Equipment"]} currentStep={0} />
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons[0].getAttribute("aria-label")).toContain("Basics");
    expect(buttons[0].getAttribute("aria-label")).toContain("current");
  });

  it("marks completed steps in aria-label", () => {
    render(
      <WizardStepper steps={["A", "B", "C"]} currentStep={2} />
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons[0].getAttribute("aria-label")).toContain("completed");
    expect(buttons[1].getAttribute("aria-label")).toContain("completed");
    expect(buttons[2].getAttribute("aria-label")).toContain("current");
  });

  it("hides decorative connector lines from assistive tech", () => {
    const { container } = render(
      <WizardStepper steps={["A", "B", "C"]} currentStep={0} />
    );
    const connectors = container.querySelectorAll("[aria-hidden='true']");
    expect(connectors.length).toBeGreaterThanOrEqual(2); // 2 connectors for 3 steps
  });
});

// ── RunControls Tests ───────────────────────────────────────────

describe("RunControls a11y", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const RunControls = require("@/components/solar/analysis/RunControls").default;

  const baseProps = {
    status: "idle" as const,
    progress: { percent: 0, stage: "" },
    onRun: jest.fn(),
    onCancel: jest.fn(),
    isQuickEstimate: false,
    error: null,
  };

  it("renders analysis controls region", () => {
    const { container } = render(<RunControls {...baseProps} />);
    const region = container.querySelector("[role='region']");
    expect(region).toBeTruthy();
    expect(region?.getAttribute("aria-label")).toContain("Analysis controls");
  });

  it("shows progress bar with correct ARIA attributes when running", () => {
    const { container } = render(
      <RunControls {...baseProps} status="running" progress={{ percent: 42, stage: "Simulating" }} />
    );
    const progressbar = container.querySelector("[role='progressbar']");
    expect(progressbar).toBeTruthy();
    expect(progressbar?.getAttribute("aria-valuenow")).toBe("42");
    expect(progressbar?.getAttribute("aria-valuemin")).toBe("0");
    expect(progressbar?.getAttribute("aria-valuemax")).toBe("100");
  });

  it("marks error state with role=alert", () => {
    const { container } = render(
      <RunControls {...baseProps} status="error" error="Simulation failed" />
    );
    const alerts = container.querySelectorAll("[role='alert']");
    expect(alerts.length).toBeGreaterThanOrEqual(1);
  });

  it("marks complete state with role=status", () => {
    const { container } = render(
      <RunControls {...baseProps} status="complete" />
    );
    const status = container.querySelector("[role='status']");
    expect(status).toBeTruthy();
  });

  it("has focus-visible ring on Run Analysis button", () => {
    render(<RunControls {...baseProps} />);
    const btn = screen.getByText("Run Analysis");
    expect(btn.className).toContain("focus-visible:ring");
  });

  it("shows quick estimate as role=status", () => {
    const { container } = render(
      <RunControls {...baseProps} isQuickEstimate={true} />
    );
    const status = container.querySelector("[role='status']");
    expect(status).toBeTruthy();
  });
});

// ── ScenarioCompareTable Tests ─────────────────────────────────

describe("ScenarioCompareTable a11y", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ScenarioCompareTable = require("@/components/solar/scenarios/ScenarioCompareTable").default;

  const baseResult = {
    annualKwh: 11000,
    monthlyKwh: Array(12).fill(916),
    panelCount: 20,
    systemSizeKw: 8.8,
    systemTsrf: 0.82,
    specificYield: 1250,
    mismatchLossPct: 2.3,
    clippingLossPct: null,
    hasBattery: false,
    isQuickEstimate: false,
    quality: "full" as const,
    schemaVersion: 1,
  };

  it("renders table with aria-label", () => {
    const { container } = render(
      <ScenarioCompareTable
        baselineName="Baseline"
        baselineResult={baseResult}
        deltas={[]}
        hasMixedQuality={false}
      />
    );
    const table = container.querySelector("table");
    expect(table?.getAttribute("role")).toBe("table");
    expect(table?.getAttribute("aria-label")).toContain("comparison");
  });

  it("uses scope=col on table headers", () => {
    const { container } = render(
      <ScenarioCompareTable
        baselineName="Baseline"
        baselineResult={baseResult}
        deltas={[]}
        hasMixedQuality={false}
      />
    );
    const headers = container.querySelectorAll("th[scope='col']");
    expect(headers).toHaveLength(7);
  });

  it("marks mixed quality warning with role=alert", () => {
    const { container } = render(
      <ScenarioCompareTable
        baselineName="Baseline"
        baselineResult={baseResult}
        deltas={[]}
        hasMixedQuality={true}
      />
    );
    const alert = container.querySelector("[role='alert']");
    expect(alert).toBeTruthy();
  });

  it("quality badges have aria-labels", () => {
    render(
      <ScenarioCompareTable
        baselineName="Baseline"
        baselineResult={baseResult}
        deltas={[]}
        hasMixedQuality={false}
      />
    );
    const badge = screen.getByLabelText("Full quality");
    expect(badge).toBeTruthy();
  });

  it("sets min-width for horizontal scroll", () => {
    const { container } = render(
      <ScenarioCompareTable
        baselineName="Baseline"
        baselineResult={baseResult}
        deltas={[]}
        hasMixedQuality={false}
      />
    );
    const table = container.querySelector("table");
    expect(table?.className).toContain("min-w-");
  });
});

// ── ProductionSummary Tests ────────────────────────────────────

describe("ProductionSummary a11y", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ProductionSummary = require("@/components/solar/analysis/ProductionSummary").default;

  const result = {
    annualKwh: 11000,
    monthlyKwh: [600, 650, 800, 950, 1100, 1200, 1250, 1150, 1000, 850, 700, 650],
    panelCount: 20,
    systemSizeKw: 8.8,
    systemTsrf: 0.82,
    specificYield: 1250,
    mismatchLossPct: 2.3,
    clippingLossPct: null,
    energyBalance: null,
    hasBattery: false,
    isQuickEstimate: false,
    schemaVersion: 1,
    modelBAnnualKwh: null,
    curtailedKwh: null,
  };

  it("renders as region with aria-label", () => {
    const { container } = render(<ProductionSummary result={result} />);
    const region = container.querySelector("[role='region']");
    expect(region).toBeTruthy();
    expect(region?.getAttribute("aria-label")).toContain("Production");
  });

  it("bar chart has accessible role and label", () => {
    const { container } = render(<ProductionSummary result={result} />);
    const chart = container.querySelector("[role='img']");
    expect(chart).toBeTruthy();
    expect(chart?.getAttribute("aria-label")).toContain("bar chart");
  });

  it("each bar has aria-label with month and value", () => {
    const { container } = render(<ProductionSummary result={result} />);
    const bars = container.querySelectorAll("[aria-label*='kWh']");
    expect(bars).toHaveLength(12);
  });

  it("uses responsive padding classes", () => {
    const { container } = render(<ProductionSummary result={result} />);
    const card = container.firstElementChild;
    expect(card?.className).toContain("p-3");
    expect(card?.className).toContain("sm:p-5");
  });
});

// ── Responsive Class Patterns ──────────────────────────────────

describe("Responsive class patterns", () => {
  it("ScenarioManager uses responsive grid for override editor", () => {
    // We test by checking the module source includes the right patterns
    // This avoids needing to mock the entire scenario pipeline
    const fs = require("fs");
    const source = fs.readFileSync(
      require.resolve("@/components/solar/scenarios/ScenarioManager"),
      "utf8"
    );
    expect(source).toContain("grid-cols-1 sm:grid-cols-2");
    expect(source).toContain("flex-col sm:flex-row");
  });

  it("AnalysisWorkspace uses responsive spacing", () => {
    const fs = require("fs");
    const source = fs.readFileSync(
      require.resolve("@/components/solar/analysis/AnalysisWorkspace"),
      "utf8"
    );
    expect(source).toContain("space-y-4 sm:space-y-6");
    expect(source).toContain("role=\"main\"");
    expect(source).toContain("aria-live=\"polite\"");
  });

  it("ProjectBrowser uses responsive header stacking", () => {
    const fs = require("fs");
    const source = fs.readFileSync(
      require.resolve("@/components/solar/ProjectBrowser"),
      "utf8"
    );
    expect(source).toContain("flex-col sm:flex-row");
    expect(source).toContain("role=\"list\"");
    expect(source).toContain("role=\"listitem\"");
  });

  it("SolarSurveyorShell uses responsive toggle text", () => {
    const fs = require("fs");
    const source = fs.readFileSync(
      require.resolve("@/components/solar/SolarSurveyorShell"),
      "utf8"
    );
    expect(source).toContain("hidden sm:inline");
    expect(source).toContain("focus-visible:ring-2");
  });

  it("WizardStepper uses overflow-x-auto for mobile scroll", () => {
    const fs = require("fs");
    const source = fs.readFileSync(
      require.resolve("@/components/solar/wizard/WizardStepper"),
      "utf8"
    );
    expect(source).toContain("overflow-x-auto");
    expect(source).toContain("aria-current");
  });
});
