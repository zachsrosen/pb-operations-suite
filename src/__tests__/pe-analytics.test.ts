import {
  weekStartUTC,
  groupForStatus,
  computeMilestoneTiming,
  median,
  percentile,
  buildUploaderStats,
  UNKNOWN_UPLOADER,
} from "@/lib/pe-analytics";

describe("weekStartUTC", () => {
  it("returns the same day for a UTC Monday", () => {
    expect(weekStartUTC(new Date("2026-06-08T00:00:00Z"))).toBe("2026-06-08");
  });

  it("returns the prior Monday for mid-week dates", () => {
    expect(weekStartUTC(new Date("2026-06-10T15:30:00Z"))).toBe("2026-06-08");
  });

  it("buckets Sunday into the preceding Monday's week", () => {
    expect(weekStartUTC(new Date("2026-06-14T23:59:59Z"))).toBe("2026-06-08");
  });

  it("uses UTC, not local time, near midnight", () => {
    // Late Sunday UTC must stay in the prior week even if local TZ rolls forward
    expect(weekStartUTC(new Date("2026-04-26T23:30:00Z"))).toBe("2026-04-20");
  });
});

describe("groupForStatus", () => {
  it("maps every onboarding-phase status to Onboarding", () => {
    for (const s of [
      "Waiting on Information",
      "Ready for Onboarding",
      "Onboarding Submitted",
      "Onboarding Rejected",
      "Onboarding Ready to Resubmit",
      "Onboarding Resubmitted",
    ]) {
      expect(groupForStatus(s)).toBe("Onboarding");
    }
  });

  it("maps review and rejection states", () => {
    expect(groupForStatus("Submitted")).toBe("In Review");
    expect(groupForStatus("Resubmitted")).toBe("In Review");
    expect(groupForStatus("Rejected")).toBe("Rejected — pending fix");
    expect(groupForStatus("Ready to Resubmit")).toBe("Rejected — pending fix");
    expect(groupForStatus("Approved")).toBe("Approved (unpaid)");
    expect(groupForStatus("Paid")).toBe("Paid");
  });

  it("returns Other for unknown statuses and null for empty", () => {
    expect(groupForStatus("Something New")).toBe("Other");
    expect(groupForStatus(null)).toBeNull();
    expect(groupForStatus("")).toBeNull();
  });
});

describe("computeMilestoneTiming", () => {
  it("finds first submission, approval, payment and counts rejections", () => {
    const t = computeMilestoneTiming([
      { value: "Paid", timestamp: "2026-05-20T00:00:00Z" },
      { value: "Approved", timestamp: "2026-05-10T00:00:00Z" },
      { value: "Resubmitted", timestamp: "2026-05-05T00:00:00Z" },
      { value: "Rejected", timestamp: "2026-05-03T00:00:00Z" },
      { value: "Submitted", timestamp: "2026-05-01T00:00:00Z" },
      { value: "Ready to Submit", timestamp: "2026-04-28T00:00:00Z" },
    ]);
    expect(t.firstSubmitted).toBe("2026-05-01T00:00:00Z");
    expect(t.firstApproved).toBe("2026-05-10T00:00:00Z");
    expect(t.firstPaid).toBe("2026-05-20T00:00:00Z");
    expect(t.rejectionCount).toBe(1);
    expect(t.daysSubmitToApprove).toBe(9);
    expect(t.daysApproveToPaid).toBe(10);
  });

  it("ignores onboarding statuses for submission detection", () => {
    const t = computeMilestoneTiming([
      { value: "Onboarding Submitted", timestamp: "2026-04-01T00:00:00Z" },
      { value: "Submitted", timestamp: "2026-04-10T00:00:00Z" },
    ]);
    expect(t.firstSubmitted).toBe("2026-04-10T00:00:00Z");
    expect(t.firstApproved).toBeNull();
    expect(t.daysSubmitToApprove).toBeNull();
  });

  it("handles empty history", () => {
    const t = computeMilestoneTiming([]);
    expect(t.firstSubmitted).toBeNull();
    expect(t.rejectionCount).toBe(0);
  });
});

