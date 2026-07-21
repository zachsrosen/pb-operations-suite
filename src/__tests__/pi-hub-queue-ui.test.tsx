import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/contexts/ToastContext";
import { Queue } from "@/app/dashboards/pi-hub/Queue";
import type { QueueItem } from "@/lib/pi-hub/types";

// Rows carry `group` precomputed by the server — the UI never re-derives it.
function item(over: Partial<QueueItem> & { dealId: string }): QueueItem {
  return {
    name: `Deal ${over.dealId}`,
    address: "1 Main St",
    pbLocation: "Westminster",
    status: "Ready For Permitting",
    statusLabel: "Ready For Permitting",
    dealStage: "Permitting & Interconnection",
    group: "ready",
    daysInStatus: 0,
    isStale: false,
    lead: "Peter",
    leadOwnerId: "1",
    pm: null,
    amount: null,
    ...over,
  };
}

// 2 ready, 2 rejections, 1 resubmit, 3 waiting
const ITEMS: QueueItem[] = [
  item({ dealId: "r1", group: "ready" }),
  item({ dealId: "r2", group: "ready" }),
  item({ dealId: "x1", group: "rejections" }),
  item({ dealId: "x2", group: "rejections" }),
  item({ dealId: "s1", group: "resubmit" }),
  item({ dealId: "f1", group: "waiting" }),
  item({ dealId: "f2", group: "waiting" }),
  item({ dealId: "f3", group: "waiting" }),
];

function renderQueue(items = ITEMS, opts: { isSwitching?: boolean } = {}) {
  const onSelect = jest.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    // ToastProvider: the rows' StatusDropdown reports post-write warnings via
    // the toast context.
    <QueryClientProvider client={client}>
      <ToastProvider>
        <Queue
          items={items}
          isLoading={false}
          isSwitching={opts.isSwitching ?? false}
          selectedDealId={null}
          onSelect={onSelect}
          team="permit"
          accent="blue"
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { onSelect };
}

const tab = (name: RegExp) => screen.getByRole("tab", { name });

describe("pi-hub Queue tabs", () => {
  it("renders one tab per group with the correct counts", () => {
    renderQueue();
    expect(screen.getAllByRole("tab")).toHaveLength(5);
    expect(tab(/^Ready/)).toHaveTextContent("2");
    expect(tab(/^Rejections/)).toHaveTextContent("2");
    expect(tab(/^Resubmit/)).toHaveTextContent("1");
    expect(tab(/^Waiting/)).toHaveTextContent("3");
    expect(tab(/^Other/)).toHaveTextContent("0");
  });

  it("uses the server-provided group, not a client re-derivation", async () => {
    const user = userEvent.setup();
    // status text has no bearing — group is authoritative.
    renderQueue([
      item({ dealId: "d1", status: "Rejected", group: "other" }),
      item({ dealId: "n1", status: "Non-Design Related Rejection", group: "rejections" }),
    ]);
    expect(tab(/^Other/)).toHaveTextContent("1");
    expect(tab(/^Rejections/)).toHaveTextContent("1");

    await user.click(tab(/^Other/));
    expect(within(screen.getByRole("tabpanel")).getByText("Deal d1")).toBeInTheDocument();

    await user.click(tab(/^Rejections/));
    expect(within(screen.getByRole("tabpanel")).getByText("Deal n1")).toBeInTheDocument();
  });

  it("defaults to the Ready tab and shows only its items", () => {
    renderQueue();
    expect(tab(/^Ready/)).toHaveAttribute("aria-selected", "true");

    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getAllByRole("listitem")).toHaveLength(2);
    expect(within(panel).getByText("Deal r1")).toBeInTheDocument();
    expect(within(panel).queryByText("Deal s1")).not.toBeInTheDocument();
    expect(within(panel).queryByText("Deal f1")).not.toBeInTheDocument();
  });

  it("switches the list when another tab is clicked", async () => {
    const user = userEvent.setup();
    renderQueue();

    await user.click(tab(/^Waiting/));

    expect(tab(/^Waiting/)).toHaveAttribute("aria-selected", "true");
    expect(tab(/^Ready/)).toHaveAttribute("aria-selected", "false");

    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getAllByRole("listitem")).toHaveLength(3);
    expect(within(panel).getByText("Deal f1")).toBeInTheDocument();
    expect(within(panel).queryByText("Deal r1")).not.toBeInTheDocument();
  });

  it("still selects a deal from the active tab", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderQueue();

    await user.click(screen.getByText("Deal r1"));
    expect(onSelect).toHaveBeenCalledWith("r1");
  });

  it("shows a per-tab empty state (with a 0 badge) instead of hiding the tab", async () => {
    const user = userEvent.setup();
    renderQueue([item({ dealId: "r1", group: "ready" })]);

    const resubmit = tab(/^Resubmit/);
    expect(resubmit).toHaveTextContent("0");

    await user.click(resubmit);
    expect(screen.getByText(/Nothing in Resubmit/)).toBeInTheDocument();
  });

  it("displays the human status label, not the HubSpot internal value", async () => {
    const user = userEvent.setup();
    renderQueue([
      item({
        dealId: "x1",
        group: "other",
        status: "Rejected",
        statusLabel: "Permit Rejected - Needs Revision",
      }),
    ]);
    await user.click(tab(/^Other/));
    const panel = screen.getByRole("tabpanel");
    expect(
      within(panel).getByText("Permit Rejected - Needs Revision"),
    ).toBeInTheDocument();
    expect(within(panel).queryByText("Rejected")).not.toBeInTheDocument();
  });

  it("searches on the status label as well as the raw value", async () => {
    const user = userEvent.setup();
    renderQueue([
      item({
        dealId: "x1",
        group: "ready",
        status: "Pending SolarApp",
        statusLabel: "Ready to Submit for SolarApp",
      }),
      item({ dealId: "r1", group: "ready" }),
    ]);
    await user.type(
      screen.getByPlaceholderText(/Search project/),
      "Ready to Submit for Solar",
    );
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText("Deal x1")).toBeInTheDocument();
    expect(within(panel).queryByText("Deal r1")).not.toBeInTheDocument();
  });

  it("shows the deal stage on each row, and searches on it", async () => {
    const user = userEvent.setup();
    renderQueue([
      item({ dealId: "r1", group: "ready", dealStage: "Design & Engineering" }),
      item({ dealId: "r2", group: "ready", dealStage: "Construction" }),
    ]);
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText(/Design & Engineering/)).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText(/Search project/), "construction");
    const after = screen.getByRole("tabpanel");
    expect(within(after).getByText("Deal r2")).toBeInTheDocument();
    expect(within(after).queryByText("Deal r1")).not.toBeInTheDocument();
  });

  it("renders a real day count, and an em dash when the entry time is unknown", () => {
    renderQueue([
      item({ dealId: "known", group: "ready", daysInStatus: 23 }),
      item({ dealId: "unknown", group: "ready", daysInStatus: null }),
    ]);
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText(/23d/)).toBeInTheDocument();
    expect(within(panel).getByText(/—/)).toBeInTheDocument();
    expect(within(panel).queryByText(/\b0d\b/)).not.toBeInTheDocument();
  });

  it("renders the stale badge for stale rows", () => {
    renderQueue([item({ dealId: "r1", group: "ready", isStale: true })]);
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText("Stale")).toBeInTheDocument();
  });
});

