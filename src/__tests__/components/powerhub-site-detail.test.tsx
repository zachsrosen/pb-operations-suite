import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SiteDetail from "@/components/powerhub/SiteDetail";

const TICKET_URL =
  "https://ion.tesla.com/energy/concern/update-concern?ref=ABC-123&site=STE456";

function mockSiteResponse(alerts: Array<Record<string, unknown>>) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      site: {
        siteId: "site-1",
        siteName: "Smith Residence",
        address: "123 Main St",
        city: "Denver",
        state: "CO",
        status: "ACTIVE",
        linkMethod: "ADDRESS",
        linkConfidence: "HIGH",
        devices: {},
        totalGateways: 1,
        totalBatteries: 1,
        totalInverters: 1,
        telemetrySnapshot: null,
        property: null,
        alerts,
      },
      deal: null,
    }),
  }) as unknown as typeof fetch;
}

function renderSiteDetail() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SiteDetail siteId="site-1" />
    </QueryClientProvider>
  );
}

describe("SiteDetail Tesla ticket link", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders an external Tesla ticket link when the alert has one", async () => {
    mockSiteResponse([
      {
        id: "alert-1",
        alertName: "PVInverterOffline",
        severity: "CRITICAL",
        deviceId: "device-1",
        supportAutoTicketUrl: TICKET_URL,
      },
    ]);

    renderSiteDetail();

    const link = await screen.findByRole("link", { name: /tesla ticket/i });
    expect(link).toHaveAttribute("href", TICKET_URL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("renders no ticket link when the alert lacks a URL", async () => {
    mockSiteResponse([
      {
        id: "alert-1",
        alertName: "PVInverterOffline",
        severity: "CRITICAL",
        deviceId: "device-1",
        supportAutoTicketUrl: null,
      },
    ]);

    renderSiteDetail();

    await screen.findByText("PVInverterOffline");
    expect(
      screen.queryByRole("link", { name: /tesla ticket/i })
    ).not.toBeInTheDocument();
  });
});
