import { render, screen, fireEvent, within } from "@testing-library/react";
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
    siteName: `Site ${siteCounter}`,
    address: "123 Main St",
    city: "Denver",
    state: "CO",
    status: "ACTIVE",
    linkMethod: "ADDRESS",
    linkConfidence: "HIGH",
    dealId: "111",
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

function firstRowText(): string {
  const rows = screen.getAllByRole("row");
  return rows[1].textContent || "";
}

beforeEach(() => {
  siteCounter = 0;
});

describe("FleetTable sorting", () => {
  it("sorts by solar output when the Solar header is clicked (desc first, then asc)", () => {
    render(
      <FleetTable
        sites={[
          makeSite({ siteName: "LowSite", telemetrySnapshot: { solarPowerW: 100, batterySocPercent: 10, gridPowerW: 0, gridConnectedStatus: null } }),
          makeSite({ siteName: "HighSite", telemetrySnapshot: { solarPowerW: 9000, batterySocPercent: 90, gridPowerW: 0, gridConnectedStatus: null } }),
          makeSite({ siteName: "MidSite", telemetrySnapshot: { solarPowerW: 500, batterySocPercent: 40, gridPowerW: 0, gridConnectedStatus: null } }),
        ]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /^solar$/i }));
    expect(firstRowText()).toContain("HighSite");

    fireEvent.click(screen.getByRole("button", { name: /^solar$/i }));
    expect(firstRowText()).toContain("LowSite");
  });

  it("sorts by customer name when the Customer header is clicked", () => {
    render(
      <FleetTable
        sites={[
          makeSite({ siteName: "B-Site", dealName: "Zeta, Bob" }),
          makeSite({ siteName: "A-Site", dealName: "Abel, Ann" }),
        ]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /^customer$/i }));
    expect(firstRowText()).toContain("A-Site");
  });
});

describe("FleetTable filters", () => {
  it("filters to unlinked sites via the Link filter", () => {
    render(
      <FleetTable
        sites={[
          makeSite({ siteName: "LinkedSite" }),
          makeSite({ siteName: "OrphanSite", linkMethod: "UNLINKED", dealId: null, dealName: null }),
        ]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /link:/i }));
    const dropdown = screen.getByPlaceholderText("Search...").closest("div")!.parentElement!;
    fireEvent.click(within(dropdown).getByRole("button", { name: /unlinked/i }));

    expect(screen.getByText("OrphanSite")).toBeInTheDocument();
    expect(screen.queryByText("LinkedSite")).not.toBeInTheDocument();
  });

  it("filters by alert severity", () => {
    render(
      <FleetTable
        sites={[
          makeSite({
            siteName: "CriticalSite",
            alerts: [{ id: "a1", severity: "CRITICAL", alertName: "X" }],
          }),
          makeSite({ siteName: "QuietSite", alerts: [] }),
        ]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /alerts:/i }));
    const dropdown = screen.getByPlaceholderText("Search...").closest("div")!.parentElement!;
    fireEvent.click(within(dropdown).getByRole("button", { name: /critical/i }));

    expect(screen.getByText("CriticalSite")).toBeInTheDocument();
    expect(screen.queryByText("QuietSite")).not.toBeInTheDocument();
  });

  it("filters by grid status", () => {
    render(
      <FleetTable
        sites={[
          makeSite({ siteName: "OnGridSite" }),
          makeSite({
            siteName: "OffGridSite",
            telemetrySnapshot: {
              solarPowerW: 0,
              batterySocPercent: 20,
              gridPowerW: 0,
              gridConnectedStatus: "Islanded",
            },
          }),
        ]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /grid:/i }));
    const dropdown = screen.getByPlaceholderText("Search...").closest("div")!.parentElement!;
    fireEvent.click(within(dropdown).getByRole("button", { name: /off-grid/i }));

    expect(screen.getByText("OffGridSite")).toBeInTheDocument();
    expect(screen.queryByText("OnGridSite")).not.toBeInTheDocument();
  });

  it("reports the filtered rows for export via onVisibleRowsChange", () => {
    const onVisible = jest.fn();
    render(
      <FleetTable
        sites={[
          makeSite({ siteName: "LinkedSite" }),
          makeSite({ siteName: "OrphanSite", linkMethod: "UNLINKED", dealId: null, dealName: null }),
        ]}
        onVisibleRowsChange={onVisible}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /link:/i }));
    const dropdown = screen.getByPlaceholderText("Search...").closest("div")!.parentElement!;
    fireEvent.click(within(dropdown).getByRole("button", { name: /unlinked/i }));

    const lastCall = onVisible.mock.calls.at(-1)![0];
    expect(lastCall).toHaveLength(1);
    expect(lastCall[0].siteName).toBe("OrphanSite");
  });
});
