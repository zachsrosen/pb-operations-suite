// Mock modules that require runtime dependencies (Prisma client), matching
// pe-api-sync-status.test.ts — the helper under test is pure and touches neither.
jest.mock("@/lib/db", () => ({ prisma: null }));
jest.mock("@/lib/pe-scraper-sync", () => ({
  buildPeDealMap: jest.fn(),
  matchProjectToDeal: jest.fn(),
}));

import { latestVersionUploadByDoc, selectSupersededItemIds } from "@/lib/pe-api-sync";

/**
 * Option B — resolve PE action items superseded by a newer document version.
 *
 * The sync resolves an open PeActionItem when its `actionDate` predates the
 * doc's latest version upload. `latestVersionUploadByDoc` computes that per-doc
 * "latest upload" watermark from the version-upsert ops. These tests pin the
 * watermark logic that drives the resolve WHERE clause
 * (`actionDate < latestUpload`).
 */
describe("latestVersionUploadByDoc", () => {
  const d = (iso: string) => new Date(iso);

  it("keeps the latest upload per (dealId, docName)", () => {
    const map = latestVersionUploadByDoc([
      { dealId: "1", docName: "Signed Proposal", uploadedAt: d("2026-06-01T00:00:00Z") },
      { dealId: "1", docName: "Signed Proposal", uploadedAt: d("2026-06-10T00:00:00Z") },
      { dealId: "1", docName: "Signed Proposal", uploadedAt: d("2026-06-05T00:00:00Z") },
    ]);
    expect(map.size).toBe(1);
    expect(map.get("1::Signed Proposal")).toEqual(d("2026-06-10T00:00:00Z"));
  });

  it("separates different docs and different deals", () => {
    const map = latestVersionUploadByDoc([
      { dealId: "1", docName: "Signed Proposal", uploadedAt: d("2026-06-10T00:00:00Z") },
      { dealId: "1", docName: "State Disclosures", uploadedAt: d("2026-06-02T00:00:00Z") },
      { dealId: "2", docName: "Signed Proposal", uploadedAt: d("2026-06-03T00:00:00Z") },
    ]);
    expect(map.size).toBe(3);
    expect(map.get("1::Signed Proposal")).toEqual(d("2026-06-10T00:00:00Z"));
    expect(map.get("1::State Disclosures")).toEqual(d("2026-06-02T00:00:00Z"));
    expect(map.get("2::Signed Proposal")).toEqual(d("2026-06-03T00:00:00Z"));
  });

  it("skips versions with a null dealId (unmatched projects own no action items)", () => {
    const map = latestVersionUploadByDoc([
      { dealId: null, docName: "Signed Proposal", uploadedAt: d("2026-06-10T00:00:00Z") },
      { dealId: "1", docName: "Signed Proposal", uploadedAt: d("2026-06-01T00:00:00Z") },
    ]);
    expect(map.size).toBe(1);
    expect(map.has("1::Signed Proposal")).toBe(true);
  });

  it("returns an empty map for no versions", () => {
    expect(latestVersionUploadByDoc([]).size).toBe(0);
  });

  it("watermark correctly classifies prior-cycle vs current-cycle action items", () => {
    // A doc resubmitted at 06-10: an item flagged 06-03 (before) is superseded;
    // an item flagged 06-12 (after re-review) is current. The resolve WHERE uses
    // actionDate < watermark, so only the 06-03 item resolves.
    const watermark = latestVersionUploadByDoc([
      { dealId: "1", docName: "Signed Proposal", uploadedAt: d("2026-06-01T00:00:00Z") },
      { dealId: "1", docName: "Signed Proposal", uploadedAt: d("2026-06-10T00:00:00Z") },
    ]).get("1::Signed Proposal")!;

    const priorCycle = d("2026-06-03T00:00:00Z");
    const currentCycle = d("2026-06-12T00:00:00Z");
    expect(priorCycle.getTime() < watermark.getTime()).toBe(true); // resolved
    expect(currentCycle.getTime() < watermark.getTime()).toBe(false); // kept open
  });

  it("does not resolve items on a single-version doc (never resubmitted)", () => {
    // Only one upload → its own review items (dated after the upload) stay open.
    const watermark = latestVersionUploadByDoc([
      { dealId: "1", docName: "Signed Proposal", uploadedAt: d("2026-06-01T00:00:00Z") },
    ]).get("1::Signed Proposal")!;
    const reviewItem = d("2026-06-04T00:00:00Z"); // flagged after the only upload
    expect(reviewItem.getTime() < watermark.getTime()).toBe(false); // kept open
  });
});

