import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IcQueue } from "@/app/dashboards/ic-hub/IcQueue";
import type { IcQueueItem } from "@/lib/ic-hub";

function item(over: Partial<IcQueueItem> & { dealId: string }): IcQueueItem {
  return {
    name: `Deal ${over.dealId}`,
    address: "1 Main St",
    pbLocation: "Camarillo",
    status: "Ready for Interconnection",
    statusLabel: "Ready for Interconnection",
    dealStage: "Permitting & Interconnection",
    actionLabel: "Submit to utility",
    actionKind: "SUBMIT_TO_UTILITY",
    daysInStatus: 3,
    isStale: false,
    icLead: "Joe",
    icLeadOwnerId: "1",
    pm: null,
    amount: null,
    ...over,
  };
}

function renderQueue(items: IcQueueItem[]) {
  render(
    <IcQueue items={items} isLoading={false} selectedDealId={null} onSelect={jest.fn()} />,
  );
}

const tab = (name: RegExp) => screen.getByRole("tab", { name });

describe("IcQueue tabs", () => {
  it("renders the four groups including Other", () => {
    renderQueue([item({ dealId: "r1" })]);
    expect(screen.getAllByRole("tab")).toHaveLength(4);
    expect(tab(/Ready to Submit/)).toHaveTextContent("1");
    expect(tab(/^Other/)).toHaveTextContent("0");
  });

  it("routes design-owned statuses to Other despite their action kind", async () => {
    const user = userEvent.setup();
    renderQueue([
      // "Rejected" is labelled "Rejected - Revisions Needed" -> design's work.
      item({
        dealId: "d1",
        status: "Rejected",
        statusLabel: "Rejected - Revisions Needed",
        actionKind: "REVIEW_IC_REJECTION",
      }),
      // "In Design For Revisions" is also design's.
      item({
        dealId: "d2",
        status: "In Design For Revisions",
        statusLabel: "Design Revision In Progress",
        actionKind: "COMPLETE_IC_REVISION",
      }),
      // "Rejected (New)" is labelled plain "Rejected" and is NOT design's —
      // it stays in the action tabs.
      item({
        dealId: "k1",
        status: "Rejected (New)",
        statusLabel: "Rejected",
        actionKind: "REVIEW_IC_REJECTION",
      }),
    ]);

    expect(tab(/^Other/)).toHaveTextContent("2");
    expect(tab(/Resubmit \/ Revision/)).toHaveTextContent("1");

    await user.click(tab(/^Other/));
    const other = screen.getByRole("tabpanel");
    expect(within(other).getByText("Deal d1")).toBeInTheDocument();
    expect(within(other).getByText("Deal d2")).toBeInTheDocument();
    expect(within(other).queryByText("Deal k1")).not.toBeInTheDocument();
  });

  it("routes statuses with no IC action to Other, not Follow Up", async () => {
    const user = userEvent.setup();
    renderQueue([
      item({
        dealId: "u1",
        status: "Transformer Upgrade",
        statusLabel: "Transformer Upgrade",
        actionKind: null,
      }),
      item({ dealId: "f1", status: "Submitted To Utility", actionKind: "FOLLOW_UP_UTILITY" }),
    ]);
    expect(tab(/^Other/)).toHaveTextContent("1");
    expect(tab(/Waiting \/ Follow Up/)).toHaveTextContent("1");

    await user.click(tab(/^Other/));
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText("Deal u1")).toBeInTheDocument();
    expect(within(panel).queryByText("Deal f1")).not.toBeInTheDocument();
  });

  it("displays the status label, not the internal value", () => {
    renderQueue([
      item({
        dealId: "s1",
        status: "Signature Acquired By Customer",
        statusLabel: "Ready To Submit",
      }),
    ]);
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText("Ready To Submit")).toBeInTheDocument();
    expect(
      within(panel).queryByText("Signature Acquired By Customer"),
    ).not.toBeInTheDocument();
  });
});
