import { render, screen, within } from "@testing-library/react";
import FleetTable from "@/components/powerhub/FleetTable";

jest.mock("@/components/powerhub/SiteDetail", () => ({
  __esModule: true,
  default: () => <div data-testid="site-detail" />,
}));

let siteCounter = 0;
function makeSite(overrides: Record<string, unknown> = {}) {
  siteCounter++;
  return {
    siteId: `site-${siteCounter}-uuid-${siteCounter}${siteCounter}`,
    siteName: `STE2026010${siteCounter}-0000${siteCounter}`,
    address: "123 Main St",
    city: "Denver",
    state: "CO",
    status: "ACTIVE",
    linkMethod: "GEO",
    linkConfidence: "HIGH",
    dealId: null,
    resolvedDealId: "111",
    customerName: null,
    dealName: `Customer ${siteCounter}`,
    totalGateways: 1,
    totalBatteries: 1,
    totalInverters: 1,
    telemetrySnapshot: {
      solarPowerW: 1000,
      batterySocPercent: 50,
      gridPowerW: 0,
      gridConnectedStatus: "Grid Connected",
    },
    alerts: [],
    ...overrides,
  };
}

beforeEach(() => {
  siteCounter = 0;
});

describe("FleetTable customer-first identity", () => {
  it("leads the row with the customer name and shows the Tesla site code as secondary", () => {
    render(
      <FleetTable
        sites={[makeSite({ dealName: "Smith, Jane - PROJ-1234" })]}
      />
    );

    const firstCell = within(screen.getAllByRole("row")[1]).getAllByRole("cell")[0];
    // Customer is the primary identity of the row
    expect(within(firstCell).getByRole("link", { name: /smith, jane/i })).toBeInTheDocument();
    // Tesla site code still present but secondary within the same cell
    expect(firstCell.textContent).toContain("STE20260101-00001");
  });

  it("falls back to the site name as row identity for unlinked sites", () => {
    render(
      <FleetTable
        sites={[
          makeSite({
            linkMethod: "UNLINKED",
            resolvedDealId: null,
            dealName: null,
          }),
        ]}
      />
    );

    const firstCell = within(screen.getAllByRole("row")[1]).getAllByRole("cell")[0];
    expect(firstCell.textContent).toContain("STE20260101-00001");
  });
});

describe("FleetTable default sort", () => {
  it("defaults to worst-alerts-first with the sort direction visible on the Alerts header", () => {
    render(
      <FleetTable
        sites={[
          makeSite({ dealName: "Quiet" }),
          makeSite({
            dealName: "Critical",
            alerts: [{ id: "a", severity: "CRITICAL", alertName: "X" }],
          }),
          makeSite({
            dealName: "Perf",
            alerts: [{ id: "b", severity: "PERFORMANCE", alertName: "Y" }],
          }),
        ]}
      />
    );

    const rows = screen.getAllByRole("row");
    expect(rows[1].textContent).toContain("Critical");
    expect(rows[2].textContent).toContain("Perf");

    // The active sort is visible without interacting
    const alertsHeader = screen.getByRole("button", { name: /^alerts$/i });
    expect(alertsHeader.textContent).toContain("↓");
  });

  it("breaks ties stably by site id so equal rows never swap between refetches", () => {
    const sites = [
      makeSite({ dealName: "B" }),
      makeSite({ dealName: "A" }),
    ];
    const { unmount } = render(<FleetTable sites={sites} />);
    const orderFirst = screen.getAllByRole("row").map((r) => r.textContent);
    unmount();

    // Same data re-rendered in reversed input order (as a reshuffling server
    // response would) must yield the same visible order.
    render(<FleetTable sites={[...sites].reverse()} />);
    const orderSecond = screen.getAllByRole("row").map((r) => r.textContent);
    expect(orderSecond).toEqual(orderFirst);
  });
});
