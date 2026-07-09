import { render, screen } from "@testing-library/react";
import {
  ConstructionProjectDetailPanel,
  type ConstructionProjectDetailPanelProject,
} from "@/components/scheduler/ConstructionProjectDetailPanel";

const project: ConstructionProjectDetailPanelProject = {
  id: "PROJ-1234",
  name: "PROJ-1234 | Smith Residence",
  address: "1 Main St, Denver, CO",
  location: "DTC",
  amount: 42000,
  type: "Solar + Storage",
  systemSize: 8.4,
  batteries: 1,
  evCount: 0,
  installStatus: "Scheduled",
  completionDate: null,
  closeDate: null,
  hubspotUrl: "https://app.hubspot.com/contacts/1/deal/1",
  zuperJobUid: "pv-1",
  zuperSubJobs: [
    { systemType: "solar", jobUid: "pv-1", status: "Scheduled" },
    { systemType: "battery", jobUid: "ess-1", status: "Ready" },
  ],
};

const baseProps = {
  scheduledDate: null,
  scheduleDurationDays: 1,
  scheduleSourceLabel: "",
  isOverdue: false,
  isTentative: false,
  confirmingTentative: false,
  cancellingTentative: false,
  zuperWebBaseUrl: "https://web.zuperpro.com",
  onOpenSchedule: jest.fn(),
  onClearSelection: jest.fn(),
};

describe("ConstructionProjectDetailPanel Zuper links", () => {
  it("renders distinct PV and ESS links for split jobs", () => {
    render(<ConstructionProjectDetailPanel project={project} {...baseProps} />);
    expect(screen.getByRole("link", { name: /PV/ })).toHaveAttribute(
      "href",
      "https://web.zuperpro.com/jobs/pv-1/details",
    );
    expect(screen.getByRole("link", { name: /ESS/ })).toHaveAttribute(
      "href",
      "https://web.zuperpro.com/jobs/ess-1/details",
    );
  });

  it("renders a single Zuper link when no sub-jobs", () => {
    render(
      <ConstructionProjectDetailPanel
        project={{ ...project, zuperSubJobs: undefined }}
        {...baseProps}
      />,
    );
    expect(screen.getByRole("link", { name: /^Zuper$/ })).toHaveAttribute(
      "href",
      "https://web.zuperpro.com/jobs/pv-1/details",
    );
  });
});
