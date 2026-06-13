import {
  buildSwapGraph,
  buildRejectionReasons,
  buildReworkTimeline,
  buildPeReworkPayload,
  weekStartMondayUTC,
  type ReworkVersionInput,
  type ReworkActionInput,
  type ReworkReviewInput,
} from "@/lib/pe-rework";
import { UNKNOWN_UPLOADER } from "@/lib/pe-analytics";

const v = (
  proj: string, doc: string, version: number, by: string | null, at: string, dealId: string | null = "D1",
): ReworkVersionInput => ({ peProjectId: proj, dealId, docName: doc, version, uploadedBy: by, uploadedAt: at });

const a = (proj: string, label: string, notes: string | null, at: string): ReworkActionInput => ({
  peProjectId: proj, docLabel: label, notes, actionDate: at,
});

const r = (dealId: string, docName: string, status: string): ReworkReviewInput => ({ dealId, docName, status });

describe("buildSwapGraph", () => {
  it("counts a cross-person swap and attributes it to the replacer", () => {
    const versions = [
      v("P1", "Design Plan", 1, "alice@x.com", "2026-05-01T00:00:00Z"),
      v("P1", "Design Plan", 2, "bob@x.com", "2026-05-10T00:00:00Z"),
    ];
    const g = buildSwapGraph(versions, [], [r("D1", "Design Plan", "APPROVED")]);
    expect(g.totalSwaps).toBe(1);
    const bob = g.byReplacer.find((s) => s.uploader === "bob@x.com")!;
    expect(bob.total).toBe(1);
    expect(bob.whose).toEqual([{ uploader: "alice@x.com", count: 1 }]);
    expect(bob.outcomes.approved).toBe(1);
  });

  it("tags a swap rejection-driven when a rejection lands in the replaced version's window", () => {
    const versions = [
      v("P1", "Photos per Policy", 1, "alice@x.com", "2026-05-01T00:00:00Z"),
      v("P1", "Photos per Policy", 2, "bob@x.com", "2026-05-10T00:00:00Z"),
    ];
    const actions = [a("P1", "Photos per Policy", "[H107] missing photo", "2026-05-05T00:00:00Z")];
    const g = buildSwapGraph(versions, actions, [r("D1", "Photos per Policy", "UNDER_REVIEW")]);
    const bob = g.byReplacer.find((s) => s.uploader === "bob@x.com")!;
    expect(bob.rejected).toBe(1);
    expect(bob.voluntary).toBe(0);
    expect(g.rejectedSwaps).toBe(1);
    expect(bob.outcomes.under_review).toBe(1);
  });

  it("treats a swap with no rejection in-window as voluntary", () => {
    const versions = [
      v("P1", "Utility Bill", 1, "alice@x.com", "2026-05-01T00:00:00Z"),
      v("P1", "Utility Bill", 2, "bob@x.com", "2026-05-02T00:00:00Z"),
    ];
    // rejection happened AFTER bob's upload — not in alice's window
    const actions = [a("P1", "Utility Bill", "[H023] missing", "2026-05-09T00:00:00Z")];
    const g = buildSwapGraph(versions, actions, [r("D1", "Utility Bill", "APPROVED")]);
    const bob = g.byReplacer.find((s) => s.uploader === "bob@x.com")!;
    expect(bob.voluntary).toBe(1);
    expect(bob.rejected).toBe(0);
  });

  it("counts same-person re-uploads as self-revisions, not swaps", () => {
    const versions = [
      v("P1", "Design Plan", 1, "alice@x.com", "2026-05-01T00:00:00Z"),
      v("P1", "Design Plan", 2, "alice@x.com", "2026-05-03T00:00:00Z"),
    ];
    const g = buildSwapGraph(versions, [], []);
    expect(g.totalSwaps).toBe(0);
    expect(g.selfRevisions).toBe(1);
  });

  it("marks a mid-chain swap superseded_again when a later version replaces it", () => {
    const versions = [
      v("P1", "Design Plan", 1, "alice@x.com", "2026-05-01T00:00:00Z"),
      v("P1", "Design Plan", 2, "bob@x.com", "2026-05-02T00:00:00Z"), // bob's version later replaced
      v("P1", "Design Plan", 3, "carol@x.com", "2026-05-03T00:00:00Z"),
    ];
    const g = buildSwapGraph(versions, [], [r("D1", "Design Plan", "APPROVED")]);
    const bob = g.byReplacer.find((s) => s.uploader === "bob@x.com")!;
    const carol = g.byReplacer.find((s) => s.uploader === "carol@x.com")!;
    expect(bob.outcomes.superseded_again).toBe(1); // bob got replaced by carol
    expect(carol.outcomes.approved).toBe(1); // carol's is final + approved
  });

  it("groups null uploaders under UNKNOWN_UPLOADER", () => {
    const versions = [
      v("P1", "Design Plan", 1, null, "2026-05-01T00:00:00Z"),
      v("P1", "Design Plan", 2, "bob@x.com", "2026-05-02T00:00:00Z"),
    ];
    const g = buildSwapGraph(versions, [], [r("D1", "Design Plan", "APPROVED")]);
    const bob = g.byReplacer.find((s) => s.uploader === "bob@x.com")!;
    expect(bob.whose).toEqual([{ uploader: UNKNOWN_UPLOADER, count: 1 }]);
  });

  it("normalizes the Conditional Waiver label mismatch when matching rejections", () => {
    const versions = [
      v("P1", "Conditional Waiver — Final Payment", 1, "alice@x.com", "2026-05-01T00:00:00Z"),
      v("P1", "Conditional Waiver — Final Payment", 2, "bob@x.com", "2026-05-10T00:00:00Z"),
    ];
    const actions = [a("P1", "Conditional Waiver/Release on Final Payment", "[H114] amount", "2026-05-05T00:00:00Z")];
    const g = buildSwapGraph(versions, actions, []);
    expect(g.rejectedSwaps).toBe(1);
  });
});

