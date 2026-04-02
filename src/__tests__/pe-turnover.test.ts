/**
 * Tests for PE Turnover helpers — pure logic only (no Drive/HubSpot API calls).
 */
import {
  filterChecklist,
  matchFileToItem,
  resolveCombinedFiles,
  inferMilestone,
  isMilestoneTerminal,
  generateTextReport,
  buildAuditResult,
  PE_M1_CHECKLIST,
  PE_M2_CHECKLIST,
} from "@/lib/pe-turnover";
import type {
  ChecklistItem,
  ChecklistResult,
} from "@/lib/pe-turnover";

// ---------------------------------------------------------------------------
// filterChecklist
// ---------------------------------------------------------------------------

describe("filterChecklist", () => {
  it("returns all items for solar+battery", () => {
    const filtered = filterChecklist(PE_M1_CHECKLIST, "solar+battery");
    // solar+battery includes everything
    expect(filtered.length).toBe(PE_M1_CHECKLIST.length);
  });

  it("excludes battery-only items for solar projects", () => {
    const filtered = filterChecklist(PE_M1_CHECKLIST, "solar");
    const batteryOnly = PE_M1_CHECKLIST.filter(
      (item) => !item.appliesTo.includes("solar")
    );
    expect(filtered.length).toBe(PE_M1_CHECKLIST.length - batteryOnly.length);
  });

  it("excludes solar-only items for battery projects", () => {
    const filtered = filterChecklist(PE_M1_CHECKLIST, "battery");
    const solarOnly = PE_M1_CHECKLIST.filter(
      (item) => !item.appliesTo.includes("battery")
    );
    expect(filtered.length).toBe(PE_M1_CHECKLIST.length - solarOnly.length);
  });

  it("filters M2 checklist the same way", () => {
    const filtered = filterChecklist(PE_M2_CHECKLIST, "solar");
    expect(filtered.length).toBeGreaterThan(0);
    for (const item of filtered) {
      expect(item.appliesTo).toContain("solar");
    }
  });
});

// ---------------------------------------------------------------------------
// matchFileToItem
// ---------------------------------------------------------------------------

