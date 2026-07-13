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

  it("keeps alert chips as plain status (not links)", () => {
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

    // Alerts are separate from the Monitor link — chips are not anchors.
    expect(screen.getByText("System shutdown").closest("a")).toBeNull();
    expect(screen.getByText("Battery Comms").closest("a")).toBeNull();
  });

  it("shows the same Monitor link on every site (alerted and quiet)", () => {
    const portal = "https://powerhub.energy.tesla.com/site/11111111-2222-3333-4444-555555555555";
    render(
      <FleetTable
        sites={[
          makeSite({
            siteId: "site-a",
            alerts: [{ id: "a1", severity: "CRITICAL", alertName: "System shutdown" }],
          }),
          makeSite({ siteId: "site-b", alerts: [] }),
        ]}
      />
    );

    // getAllByRole excludes the "Monitor" column header (a <th>, not a link).
    const links = screen.getAllByRole("link", { name: /Monitor/ });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute("href", portal);
      expect(link).toHaveAttribute("target", "_blank");
    }
  });

  it("shows a dash (no Monitor link) when a site has no portal URL", () => {
    render(
      <FleetTable sites={[makeSite({ alerts: [], portalUrl: null })]} />
    );

    // The "Monitor" column header still renders; only the row link is absent.
    expect(screen.queryByRole("link", { name: /Monitor/ })).not.toBeInTheDocument();
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
