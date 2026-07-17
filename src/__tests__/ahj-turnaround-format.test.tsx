import { render, screen } from "@testing-library/react";
import { AhjTab } from "@/app/dashboards/permit-hub/tabs/AhjTab";
import type { AHJRecord } from "@/lib/hubspot-custom-objects";

function ahj(props: Record<string, string | null>): AHJRecord {
  return {
    id: "1",
    properties: { record_name: "Denver", ...props },
  } as unknown as AHJRecord;
}

/**
 * The AHJ turnaround rollups are milliseconds. Rendering them raw put
 * "489135483.870968" on screen where days were meant. Ground truth comes from
 * the object's own permit_turnaround_average text field:
 *   Arvada     2002560000ms -> 23.2d  (text says 24)
 *   Aurora      705600000ms ->  8.2d  (text says 8)
 *   Atascadero 5085257142ms -> 58.9d  (text says 59)
 */
describe("AhjTab turnaround formatting", () => {
  it("renders millisecond rollups as days", () => {
    render(<AhjTab ahj={[ahj({ average_permit_turnaround_time__365_days_: "705600000" })]} />);
    expect(screen.getByText("8.2 days")).toBeInTheDocument();
    // The raw millisecond value must never reach the screen.
    expect(screen.queryByText("705600000")).not.toBeInTheDocument();
  });

  it("matches the AHJ's own rounded text field", () => {
    render(<AhjTab ahj={[ahj({ average_permit_turnaround_time__365_days_: "2002560000" })]} />);
    expect(screen.getByText("23.2 days")).toBeInTheDocument(); // text field says 24
  });

  it("shows a dash rather than '0.0 days' when the rollup is zero", () => {
    // Real case: an AHJ with no permits in the window rolls up to 0.
    render(<AhjTab ahj={[ahj({ average_permit_turnaround_time__365_days_: "0" })]} />);
    expect(screen.queryByText("0.0 days")).not.toBeInTheDocument();
  });

  it("rounds the revision average instead of dumping float precision", () => {
    render(<AhjTab ahj={[ahj({ average_permit_revision_count: "0.329032" })]} />);
    expect(screen.getByText("0.33")).toBeInTheDocument();
    expect(screen.queryByText("0.329032")).not.toBeInTheDocument();
  });
});
