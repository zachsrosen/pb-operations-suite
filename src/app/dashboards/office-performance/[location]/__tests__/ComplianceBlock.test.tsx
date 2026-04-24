import { render } from "@testing-library/react";
import ComplianceBlock from "../ComplianceBlock";
import type { SectionCompliance } from "@/lib/office-performance-types";

const baseCompliance: SectionCompliance = {
  totalJobs: 10,
  completedJobs: 8,
  onTimePercent: 80,
  stuckJobs: [],
  neverStartedCount: 1,
  avgDaysToComplete: 2.5,
  avgDaysLate: 0,
  oowUsagePercent: 60,
  oowOnTimePercent: 75,
  aggregateGrade: "B",
  aggregateScore: 85,
  byEmployee: [],
};

describe("ComplianceBlock", () => {
  it("renders v1 shape (tasksFractional undefined)", () => {
    const { container } = render(
      <ComplianceBlock
        compliance={{
          ...baseCompliance,
          byEmployee: [
            {
              name: "Jane",
              totalJobs: 10,
              completedJobs: 8,
              onTimePercent: 80,
              measurableCount: 8,
              lateCount: 2,
              stuckCount: 0,
              neverStartedCount: 0,
              avgDaysToComplete: 2,
              avgDaysLate: 0,
              oowUsagePercent: 50,
              oowOnTimePercent: 60,
              statusUsagePercent: 40,
              complianceScore: 80,
              grade: "B",
            },
          ],
        }}
      />
    );
    expect(container).toMatchSnapshot();
  });

  it("renders v2 shape with hasFollowUp + low-volume", () => {
    const { container } = render(
      <ComplianceBlock
        compliance={{
          ...baseCompliance,
          byEmployee: [
            {
              name: "Jane",
              totalJobs: 4,
              completedJobs: 4,
              onTimePercent: 75,
              measurableCount: 4,
              lateCount: 1,
              stuckCount: 0,
              neverStartedCount: 0,
              avgDaysToComplete: 2,
              avgDaysLate: 0,
              oowUsagePercent: -1,
              oowOnTimePercent: -1,
              statusUsagePercent: 0,
              complianceScore: 75,
              grade: "—",
              tasksFractional: 2.5,
              distinctParentJobs: 4,
              passRate: 100,
              hasFollowUp: true,
              lowVolume: true,
            },
          ],
        }}
      />
    );
    expect(container).toMatchSnapshot();
  });
});
