import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PermitQueue } from "@/app/dashboards/permit-hub/PermitQueue";
import type { PermitQueueItem } from "@/lib/permit-hub";

function item(over: Partial<PermitQueueItem> & { dealId: string }): PermitQueueItem {
  return {
    name: `Deal ${over.dealId}`,
    address: "1 Main St",
    pbLocation: "Westminster",
    status: "Ready For Permitting",
    actionLabel: "Submit to AHJ",
    actionKind: "SUBMIT_TO_AHJ",
    daysInStatus: 0,
    isStale: false,
    permitLead: "Peter",
    permitLeadOwnerId: "1",
    pm: null,
    amount: null,
    ...over,
  };
}

// 2 ready, 2 rejections, 1 resubmit, 3 follow_up
const ITEMS: PermitQueueItem[] = [
  item({ dealId: "r1", actionKind: "SUBMIT_TO_AHJ" }),
  item({ dealId: "r2", actionKind: "SUBMIT_SOLARAPP" }),
  item({ dealId: "x1", actionKind: "REVIEW_REJECTION" }),
  item({ dealId: "x2", actionKind: "COMPLETE_REVISION" }),
  item({ dealId: "s1", actionKind: "RESUBMIT_TO_AHJ" }),
  item({ dealId: "f1", actionKind: "FOLLOW_UP" }),
  item({ dealId: "f2", actionKind: "FOLLOW_UP" }),
  item({ dealId: "f3", actionKind: "MARK_PERMIT_ISSUED" }),
];

function renderQueue(items = ITEMS) {
  const onSelect = jest.fn();
  render(
    <PermitQueue
      items={items}
      isLoading={false}
      selectedDealId={null}
      onSelect={onSelect}
    />,
  );
  return { onSelect };
}

const tab = (name: RegExp) => screen.getByRole("tab", { name });

describe("PermitQueue tabs", () => {
  it("renders one tab per group with the correct counts", () => {
    renderQueue();
    expect(screen.getAllByRole("tab")).toHaveLength(4);
    expect(tab(/Ready to Submit/)).toHaveTextContent("2");
    expect(tab(/Rejections \/ Revisions/)).toHaveTextContent("2");
    expect(tab(/^Resubmit/)).toHaveTextContent("1");
    expect(tab(/Waiting \/ Follow Up/)).toHaveTextContent("3");
  });

  it("routes rejection and revision work to the Rejections tab, not Resubmit", async () => {
    const user = userEvent.setup();
    renderQueue();

    await user.click(tab(/Rejections \/ Revisions/));
    const panel = screen.getByRole("tabpanel");
    // REVIEW_REJECTION + COMPLETE_REVISION land here
    expect(within(panel).getByText("Deal x1")).toBeInTheDocument();
    expect(within(panel).getByText("Deal x2")).toBeInTheDocument();
    // RESUBMIT_TO_AHJ stays in Resubmit
    expect(within(panel).queryByText("Deal s1")).not.toBeInTheDocument();

    await user.click(tab(/^Resubmit/));
    const resubmitPanel = screen.getByRole("tabpanel");
    expect(within(resubmitPanel).getByText("Deal s1")).toBeInTheDocument();
    expect(within(resubmitPanel).queryByText("Deal x1")).not.toBeInTheDocument();
  });

  it("defaults to the Ready tab and shows only its items", () => {
    renderQueue();
    expect(tab(/Ready to Submit/)).toHaveAttribute("aria-selected", "true");

    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getAllByRole("listitem")).toHaveLength(2);
    expect(within(panel).getByText("Deal r1")).toBeInTheDocument();
    // Items from other groups must not be in the list
    expect(within(panel).queryByText("Deal s1")).not.toBeInTheDocument();
    expect(within(panel).queryByText("Deal f1")).not.toBeInTheDocument();
  });

  it("switches the list when another tab is clicked", async () => {
    const user = userEvent.setup();
    renderQueue();

    await user.click(tab(/Waiting \/ Follow Up/));

    expect(tab(/Waiting \/ Follow Up/)).toHaveAttribute("aria-selected", "true");
    expect(tab(/Ready to Submit/)).toHaveAttribute("aria-selected", "false");

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
    // No resubmit items at all
    renderQueue([item({ dealId: "r1", actionKind: "SUBMIT_TO_AHJ" })]);

    const resubmit = tab(/Resubmit/);
    expect(resubmit).toHaveTextContent("0");

    await user.click(resubmit);
    expect(screen.getByText(/Nothing in Resubmit/)).toBeInTheDocument();
  });
});