describe("median / percentile", () => {
  it("computes median for odd and even counts", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it("computes p75", () => {
    expect(percentile([1, 2, 3, 4], 75)).toBe(3);
    expect(percentile([], 75)).toBeNull();
  });
});

describe("buildUploaderStats", () => {
  const now = new Date("2026-06-12T00:00:00Z");
  const v = (uploadedBy: string | null, uploadedAt: string, dealId: string | null, docName = "Design Plan", version = 1) => ({ uploadedBy, uploadedAt, dealId, docName, version });

  it("groups by uploader with null/empty grouped as Unknown, Unknown sorted last", () => {
    const stats = buildUploaderStats(
      [
        v("lauren@pb.com", "2026-06-01T00:00:00Z", "d1", "Design Plan"),
        v("lauren@pb.com", "2026-06-02T00:00:00Z", "d2", "Photos per Policy"),
        v("layla@pb.com", "2026-06-03T00:00:00Z", "d1", "Utility Bill"),
        v(null, "2026-01-01T00:00:00Z", "d3", "Utility Bill"),
        v("", "2026-01-02T00:00:00Z", null, "Utility Bill"),
      ],
      new Map(),
      now,
    );
    expect(stats.map((s) => s.uploader)).toEqual(["lauren@pb.com", "layla@pb.com", UNKNOWN_UPLOADER]);
    expect(stats[0]).toMatchObject({ total: 2, deals: 2 });
    expect(stats[2]).toMatchObject({ uploader: UNKNOWN_UPLOADER, total: 2, deals: 1 });
  });

  it("counts trailing-8-week uploads separately from all time", () => {
    const stats = buildUploaderStats(
      [
        v("a@pb.com", "2026-06-10T00:00:00Z", "d1", "Design Plan"),
        v("a@pb.com", "2026-01-10T00:00:00Z", "d2", "Photos per Policy"),
      ],
      new Map(),
      now,
    );
    expect(stats[0].total).toBe(2);
    expect(stats[0].last8w).toBe(1);
  });

  it("ties broken alphabetically, empty input yields empty output", () => {
    expect(buildUploaderStats([], new Map(), now)).toEqual([]);
    const stats = buildUploaderStats(
      [
        v("b@pb.com", "2026-06-01T00:00:00Z", "d1"),
        v("a@pb.com", "2026-06-01T00:00:00Z", "d2"),
      ],
      new Map(),
      now,
    );
    expect(stats.map((s) => s.uploader)).toEqual(["a@pb.com", "b@pb.com"]);
  });

  it("attributes a doc's outcome to whoever uploaded its latest version", () => {
    const status = new Map([
      ["d1|Design Plan", "APPROVED"],
      ["d2|Photos per Policy", "ACTION_REQUIRED"],
      ["d3|Utility Bill", "UNDER_REVIEW"],
    ]);
    const stats = buildUploaderStats(
      [
        // d1 Design Plan: a uploaded v1 (rejected then), b uploaded v2 (now APPROVED) -> b owns it
        v("a@pb.com", "2026-05-01T00:00:00Z", "d1", "Design Plan", 1),
        v("b@pb.com", "2026-06-01T00:00:00Z", "d1", "Design Plan", 2),
        v("a@pb.com", "2026-06-02T00:00:00Z", "d2", "Photos per Policy", 1), // rejected
        v("a@pb.com", "2026-06-03T00:00:00Z", "d3", "Utility Bill", 1), // in review
      ],
      status,
      now,
    );
    const a = stats.find((s) => s.uploader === "a@pb.com");
    const b = stats.find((s) => s.uploader === "b@pb.com");
    // b owns the approved d1; a owns the rejected d2 and in-review d3
    expect(b).toMatchObject({ docsOwned: 1, approved: 1, rejected: 0, inReview: 0 });
    expect(a).toMatchObject({ docsOwned: 2, approved: 0, rejected: 1, inReview: 1 });
  });

  it("docs with no status or NOT_UPLOADED count toward docsOwned but no outcome bucket", () => {
    const stats = buildUploaderStats(
      [
        v("a@pb.com", "2026-06-01T00:00:00Z", "d1", "Design Plan", 1),
        v("a@pb.com", "2026-06-01T00:00:00Z", "d2", "Utility Bill", 1),
      ],
      new Map([["d1|Design Plan", "NOT_UPLOADED"]]),
      now,
    );
    const a = stats[0];
    expect(a.docsOwned).toBe(2);
    expect(a.approved + a.rejected + a.inReview).toBe(0);
  });
});