describe("matchFileToItem", () => {
  const makeItem = (hints: string[]): ChecklistItem => ({
    id: "test.item",
    label: "Test Item",
    category: "test",
    milestone: "m1",
    appliesTo: ["solar", "battery", "solar+battery"],
    driveFolders: ["0"],
    searchAllFolders: false,
    fileHints: hints,
    isPhoto: false,
  });

  const makeFile = (name: string, modifiedTime?: string) => ({
    id: `file-${name}`,
    name,
    mimeType: "application/pdf",
    modifiedTime: modifiedTime ?? "2026-03-15T12:00:00Z",
    size: "1024",
  });

  it("matches exact hint (case-insensitive)", () => {
    const item = makeItem(["customer agreement"]);
    const files = [makeFile("Customer Agreement.pdf")];
    expect(matchFileToItem(item, files)).toBeTruthy();
    expect(matchFileToItem(item, files)?.name).toBe("Customer Agreement.pdf");
  });

  it("matches with underscores replacing spaces", () => {
    const item = makeItem(["customer agreement"]);
    const files = [makeFile("customer_agreement_signed.pdf")];
    expect(matchFileToItem(item, files)).toBeTruthy();
  });

  it("matches with hyphens replacing spaces", () => {
    const item = makeItem(["customer agreement"]);
    const files = [makeFile("customer-agreement-v2.pdf")];
    expect(matchFileToItem(item, files)).toBeTruthy();
  });

  it("returns null when no match", () => {
    const item = makeItem(["customer agreement"]);
    const files = [makeFile("invoice.pdf"), makeFile("receipt.pdf")];
    expect(matchFileToItem(item, files)).toBeNull();
  });

  it("picks the most recently modified file when multiple match", () => {
    const item = makeItem(["proposal"]);
    const files = [
      makeFile("proposal_v1.pdf", "2026-01-01T00:00:00Z"),
      makeFile("proposal_v2.pdf", "2026-03-15T00:00:00Z"),
      makeFile("proposal_draft.pdf", "2026-02-01T00:00:00Z"),
    ];
    const result = matchFileToItem(item, files);
    expect(result?.name).toBe("proposal_v2.pdf");
  });

  it("matches multiple hints (any hint matches)", () => {
    const item = makeItem(["contract_package", "customer agreement"]);
    const files = [makeFile("contract_package.pdf")];
    expect(matchFileToItem(item, files)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// resolveCombinedFiles
// ---------------------------------------------------------------------------

describe("resolveCombinedFiles", () => {
  it("propagates found status across combinedWith group", () => {
    const items: ChecklistItem[] = [
      {
        id: "a",
        label: "Item A",
        category: "contract",
        milestone: "m1",
        appliesTo: ["solar", "battery", "solar+battery"],
        driveFolders: ["0"],
        searchAllFolders: false,
        fileHints: ["contract_package"],
        combinedWith: ["b", "c"],
        isPhoto: false,
      },
      {
        id: "b",
        label: "Item B",
        category: "contract",
        milestone: "m1",
        appliesTo: ["solar", "battery", "solar+battery"],
        driveFolders: ["0"],
        searchAllFolders: false,
        fileHints: ["installation_order"],
        combinedWith: ["a", "c"],
        isPhoto: false,
      },
      {
        id: "c",
        label: "Item C",
        category: "contract",
        milestone: "m1",
        appliesTo: ["solar", "battery", "solar+battery"],
        driveFolders: ["0"],
        searchAllFolders: false,
        fileHints: ["disclosures"],
        combinedWith: ["a", "b"],
        isPhoto: false,
      },
    ];

    const foundFile = {
      name: "contract_package.pdf",
      id: "file-1",
      url: "https://drive.google.com/file/d/file-1/view",
      modifiedTime: "2026-03-15T12:00:00Z",
      size: 2048,
    };

    const results: ChecklistResult[] = [
      { item: items[0], status: "found", foundFile },
      { item: items[1], status: "missing" },
      { item: items[2], status: "missing" },
    ];

    const resolved = resolveCombinedFiles(results);
    expect(resolved[0].status).toBe("found");
    expect(resolved[1].status).toBe("found");
    expect(resolved[1].combinedFile).toBe(true);
    expect(resolved[2].status).toBe("found");
    expect(resolved[2].combinedFile).toBe(true);
  });

  it("does not propagate when no item in group is found", () => {
    const items: ChecklistItem[] = [
      {
        id: "a",
        label: "Item A",
        category: "test",
        milestone: "m1",
        appliesTo: ["solar", "battery", "solar+battery"],
        driveFolders: ["0"],
        searchAllFolders: false,
        fileHints: ["foo"],
        combinedWith: ["b"],
        isPhoto: false,
      },
      {
        id: "b",
        label: "Item B",
        category: "test",
        milestone: "m1",
        appliesTo: ["solar", "battery", "solar+battery"],
        driveFolders: ["0"],
        searchAllFolders: false,
        fileHints: ["bar"],
        combinedWith: ["a"],
        isPhoto: false,
      },
    ];

    const results: ChecklistResult[] = [
      { item: items[0], status: "missing" },
      { item: items[1], status: "missing" },
    ];

    const resolved = resolveCombinedFiles(results);
    expect(resolved[0].status).toBe("missing");
    expect(resolved[1].status).toBe("missing");
  });
});

// ---------------------------------------------------------------------------
// inferMilestone
// ---------------------------------------------------------------------------

describe("inferMilestone", () => {
  it("maps Construction to m1", () => {
    expect(inferMilestone("Construction")).toEqual({ milestone: "m1", isTerminal: false });
  });

  it("maps Inspection to m1", () => {
    expect(inferMilestone("Inspection")).toEqual({ milestone: "m1", isTerminal: false });
  });

  it("maps Permission To Operate to m2", () => {
    expect(inferMilestone("Permission To Operate")).toEqual({ milestone: "m2", isTerminal: false });
  });

  it("maps Close Out to m2", () => {
    expect(inferMilestone("Close Out")).toEqual({ milestone: "m2", isTerminal: false });
  });

  it("marks Project Complete as terminal", () => {
    expect(inferMilestone("Project Complete")).toEqual({ milestone: null, isTerminal: true });
  });

  it("marks Cancelled as terminal", () => {
    expect(inferMilestone("Cancelled")).toEqual({ milestone: null, isTerminal: true });
  });

  it("defaults unknown stages to m1", () => {
    expect(inferMilestone("Some Unknown Stage")).toEqual({ milestone: "m1", isTerminal: false });
  });
});

// ---------------------------------------------------------------------------
// isMilestoneTerminal
// ---------------------------------------------------------------------------

describe("isMilestoneTerminal", () => {
  it("returns true for Submitted", () => {
    expect(isMilestoneTerminal("Submitted")).toBe(true);
  });

  it("returns true for Approved", () => {
    expect(isMilestoneTerminal("Approved")).toBe(true);
  });

  it("returns true for Paid", () => {
    expect(isMilestoneTerminal("Paid")).toBe(true);
  });

  it("returns false for Ready to Submit", () => {
    expect(isMilestoneTerminal("Ready to Submit")).toBe(false);
  });

  it("returns false for null", () => {
    expect(isMilestoneTerminal(null)).toBe(false);
  });

  it("returns false for Rejected", () => {
    expect(isMilestoneTerminal("Rejected")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildAuditResult + generateTextReport
// ---------------------------------------------------------------------------

describe("generateTextReport", () => {
  it("produces a readable report with correct summary", () => {
    const results: ChecklistResult[] = [
      {
        item: {
          id: "m1.contract.customer_agreement",
          label: "Countersigned Customer Agreement",
          category: "contract",
          milestone: "m1",
          appliesTo: ["solar", "battery", "solar+battery"],
          driveFolders: ["0"],
          searchAllFolders: false,
          fileHints: ["customer agreement"],
          isPhoto: false,
        },
        status: "found",
        foundFile: {
          name: "contract_package.pdf",
          id: "f1",
          url: "https://drive.google.com/file/d/f1/view",
          modifiedTime: "2026-03-15T12:00:00Z",
          size: 1024,
        },
      },
      {
        item: {
          id: "m1.design.planset",
          label: "Approved Planset",
          category: "design",
          milestone: "m1",
          appliesTo: ["solar", "battery", "solar+battery"],
          driveFolders: ["2"],
          searchAllFolders: false,
          fileHints: ["planset"],
          isPhoto: false,
        },
        status: "missing",
      },
      {
        item: {
          id: "m1.photos.photo1",
          label: "Pre-Installation Site Photo",
          category: "photos",
          milestone: "m1",
          appliesTo: ["solar", "battery", "solar+battery"],
          driveFolders: ["5"],
          searchAllFolders: false,
          fileHints: ["pre_install"],
          isPhoto: true,
          pePhotoNumber: 1,
        },
        status: "not_applicable",
        statusNote: "Battery-only project",
      },
    ];

    const auditResult = buildAuditResult({
      dealId: "12345",
      dealName: "Smith Residence",
      address: "123 Main St, Denver, CO",
      systemType: "solar+battery",
      milestone: "m1",
      peStatus: "Ready to Submit",
      results,
    });

    expect(auditResult.summary.found).toBe(1);
    expect(auditResult.summary.missing).toBe(1);
    expect(auditResult.summary.notApplicable).toBe(1);
    expect(auditResult.summary.ready).toBe(false);
    expect(auditResult.categories).toHaveLength(3);

    const report = generateTextReport(auditResult);
    expect(report).toContain("Smith Residence");
    expect(report).toContain("123 Main St, Denver, CO");
    expect(report).toContain("solar+battery");
    expect(report).toContain("M1 (Inspection Complete)");
    expect(report).toContain("Ready to Submit");
    expect(report).toContain("contract_package.pdf");
    expect(report).toContain("MISSING");
    expect(report).toContain("N/A");
    expect(report).toContain("READY: 1/2");
  });

  it("marks result as ready when all required items are found", () => {
    const results: ChecklistResult[] = [
      {
        item: {
          id: "a",
          label: "Found Item",
          category: "test",
          milestone: "m1",
          appliesTo: ["solar", "battery", "solar+battery"],
          driveFolders: [],
          searchAllFolders: false,
          fileHints: [],
          isPhoto: false,
        },
        status: "found",
        foundFile: {
          name: "file.pdf",
          id: "f1",
          url: "https://example.com",
          modifiedTime: "2026-01-01T00:00:00Z",
          size: 100,
        },
      },
    ];

    const auditResult = buildAuditResult({
      dealId: "1",
      dealName: "Test",
      address: "Test",
      systemType: "solar",
      milestone: "m1",
      peStatus: null,
      results,
    });

    expect(auditResult.summary.ready).toBe(true);
  });
});