/**
 * selectSupersededItemIds — the current-cycle gate. An item is resolved only
 * when its doc ALSO has an item dated at/after the latest upload. That gate is
 * what prevents pe_doc_*_notes from ever clearing to empty (old→new only, never
 * old→empty→new), so the rejection-notifier workflow's fire behavior is unchanged.
 */
describe("selectSupersededItemIds", () => {
  const d = (iso: string) => new Date(iso);
  const upload = (dealId: string, docName: string, iso: string) =>
    latestVersionUploadByDoc([{ dealId, docName, uploadedAt: d(iso) }]);

  it("resolves the prior-cycle item when a current-cycle item exists (Rooney)", () => {
    // Signed Proposal resubmitted 06-10; old NAD note (06-03) + new Load
    // Justification note (06-12). Only the old one is superseded.
    const ids = selectSupersededItemIds(
      [
        { id: "old", dealId: "1", docLabel: "Signed Proposal", actionDate: d("2026-06-03T00:00:00Z") },
        { id: "new", dealId: "1", docLabel: "Signed Proposal", actionDate: d("2026-06-12T00:00:00Z") },
      ],
      upload("1", "Signed Proposal", "2026-06-10T00:00:00Z"),
    );
    expect(ids).toEqual(["old"]);
  });

  it("resolves nothing when the doc is resubmitted but not yet re-reviewed", () => {
    // New version at 06-10, but every open item predates it → no current-cycle
    // item → keep the prior note (do NOT clear to empty).
    const ids = selectSupersededItemIds(
      [
        { id: "a", dealId: "1", docLabel: "Signed Proposal", actionDate: d("2026-06-03T00:00:00Z") },
        { id: "b", dealId: "1", docLabel: "Signed Proposal", actionDate: d("2026-06-05T00:00:00Z") },
      ],
      upload("1", "Signed Proposal", "2026-06-10T00:00:00Z"),
    );
    expect(ids).toEqual([]);
  });

  it("resolves nothing for a doc with no version info", () => {
    const ids = selectSupersededItemIds(
      [{ id: "a", dealId: "1", docLabel: "State Disclosures", actionDate: d("2026-06-03T00:00:00Z") }],
      upload("1", "Signed Proposal", "2026-06-10T00:00:00Z"), // different doc
    );
    expect(ids).toEqual([]);
  });

  it("skips items with a null dealId", () => {
    const ids = selectSupersededItemIds(
      [
        { id: "x", dealId: null, docLabel: "Signed Proposal", actionDate: d("2026-06-03T00:00:00Z") },
        { id: "new", dealId: null, docLabel: "Signed Proposal", actionDate: d("2026-06-12T00:00:00Z") },
      ],
      upload("1", "Signed Proposal", "2026-06-10T00:00:00Z"),
    );
    expect(ids).toEqual([]);
  });

  it("resolves nothing for a single item dated after the upload (current only)", () => {
    const ids = selectSupersededItemIds(
      [{ id: "only", dealId: "1", docLabel: "Signed Proposal", actionDate: d("2026-06-12T00:00:00Z") }],
      upload("1", "Signed Proposal", "2026-06-10T00:00:00Z"),
    );
    expect(ids).toEqual([]);
  });

  it("isolates docs — one doc's current item does not resolve another doc's items", () => {
    const latest = latestVersionUploadByDoc([
      { dealId: "1", docName: "Signed Proposal", uploadedAt: d("2026-06-10T00:00:00Z") },
      { dealId: "1", docName: "State Disclosures", uploadedAt: d("2026-06-10T00:00:00Z") },
    ]);
    const ids = selectSupersededItemIds(
      [
        // Signed Proposal: has a current item → its old item resolves.
        { id: "sp-old", dealId: "1", docLabel: "Signed Proposal", actionDate: d("2026-06-03T00:00:00Z") },
        { id: "sp-new", dealId: "1", docLabel: "Signed Proposal", actionDate: d("2026-06-12T00:00:00Z") },
        // State Disclosures: only an old item → kept.
        { id: "sd-old", dealId: "1", docLabel: "State Disclosures", actionDate: d("2026-06-03T00:00:00Z") },
      ],
      latest,
    );
    expect(ids).toEqual(["sp-old"]);
  });
});