describe("Inspection tab", () => {
  const inspectionItem = (dealId: string) =>
    item({
      dealId,
      group: "inspection",
      status: "Complete",
      statusLabel: "Permit Issued",
    });

  it("is hidden when the queue carries no inspection rows", () => {
    renderQueue();
    expect(screen.getAllByRole("tab")).toHaveLength(5);
    expect(
      screen.queryByRole("tab", { name: /^Inspection/ }),
    ).not.toBeInTheDocument();
  });

  it("renders LAST with its count when inspection rows exist, and shows them", async () => {
    const user = userEvent.setup();
    renderQueue([...ITEMS, inspectionItem("i1"), inspectionItem("i2")]);

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(6);
    expect(tabs[5]).toHaveTextContent(/^Inspection/);
    expect(tab(/^Inspection/)).toHaveTextContent("2");

    await user.click(tab(/^Inspection/));
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getAllByRole("listitem")).toHaveLength(2);
    // Display label, not the internal "Complete" value.
    expect(within(panel).getAllByText("Permit Issued")).toHaveLength(2);
  });

  it("snaps back to Ready when the queue loses its inspection rows", async () => {
    // A team switch swaps `items` WITHOUT remounting the Queue — the active
    // tab must not strand on a tab that no longer renders.
    const user = userEvent.setup();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const ui = (items: QueueItem[]) => (
      <QueryClientProvider client={client}>
        <ToastProvider>
          <Queue
            items={items}
            isLoading={false}
            isSwitching={false}
            selectedDealId={null}
            onSelect={jest.fn()}
            team="permit"
            accent="blue"
          />
        </ToastProvider>
      </QueryClientProvider>
    );
    const { rerender } = render(ui([inspectionItem("i1")]));
    await user.click(tab(/^Inspection/));
    expect(tab(/^Inspection/)).toHaveAttribute("aria-selected", "true");

    rerender(ui([item({ dealId: "r1", group: "ready" })]));
    expect(
      screen.queryByRole("tab", { name: /^Inspection/ }),
    ).not.toBeInTheDocument();
    expect(tab(/^Ready/)).toHaveAttribute("aria-selected", "true");
  });
});

describe("team switching feedback", () => {
  // A cold queue load runs one history call per deal (30-60s for IC) while
  // keepPreviousData keeps the old team's rows on screen. Without a visible
  // state the switch reads as a no-op — the first live user reported exactly
  // that ("nothing is changing between the tabs").
  it("shows a loading banner and marks the panel busy while switching", () => {
    renderQueue([item({ dealId: "r1" })], { isSwitching: true });
    expect(screen.getByRole("status")).toHaveTextContent(/Loading Permit queue/);
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-busy", "true");
  });

  it("shows no banner when not switching", () => {
    renderQueue([item({ dealId: "r1" })]);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-busy", "false");
  });
});
