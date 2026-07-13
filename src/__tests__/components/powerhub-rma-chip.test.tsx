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
    portalUrl: "https://powerhub.energy.tesla.com/site/11111111-2222-3333-4444-555555555555",
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

  it("renders every alert chip (no +N overflow) for sites with many alerts", () => {
    render(
      <FleetTable
        sites={[
          makeSite({
            alerts: [
              { id: "a1", severity: "CRITICAL", alertName: "System shutdown" },
              { id: "a2", severity: "PERFORMANCE", alertName: "Solar Meter Comms" },
              { id: "a3", severity: "PERFORMANCE", alertName: "Battery Comms" },
              { id: "a4", severity: "PERFORMANCE", alertName: "No Solar Production" },
            ],
          }),
        ]}
      />
    );

    expect(screen.getByText("System shutdown")).toBeInTheDocument();
    expect(screen.getByText("Solar Meter Comms")).toBeInTheDocument();
    expect(screen.getByText("Battery Comms")).toBeInTheDocument();
    expect(screen.getByText("No Solar Production")).toBeInTheDocument();
    // No truncation indicator like "+2"
    expect(screen.queryByText(/^\+\d+$/)).not.toBeInTheDocument();
  });

  it("links each alert chip to the site's Tesla monitoring portal", () => {
    render(
      <FleetTable
        sites={[
          makeSite({
            alerts: [
              { id: "a1", severity: "CRITICAL", alertName: "System shutdown" },
              { id: "a2", severity: "PERFORMANCE", alertName: "Battery Comms" },
            ],
          }),
        ]}
      />
    );

    const portal = "https://powerhub.energy.tesla.com/site/11111111-2222-3333-4444-555555555555";
    for (const name of ["System shutdown", "Battery Comms"]) {
      const link = screen.getByText(name).closest("a");
      expect(link).not.toBeNull();
      expect(link).toHaveAttribute("href", portal);
      expect(link).toHaveAttribute("target", "_blank");
    }
  });

  it("shows a Monitor link for sites with no alerts", () => {
    render(
      <FleetTable sites={[makeSite({ alerts: [] })]} />
    );

    const link = screen.getByText("Monitor").closest("a");
    expect(link).toHaveAttribute(
      "href",
      "https://powerhub.energy.tesla.com/site/11111111-2222-3333-4444-555555555555"
    );
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("shows a dash (no Monitor link) when a quiet site has no portal URL", () => {
    render(
      <FleetTable sites={[makeSite({ alerts: [], portalUrl: null })]} />
    );

    expect(screen.queryByText("Monitor")).not.toBeInTheDocument();
  });

  it("renders alerts as plain chips (no link) when the site has no portal URL", () => {
    render(
      <FleetTable
        sites={[
          makeSite({
            portalUrl: null,
            alerts: [{ id: "a1", severity: "CRITICAL", alertName: "System shutdown" }],
          }),
        ]}
      />
    );

    expect(screen.getByText("System shutdown").closest("a")).toBeNull();
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
