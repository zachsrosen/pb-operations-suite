import { render, screen } from "@testing-library/react";
import FleetTable from "@/components/powerhub/FleetTable";

jest.mock("@/components/powerhub/SiteDetail", () => ({
  __esModule: true,
  default: () => <div data-testid="site-detail" />,
}));

function makeSite(overrides: Record<string, unknown> = {}) {
  return {
    siteId: "11111111-2222-3333-4444-555555555555",
    siteName: "Smith Residence",
    address: "123 Main St",
    city: "Denver",
    state: "CO",
    status: "ACTIVE",
    linkMethod: "ADDRESS",
    linkConfidence: "HIGH",
    dealId: "9876543210",
    customerName: "Jane Smith",
    dealName: "Smith, Jane - PROJ-1234",
    totalGateways: 1,
    totalBatteries: 2,
    totalInverters: 1,
    telemetrySnapshot: null,
    alerts: [],
    ...overrides,
  };
}

describe("FleetTable RMA alert chip", () => {
  it("shows an RMA-labeled chip when a site has RMA alerts", () => {
    render(
      <FleetTable
        sites={[
          makeSite({
            alerts: [
              { id: "a1", severity: "RMA", alertName: "Powerwall RMA" },
              { id: "a2", severity: "RMA", alertName: "Gateway RMA" },
            ],
          }),
        ]}
      />
    );

    // Inline alert-name chips: each RMA alert renders its name with an RMA prefix
    expect(screen.getByText("RMA Powerwall RMA")).toBeInTheDocument();
    expect(screen.getByText("RMA Gateway RMA")).toBeInTheDocument();
  });

  it("shows no RMA chip when there are none", () => {
    render(
      <FleetTable
        sites={[
          makeSite({
            alerts: [{ id: "a1", severity: "CRITICAL", alertName: "X" }],
          }),
        ]}
      />
    );

    expect(screen.queryByText(/RMA/)).not.toBeInTheDocument();
  });
});
