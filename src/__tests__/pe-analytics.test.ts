import {
  weekStartUTC,
  groupForStatus,
  resolveSubmittedOn,
  resolveApprovedOn,
  resolveRejectedOn,
  resolvePaidOn,
  computeMilestoneTiming,
  median,
  percentile,
  buildUploaderStats,
  buildSharedUploaderStats,
  computeSharedOwners,
  buildPaymentOwnership,
  buildPaymentOwnershipFractional,
  buildPaymentOwnershipLast,
  buildPeriodUploads,
  buildDocTypeByUploader,
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

  it("maps the internally-rejected status to its own group", () => {
    expect(groupForStatus("Internally Rejected")).toBe("Internally Rejected");
  });

  it("returns Other for unknown statuses and null for empty", () => {
    expect(groupForStatus("Something New")).toBe("Other");
    expect(groupForStatus(null)).toBeNull();
    expect(groupForStatus("")).toBeNull();
  });
});

describe("resolveSubmittedOn (strict stamped-date)", () => {
  it("returns the stamped submission date when present", () => {
    expect(resolveSubmittedOn("2026-06-09", "Submitted", "2026-06-08")).toBe("2026-06-09");
  });

  it("does NOT fall back to status history — a missing date means not-counted", () => {
    // The phantom case: a status briefly flipped to Submitted/Approved/etc. and
    // reverted leaves an immutable history entry. Without a stamped date we never
    // count it, no matter what the (extra, ignored) status/history args say.
    expect(resolveSubmittedOn(null, "Submitted", "2026-06-16")).toBeNull();
    expect(resolveSubmittedOn(null, "Approved", "2026-05-01")).toBeNull();
    expect(resolveSubmittedOn(null, "Paid", "2026-04-20")).toBeNull();
    expect(resolveSubmittedOn(null, "Rejected", "2026-04-30")).toBeNull();
  });

  it("returns null for blank/empty date", () => {
    expect(resolveSubmittedOn(null)).toBeNull();
    expect(resolveSubmittedOn("")).toBeNull();
    expect(resolveSubmittedOn(undefined)).toBeNull();
  });
});

