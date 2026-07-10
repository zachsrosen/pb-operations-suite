import { render, screen, fireEvent } from "@testing-library/react";
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

describe("FleetTable customer column", () => {
  it("shows the customer name linked to the HubSpot deal", () => {
    render(<FleetTable sites={[makeSite()]} />);

    const link = screen.getByRole("link", { name: /jane smith/i });
    expect(link).toHaveAttribute(
      "href",
      expect.stringContaining("/record/0-3/9876543210")
    );
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("falls back to the deal name when customer name is missing", () => {
    render(
      <FleetTable
        sites={[makeSite({ customerName: null })]}
      />
    );

    expect(
      screen.getByRole("link", { name: /smith, jane - proj-1234/i })
    ).toBeInTheDocument();
  });

  it("shows a placeholder when the site has no linked deal", () => {
    render(
      <FleetTable
        sites={[
          makeSite({
            dealId: null,
            customerName: null,
            dealName: null,
            linkMethod: "UNLINKED",
          }),
        ]}
      />
    );

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("clicking the customer link does not expand the site row", () => {
    render(<FleetTable sites={[makeSite()]} />);

    fireEvent.click(screen.getByRole("link", { name: /jane smith/i }));
    expect(screen.queryByTestId("site-detail")).not.toBeInTheDocument();
  });

  it("search matches on customer name", () => {
    render(
      <FleetTable
        sites={[
          makeSite(),
          makeSite({
            siteId: "aaaa1111-2222-3333-4444-555555555555",
            siteName: "Jones Residence",
            customerName: "Bob Jones",
            dealId: "111",
            dealName: "Jones, Bob - PROJ-9999",
          }),
        ]}
      />
    );

    fireEvent.change(screen.getByPlaceholderText(/search sites/i), {
      target: { value: "bob jones" },
    });

    expect(screen.getByText("Jones Residence")).toBeInTheDocument();
    expect(screen.queryByText("Smith Residence")).not.toBeInTheDocument();
  });
});
