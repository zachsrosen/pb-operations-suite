import { extractSubJobsFromCandidates, type JobMatchForSubJobs } from "@/lib/scheduler-subjobs";
import { JOB_CATEGORIES } from "@/lib/zuper";

jest.mock("@sentry/nextjs", () => ({
  addBreadcrumb: jest.fn(),
}));

const makeCand = (
  overrides: Partial<JobMatchForSubJobs> & { categoryName: string },
): JobMatchForSubJobs => ({
  jobUid: `uid-${Math.random().toString(36).slice(2, 6)}`,
  status: "SCHEDULED",
  statusScore: 10,
  addressScore: 20,
  scheduledStart: "2026-05-12T08:00:00Z",
  scheduledEnd: "2026-05-13T17:00:00Z",
  scheduledDays: 2,
  assignedTo: ["Joe Diaz"],
  ...overrides,
});

describe("extractSubJobsFromCandidates", () => {
  it("returns 3 sub-jobs for a PV+ESS+EV deal in stable order", () => {
    const result = extractSubJobsFromCandidates(
      [
        makeCand({ categoryName: JOB_CATEGORIES.EV_INSTALL, jobUid: "ev-1" }),
        makeCand({ categoryName: JOB_CATEGORIES.SOLAR_INSTALL, jobUid: "solar-1" }),
        makeCand({ categoryName: JOB_CATEGORIES.BATTERY_INSTALL, jobUid: "batt-1" }),
      ],
      "deal-123",
    );
    expect(result).toHaveLength(3);
    expect(result.map(s => s.systemType)).toEqual(["solar", "battery", "ev"]);
    expect(result.map(s => s.jobUid)).toEqual(["solar-1", "batt-1", "ev-1"]);
  });

  it("returns 1 sub-job for a solar-only deal", () => {
    const result = extractSubJobsFromCandidates(
      [makeCand({ categoryName: JOB_CATEGORIES.SOLAR_INSTALL, jobUid: "solar-only" })],
      "deal-456",
    );
    expect(result).toHaveLength(1);
    expect(result[0].systemType).toBe("solar");
  });

  it("returns 1 legacy sub-job for a pre-split Construction job", () => {
    const result = extractSubJobsFromCandidates(
      [makeCand({ categoryName: JOB_CATEGORIES.CONSTRUCTION, jobUid: "legacy-1" })],
      "deal-789",
    );
    expect(result).toHaveLength(1);
    expect(result[0].systemType).toBe("legacy");
  });

  it("returns empty array for no candidates", () => {
    expect(extractSubJobsFromCandidates([], "deal-000")).toEqual([]);
  });

  it("picks highest statusScore when multiple jobs in same bucket", () => {
    const Sentry = require("@sentry/nextjs");
    const result = extractSubJobsFromCandidates(
      [
        makeCand({ categoryName: JOB_CATEGORIES.SOLAR_INSTALL, jobUid: "solar-low", statusScore: 5, status: "COMPLETED" }),
        makeCand({ categoryName: JOB_CATEGORIES.SOLAR_INSTALL, jobUid: "solar-high", statusScore: 20, status: "STARTED" }),
      ],
      "deal-dup",
    );
    expect(result).toHaveLength(1);
    expect(result[0].jobUid).toBe("solar-high");
    expect(result[0].status).toBe("STARTED");
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ level: "warning", message: expect.stringContaining("Multiple solar") }),
    );
  });

  it("preserves assigned crew and schedule data", () => {
    const result = extractSubJobsFromCandidates(
      [
        makeCand({
          categoryName: JOB_CATEGORIES.SOLAR_INSTALL,
          assignedTo: ["Joe Diaz", "Mike Chen"],
          scheduledStart: "2026-05-14T08:00:00Z",
          scheduledEnd: "2026-05-15T17:00:00Z",
          scheduledDays: 2,
        }),
      ],
      "deal-crew",
    );
    expect(result[0].assignedTo).toEqual(["Joe Diaz", "Mike Chen"]);
    expect(result[0].scheduledDate).toBe("2026-05-14T08:00:00Z");
    expect(result[0].scheduledDays).toBe(2);
  });
});