describe("buildRejectionReasons", () => {
  it("parses H-codes and labels, counts per code, and de-dupes within one note", () => {
    const actions = [
      a("P1", "Photos per Policy", "[H107] MISS-PHOTO-REQUIRED: missing photo", "2026-05-05T00:00:00Z"),
      a("P2", "Photos per Policy", "H107] MISS-PHOTO-REQUIRED again", "2026-05-06T00:00:00Z"),
      a("P3", "Customer Agreement (PPA/ESA)", "Page 1 [H060] INCOR-LEASE-TYPE and also [H060] repeated", "2026-05-07T00:00:00Z"),
      a("P4", "Utility Bill", "no code here", "2026-05-08T00:00:00Z"),
    ];
    const res = buildRejectionReasons(actions);
    expect(res.totalActionItems).toBe(4);
    expect(res.withCode).toBe(3);
    const h107 = res.codes.find((c) => c.code === "H107")!;
    expect(h107.count).toBe(2);
    expect(h107.label).toBe("MISS-PHOTO-REQUIRED");
    const h060 = res.codes.find((c) => c.code === "H060")!;
    expect(h060.count).toBe(1); // de-duped within the single note
    expect(res.codes[0].code).toBe("H107"); // sorted by count desc
  });

  it("aggregates rejections by doc type with the label fix", () => {
    const actions = [
      a("P1", "Photos per Policy", "x", "2026-05-05T00:00:00Z"),
      a("P2", "Photos per Policy", "y", "2026-05-06T00:00:00Z"),
      a("P3", "Conditional Waiver/Release on Final Payment", "z", "2026-05-07T00:00:00Z"),
    ];
    const res = buildRejectionReasons(actions);
    expect(res.byDoc[0]).toEqual({ docName: "Photos per Policy", count: 2 });
    expect(res.byDoc.find((d) => d.docName === "Conditional Waiver — Final Payment")!.count).toBe(1);
  });
});

describe("buildReworkTimeline", () => {
  it("buckets rejections and resubmissions into Monday weeks", () => {
    const versions = [
      v("P1", "Design Plan", 1, "alice@x.com", "2026-05-04T00:00:00Z"), // v1 = not a resubmission
      v("P1", "Design Plan", 2, "bob@x.com", "2026-05-06T00:00:00Z"), // Wed → week of Mon 2026-05-04
    ];
    const actions = [a("P1", "Design Plan", "[H106]", "2026-05-05T00:00:00Z")];
    const tl = buildReworkTimeline(versions, actions);
    const wk = tl.find((w) => w.weekStart === "2026-05-04")!;
    expect(wk.rejections).toBe(1);
    expect(wk.resubmissions).toBe(1);
  });
});

describe("weekStartMondayUTC", () => {
  it("maps any day to its Monday", () => {
    expect(weekStartMondayUTC(new Date("2026-05-06T12:00:00Z"))).toBe("2026-05-04"); // Wed → Mon
    expect(weekStartMondayUTC(new Date("2026-05-04T00:00:00Z"))).toBe("2026-05-04"); // Mon → Mon
    expect(weekStartMondayUTC(new Date("2026-05-10T23:00:00Z"))).toBe("2026-05-04"); // Sun → prior Mon
  });
});

describe("buildPeReworkPayload", () => {
  it("assembles all three sections with a fixed generatedAt", () => {
    const versions = [
      v("P1", "Design Plan", 1, "alice@x.com", "2026-05-01T00:00:00Z"),
      v("P1", "Design Plan", 2, "bob@x.com", "2026-05-10T00:00:00Z"),
    ];
    const payload = buildPeReworkPayload(versions, [], [r("D1", "Design Plan", "APPROVED")], new Date("2026-06-13T00:00:00Z"));
    expect(payload.swaps.totalSwaps).toBe(1);
    expect(payload.reasons.totalActionItems).toBe(0);
    expect(payload.timeline.length).toBeGreaterThan(0);
    expect(payload.generatedAt).toBe("2026-06-13T00:00:00.000Z");
  });
});