describe("resolveApprovedOn / resolveRejectedOn / resolvePaidOn (strict stamped-date)", () => {
  it("returns the stamped date when present", () => {
    expect(resolveApprovedOn("2026-06-05")).toBe("2026-06-05");
    expect(resolveRejectedOn("2026-06-04")).toBe("2026-06-04");
    expect(resolvePaidOn("2026-06-18")).toBe("2026-06-18");
  });

  it("returns null when the stamped date is missing — no history fallback", () => {
    for (const fn of [resolveApprovedOn, resolveRejectedOn, resolvePaidOn]) {
      expect(fn(null)).toBeNull();
      expect(fn("")).toBeNull();
      expect(fn(undefined)).toBeNull();
    }
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

  it("owner override moves docsOwned/outcome but keeps upload volume (→ superseded for prev owner)", () => {
    const rows = [
      v("layla@pb.com", "2026-06-01T00:00:00Z", "d1", "Design Plan", 1), // earlier version
      v("wes@pb.com", "2026-06-03T00:00:00Z", "d1", "Design Plan", 2), // latest version (default owner)
    ];
    const status = new Map([["d1|Design Plan", "APPROVED"]]);

    // No override: Wes owns it (latest version), Layla just has an upload.
    const base = buildUploaderStats(rows, status, now);
    const wesBase = base.find((s) => s.uploader === "wes@pb.com")!;
    const laylaBase = base.find((s) => s.uploader === "layla@pb.com")!;
    expect(wesBase).toMatchObject({ total: 1, docsOwned: 1, approved: 1 });
    expect(laylaBase).toMatchObject({ total: 1, docsOwned: 0, approved: 0 });

    // Override credits Layla: ownership moves; Wes keeps his upload → superseded.
    const owner = new Map<string, string | null>([["d1|Design Plan", "layla@pb.com"]]);
    const over = buildUploaderStats(rows, status, now, owner);
    const wes = over.find((s) => s.uploader === "wes@pb.com")!;
    const layla = over.find((s) => s.uploader === "layla@pb.com")!;
    expect(wes).toMatchObject({ total: 1, docsOwned: 0, approved: 0 }); // upload stays, ownership gone
    expect(layla).toMatchObject({ docsOwned: 1, approved: 1 }); // now owns + credited the outcome
    // Wes's superseded = total - (approved+inReview+rejected) = 1 - 0 = 1 (not vanished).
    expect(wes.total - (wes.approved + wes.inReview + wes.rejected)).toBe(1);
  });

  it("shared ownership splits by version count; override pins the whole doc", () => {
    const sv = (uploadedBy: string | null, dealId: string, docName: string, version: number) =>
      ({ uploadedBy, uploadedAt: "2026-06-01T00:00:00Z", dealId, docName, version });
    const rows = [
      sv("a@pb.com", "d1", "Design Plan", 1),
      sv("a@pb.com", "d1", "Design Plan", 2), // a: 2 of 3 tracked versions
      sv("b@pb.com", "d1", "Design Plan", 3), // b: 1 of 3 → a 2/3, b 1/3
      sv("c@pb.com", "d2", "Photos per Policy", 1), // sole → 1.0
    ];
    const status = new Map([["d1|Design Plan", "APPROVED"], ["d2|Photos per Policy", "APPROVED"]]);

    const owners = computeSharedOwners(rows);
    expect(owners.get("d1|Design Plan")).toEqual(expect.arrayContaining([
      { who: "a@pb.com", weight: 2 / 3 }, { who: "b@pb.com", weight: 1 / 3 },
    ]));
    expect(owners.get("d2|Photos per Policy")).toEqual([{ who: "c@pb.com", weight: 1 }]);

    const stats = buildSharedUploaderStats(rows, status, owners, now);
    const a = stats.find((s) => s.uploader === "a@pb.com")!;
    expect(a.docsOwned).toBeCloseTo(2 / 3);
    expect(a.approved).toBeCloseTo(2 / 3);
    expect(a.total).toBe(2); // upload volume unchanged

    // Override pins the whole d1 doc to b — a keeps its uploads but owns 0 of it.
    const pinned = computeSharedOwners(rows, new Map([["d1|Design Plan", "b@pb.com"]]));
    expect(pinned.get("d1|Design Plan")).toEqual([{ who: "b@pb.com", weight: 1 }]);
    const stats2 = buildSharedUploaderStats(rows, status, pinned, now);
    expect(stats2.find((s) => s.uploader === "b@pb.com")!.docsOwned).toBeCloseTo(1);
    expect(stats2.find((s) => s.uploader === "a@pb.com")!.docsOwned).toBe(0);
    expect(stats2.find((s) => s.uploader === "a@pb.com")!.total).toBe(2); // still uploaded
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

describe("buildPaymentOwnership", () => {
  it("credits the milestone to the top KNOWN uploader of its approved docs", () => {
    const status = new Map([
      ["d1|Design Plan", "APPROVED"],
      ["d1|Photos per Policy", "APPROVED"],
      ["d1|Utility Bill", "UNDER_REVIEW"], // not approved → ignored
    ]);
    const latest = new Map<string, string | null>([
      ["d1|Design Plan", "a@pb.com"],
      ["d1|Photos per Policy", null], // Unknown
    ]);
    const { owned } = buildPaymentOwnership(
      [{ dealId: "d1", milestone: "M1", docNames: ["Design Plan", "Photos per Policy", "Utility Bill"], amount: 9000, isApprovedPayment: true, isPaid: false, isPendingPayment: false }],
      status,
      latest,
    );
    // a@pb has 1 approved doc, Unknown has 1 — known wins the tie
    expect(owned.get("a@pb.com")).toEqual({ amount: 9000, count: 1, paidAmount: 0, paidCount: 0, pendingAmount: 0, pendingCount: 0 });
    expect(owned.get(UNKNOWN_UPLOADER)).toBeUndefined();
  });

  it("falls to Unknown only when no approved doc has a known uploader; skips unapproved milestones", () => {
    const status = new Map([["d1|Design Plan", "APPROVED"], ["d2|Design Plan", "APPROVED"]]);
    const latest = new Map<string, string | null>([["d1|Design Plan", null], ["d2|Design Plan", "z@pb.com"]]);
    const { owned } = buildPaymentOwnership(
      [
        { dealId: "d1", milestone: "M1", docNames: ["Design Plan"], amount: 5000, isApprovedPayment: true, isPaid: false, isPendingPayment: false }, // all-unknown
        { dealId: "d2", milestone: "M1", docNames: ["Design Plan"], amount: 7000, isApprovedPayment: false, isPaid: false, isPendingPayment: false }, // not approved → skip
      ],
      status,
      latest,
    );
    expect(owned.get(UNKNOWN_UPLOADER)).toEqual({ amount: 5000, count: 1, paidAmount: 0, paidCount: 0, pendingAmount: 0, pendingCount: 0 });
    expect(owned.get("z@pb.com")).toBeUndefined();
  });

  it("credits a submitted-but-unapproved milestone's $ to the top uploader of its in-review docs", () => {
    const status = new Map([["d1|Design Plan", "UNDER_REVIEW"], ["d1|Photos per Policy", "UPLOADED"]]);
    const latest = new Map<string, string | null>([["d1|Design Plan", "p@pb.com"], ["d1|Photos per Policy", "p@pb.com"]]);
    const { owned } = buildPaymentOwnership(
      [{ dealId: "d1", milestone: "M1", docNames: ["Design Plan", "Photos per Policy"], amount: 8000, isApprovedPayment: false, isPaid: false, isPendingPayment: true }],
      status,
      latest,
    );
    expect(owned.get("p@pb.com")).toEqual({ amount: 0, count: 0, paidAmount: 0, paidCount: 0, pendingAmount: 8000, pendingCount: 1 });
  });

  it("breaks out the paid subset of an approved milestone into paidAmount/paidCount", () => {
    const status = new Map([["d1|Design Plan", "APPROVED"]]);
    const latest = new Map<string, string | null>([["d1|Design Plan", "a@pb.com"]]);
    const { owned } = buildPaymentOwnership(
      [{ dealId: "d1", milestone: "M1", docNames: ["Design Plan"], amount: 6000, isApprovedPayment: true, isPaid: true, isPendingPayment: false }],
      status,
      latest,
    );
    // Paid milestone counts in BOTH the approved total and the paid subset.
    expect(owned.get("a@pb.com")).toEqual({ amount: 6000, count: 1, paidAmount: 6000, paidCount: 1, pendingAmount: 0, pendingCount: 0 });
  });
});

describe("buildPaymentOwnershipLast", () => {
  it("credits the milestone to whoever uploaded its most-recent qualifying doc (not the one who uploaded the most)", () => {
    const status = new Map([
      ["d1|Design Plan", "APPROVED"],
      ["d1|Photos per Policy", "APPROVED"],
      ["d1|Utility Bill", "APPROVED"],
    ]);
    const latest = new Map<string, string | null>([
      ["d1|Design Plan", "a@pb.com"],   // a uploaded 2 docs (would win "majority")
      ["d1|Utility Bill", "a@pb.com"],
      ["d1|Photos per Policy", "b@pb.com"], // b uploaded last
    ]);
    const at = new Map<string, number>([
      ["d1|Design Plan", 100],
      ["d1|Utility Bill", 200],
      ["d1|Photos per Policy", 300], // most recent qualifying upload → b wins the whole $
    ]);
    const { owned } = buildPaymentOwnershipLast(
      [{ dealId: "d1", milestone: "M1", docNames: ["Design Plan", "Photos per Policy", "Utility Bill"], amount: 9000, isApprovedPayment: true, isPaid: false, isPendingPayment: false }],
      status, latest, at,
    );
    expect(owned.get("b@pb.com")).toEqual({ amount: 9000, count: 1, paidAmount: 0, paidCount: 0, pendingAmount: 0, pendingCount: 0 });
    expect(owned.get("a@pb.com")).toBeUndefined();
  });

  it("ignores a more-recent NON-qualifying doc — only qualifying docs count", () => {
    const status = new Map([
      ["d1|Design Plan", "APPROVED"],
      ["d1|Utility Bill", "UNDER_REVIEW"], // not approved → not qualifying for an approved milestone
    ]);
    const latest = new Map<string, string | null>([
      ["d1|Design Plan", "a@pb.com"],
      ["d1|Utility Bill", "b@pb.com"],
    ]);
    const at = new Map<string, number>([
      ["d1|Design Plan", 100],
      ["d1|Utility Bill", 999], // newer, but not approved → excluded
    ]);
    const { owned } = buildPaymentOwnershipLast(
      [{ dealId: "d1", milestone: "M1", docNames: ["Design Plan", "Utility Bill"], amount: 5000, isApprovedPayment: true, isPaid: false, isPendingPayment: false }],
      status, latest, at,
    );
    expect(owned.get("a@pb.com")).toEqual({ amount: 5000, count: 1, paidAmount: 0, paidCount: 0, pendingAmount: 0, pendingCount: 0 });
    expect(owned.get("b@pb.com")).toBeUndefined();
  });
});

describe("buildPaymentOwnershipFractional", () => {
  it("splits a milestone's $ across its approved-doc uploaders by share", () => {
    const status = new Map([
      ["d1|Design Plan", "APPROVED"],
      ["d1|Photos per Policy", "APPROVED"],
      ["d1|Utility Bill", "APPROVED"],
    ]);
    const latest = new Map<string, string | null>([
      ["d1|Design Plan", "a@pb.com"],
      ["d1|Photos per Policy", "a@pb.com"],
      ["d1|Utility Bill", "b@pb.com"],
    ]);
    const { owned } = buildPaymentOwnershipFractional(
      [{ dealId: "d1", milestone: "M1", docNames: ["Design Plan", "Photos per Policy", "Utility Bill"], amount: 9000, isApprovedPayment: true, isPaid: true, isPendingPayment: false }],
      status,
      latest,
    );
    // a uploaded 2/3 of the approved docs → 2/3 of $9,000; b → 1/3.
    expect(owned.get("a@pb.com")).toEqual({ amount: 6000, count: 2 / 3, paidAmount: 6000, paidCount: 2 / 3, pendingAmount: 0, pendingCount: 0 });
    expect(owned.get("b@pb.com")).toEqual({ amount: 3000, count: 1 / 3, paidAmount: 3000, paidCount: 1 / 3, pendingAmount: 0, pendingCount: 0 });
  });
});

describe("buildPeriodUploads", () => {
  const now = new Date("2026-06-13T12:00:00Z");
  const rows = [
    { uploadedAt: "2026-06-12T03:00:00Z", uploadedBy: "a@pb.com" },
    { uploadedAt: "2026-06-12T20:00:00Z", uploadedBy: "a@pb.com" },
    { uploadedAt: "2026-06-12T21:00:00Z", uploadedBy: null },
    { uploadedAt: "2026-06-08T10:00:00Z", uploadedBy: "b@pb.com" }, // same week as 6/12, earlier month-day
    { uploadedAt: "2026-01-05T00:00:00Z", uploadedBy: "a@pb.com" }, // outside 90d day window, but counts for week/month
  ];

  it("day grain keeps the 90-day window, segmented by uploader (Unknown for null)", () => {
    const out = buildPeriodUploads(rows, "day", now);
    expect(out.map((d) => d.day)).toEqual(["2026-06-08", "2026-06-12"]); // Jan dropped (outside 90d)
    const d12 = out.find((d) => d.day === "2026-06-12")!;
    expect(d12.total).toBe(3);
    expect(d12.byUploader).toEqual({ "a@pb.com": 2, [UNKNOWN_UPLOADER]: 1 });
  });

  it("week grain buckets by Monday and spans all time", () => {
    const out = buildPeriodUploads(rows, "week", now);
    // 6/8 (Mon) and 6/12 (Fri) share the week of 2026-06-08; Jan 5 is its own week
    const wk = out.find((d) => d.day === "2026-06-08")!;
    expect(wk.total).toBe(4);
    expect(out.some((d) => d.day === "2026-01-05")).toBe(true); // all-time, not windowed
  });

  it("month grain buckets by YYYY-MM across all time", () => {
    const out = buildPeriodUploads(rows, "month", now);
    expect(out.map((d) => d.day)).toEqual(["2026-01", "2026-06"]);
    expect(out.find((d) => d.day === "2026-06")!.total).toBe(4);
  });
});

describe("buildDocTypeByUploader", () => {
  it("counts distinct docs owned per person by type, latest version wins", () => {
    const rows = [
      { uploadedBy: "a@pb.com", dealId: "d1", docName: "Design Plan", version: 1 },
      { uploadedBy: "b@pb.com", dealId: "d1", docName: "Design Plan", version: 2 }, // supersedes a
      { uploadedBy: "a@pb.com", dealId: "d1", docName: "Photos per Policy", version: 1 },
      { uploadedBy: null, dealId: "d2", docName: "Design Plan", version: 1 },
    ];
    const out = buildDocTypeByUploader(rows);
    const a = out.find((r) => r.uploader === "a@pb.com")!;
    const b = out.find((r) => r.uploader === "b@pb.com")!;
    const u = out.find((r) => r.uploader === UNKNOWN_UPLOADER)!;
    expect(b.byDoc).toEqual({ "Design Plan": 1 }); // owns d1 design (v2)
    expect(a.byDoc).toEqual({ "Photos per Policy": 1 }); // a's design was superseded
    expect(u.byDoc).toEqual({ "Design Plan": 1 });
    expect(out[out.length - 1].uploader).toBe(UNKNOWN_UPLOADER); // Unknown sorted last
  });
});

describe("PRE_SUBMISSION_STATUSES (waiting-on-submission definition)", () => {
  const { PRE_SUBMISSION_STATUSES, isPreSubmissionStatus, groupForStatus } = require("@/lib/pe-analytics");

  it("contains exactly the statuses whose group is Onboarding or Ready to Submit", () => {
    for (const s of PRE_SUBMISSION_STATUSES) {
      const g = groupForStatus(s);
      expect(g === "Onboarding" || g === "Ready to Submit").toBe(true);
    }
    // the 7 known pre-submission statuses
    for (const s of ["Ready to Submit", "Waiting on Information", "Ready for Onboarding",
      "Onboarding Submitted", "Onboarding Rejected", "Onboarding Ready to Resubmit", "Onboarding Resubmitted"]) {
      expect(PRE_SUBMISSION_STATUSES.has(s)).toBe(true);
    }
  });

  it("excludes submitted / rejected / approved / paid statuses", () => {
    for (const s of ["Submitted", "Resubmitted", "Rejected", "Ready to Resubmit", "Approved", "Paid"]) {
      expect(PRE_SUBMISSION_STATUSES.has(s)).toBe(false);
      expect(isPreSubmissionStatus(s)).toBe(false);
    }
  });

  it("treats a null/absent status as pre-submission", () => {
    expect(isPreSubmissionStatus(null)).toBe(true);
    expect(isPreSubmissionStatus(undefined)).toBe(true);
  });
});
