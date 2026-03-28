// Mock declarations must come before any imports
const mockGetPage = jest.fn();
const mockGetById = jest.fn();
const mockCaptureException = jest.fn();

jest.mock("@/lib/hubspot", () => ({
  hubspotClient: {
    crm: {
      owners: {
        ownersApi: {
          getPage: (...args: unknown[]) => mockGetPage(...args),
        },
      },
      deals: {
        basicApi: {
          getById: (...args: unknown[]) => mockGetById(...args),
        },
      },
    },
  },
}));

jest.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => mockCaptureException(...args),
}));

jest.mock("@/lib/db", () => ({
  prisma: {},
}));

import { detectMilestones } from "@/lib/eod-summary/milestones";
import type { StatusChange } from "@/lib/eod-summary/snapshot";

// ── Fixtures ───────────────────────────────────────────────────────────────────

const baseChange: StatusChange = {
  dealId: "100",
  dealName: "Turner Solar",
  pipeline: "6900017",
  dealStage: "20461937",
  pbLocation: "Westminster",
  field: "permittingStatus",
  from: "Ready For Permitting",
  to: "Submitted to AHJ",
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("detectMilestones", () => {
  it("identifies a known milestone", () => {
    const hits = detectMilestones([baseChange]);

    expect(hits).toHaveLength(1);
    expect(hits[0].displayLabel).toBe("Submitted to AHJ");
    expect(hits[0].department).toBe("Permitting");
    expect(hits[0].change).toBe(baseChange);
  });

  it("skips non-milestone changes", () => {
    const change: StatusChange = {
      ...baseChange,
      to: "Waiting On Information",
    };

    const hits = detectMilestones([change]);

    expect(hits).toHaveLength(0);
  });

  it("handles null 'to' value", () => {
    const change: StatusChange = {
      ...baseChange,
      to: null,
    };

    const hits = detectMilestones([change]);

    expect(hits).toHaveLength(0);
  });
});
