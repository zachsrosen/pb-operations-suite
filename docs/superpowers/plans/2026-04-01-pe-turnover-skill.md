# PE Turnover Readiness Skill — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Claude Code skill and shared library that audits Participate Energy turnover packages against PE's milestone checklists by walking a deal's Google Drive folder tree, matching files by name heuristics, and producing a gap report.

**Architecture:** A shared `lib/pe-turnover.ts` module holds all logic (checklist definitions, deal resolution, Drive file matching, report generation). A thin `SKILL.md` wraps it as a `/pe-turnover` slash command. Three new utility functions are added to `drive-plansets.ts` for general-purpose Drive operations (list subfolders, list all files, download any file).

**Tech Stack:** TypeScript, Google Drive API v3 (via existing `drive-plansets.ts` token management), HubSpot CRM API (via existing `hubspot.ts` client), Claude vision API (for optional photo verification)

**Spec:** `docs/superpowers/specs/2026-03-31-pe-turnover-skill-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `src/lib/drive-plansets.ts` | Add `listDriveSubfolders()`, `listDriveFiles()`, `downloadDriveFile()` |
| Create | `src/lib/pe-turnover.ts` | Checklist definitions, deal resolution, Drive audit, file matching, report generation |
| Create | `.claude/skills/pe-turnover/SKILL.md` | Skill definition — thin wrapper invoking lib functions |
| Create | `src/__tests__/pe-turnover.test.ts` | Unit tests for pure logic (checklist filtering, file matching, report formatting) |

---

## Chunk 1: Drive Utility Functions

### Task 1: Add `listDriveSubfolders()` to drive-plansets.ts

**Files:**
- Modify: `src/lib/drive-plansets.ts` (append at end of file, after `downloadDriveImage` ~line 495)

- [ ] **Step 1: Write the test for listDriveSubfolders**

Create `src/__tests__/pe-turnover.test.ts` with the first test. Since Drive API calls require auth, we test the pure-logic helpers only. For `listDriveSubfolders`, we'll verify it's exported and test the subfolder-matching logic separately in Task 5.

```typescript
/**
 * Tests for PE Turnover helpers — pure logic only (no Drive/HubSpot API calls).
 */
import { extractFolderId } from "@/lib/drive-plansets";

describe("drive-plansets extractFolderId", () => {
  it("extracts folder ID from a Drive URL", () => {
    expect(
      extractFolderId("https://drive.google.com/drive/folders/1abc_DEF-ghi?resourcekey=x")
    ).toBe("1abc_DEF-ghi");
  });

  it("returns bare ID unchanged", () => {
    expect(extractFolderId("1abc_DEF-ghi")).toBe("1abc_DEF-ghi");
  });

  it("returns null for garbage", () => {
    expect(extractFolderId("not a folder")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it passes** (this tests existing code)

Run: `npm test -- --testPathPattern pe-turnover`
Expected: PASS

- [ ] **Step 3: Implement `listDriveSubfolders`**

Append to the end of `src/lib/drive-plansets.ts` (after `downloadDriveImage`, ~line 495). Add a new section:

```typescript
// ---------------------------------------------------------------------------
// General-purpose folder/file listing (used by pe-turnover)
// ---------------------------------------------------------------------------

export interface DriveFolder {
  id: string;
  name: string;
}

/** List immediate subfolders of a Drive folder. */
export async function listDriveSubfolders(folderId: string): Promise<DriveFolder[]> {
  const token = await getDriveToken();

  const query = `'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const fields = "files(id,name)";
  const url =
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}` +
    `&fields=${encodeURIComponent(fields)}` +
    `&pageSize=100` +
    `&supportsAllDrives=true&includeItemsFromAllDrives=true`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Drive API ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as { files?: DriveFolder[] };
  return data.files ?? [];
}
```

- [ ] **Step 4: Verify build passes**

Run: `npx tsc --noEmit --pretty`
Expected: No errors related to `listDriveSubfolders`

- [ ] **Step 5: Commit**

```bash
git add src/lib/drive-plansets.ts src/__tests__/pe-turnover.test.ts
git commit -m "feat(pe-turnover): add listDriveSubfolders utility + initial test file"
```

---

### Task 2: Add `listDriveFiles()` and `downloadDriveFile()` to drive-plansets.ts

**Files:**
- Modify: `src/lib/drive-plansets.ts` (append after `listDriveSubfolders`)

- [ ] **Step 1: Implement `listDriveFiles`**

Add immediately after `listDriveSubfolders`:

```typescript
export interface DriveGenericFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: string;
}

/** List ALL non-folder files in a Drive folder (any type), sorted by modifiedTime desc. */
export async function listDriveFiles(folderId: string): Promise<DriveGenericFile[]> {
  const token = await getDriveToken();

  const query = `'${folderId}' in parents and mimeType!='application/vnd.google-apps.folder' and trashed=false`;
  const fields = "files(id,name,mimeType,modifiedTime,size)";
  const orderBy = "modifiedTime desc";
  const url =
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}` +
    `&fields=${encodeURIComponent(fields)}` +
    `&orderBy=${encodeURIComponent(orderBy)}` +
    `&pageSize=100` +
    `&supportsAllDrives=true&includeItemsFromAllDrives=true`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Drive API ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as { files?: DriveGenericFile[] };
  return data.files ?? [];
}
```

- [ ] **Step 2: Implement `downloadDriveFile`**

Add immediately after `listDriveFiles`:

```typescript
/** Download any file from Drive as a Buffer. For images, prefer downloadDriveImage() for HEIC support. */
export async function downloadDriveFile(fileId: string): Promise<{ buffer: Buffer; filename: string; mimeType: string }> {
  const token = await getDriveToken();

  // Get metadata first for filename
  const metaUrl =
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}` +
    `?fields=name,mimeType&supportsAllDrives=true`;
  const metaRes = await fetch(metaUrl, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!metaRes.ok) throw new Error(`Drive metadata ${metaRes.status}`);
  const meta = (await metaRes.json()) as { name: string; mimeType: string };

  // Download content
  const dlUrl =
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}` +
    `?alt=media&supportsAllDrives=true`;
  const dlRes = await fetch(dlUrl, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!dlRes.ok) throw new Error(`Drive download ${dlRes.status}`);

  const arrayBuffer = await dlRes.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    filename: meta.name,
    mimeType: meta.mimeType,
  };
}
```

- [ ] **Step 3: Verify build passes**

Run: `npx tsc --noEmit --pretty`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/lib/drive-plansets.ts
git commit -m "feat(pe-turnover): add listDriveFiles and downloadDriveFile utilities"
```

---

## Chunk 2: Core Library — Types, Checklists, and File Matching

### Task 3: Create `pe-turnover.ts` with types and checklist definitions

> **Import consolidation note:** This file is built incrementally across Tasks 3-9. Each task adds imports. The executor should maintain a single consolidated import block at the top of `pe-turnover.ts`. By Task 9, the imports should be:
> ```typescript
> import type { DriveGenericFile, DriveFolder, DriveImageFile } from "@/lib/drive-plansets";
> import { extractFolderId, listDriveSubfolders, listDriveFiles, listPlansetPdfs, pickBestPlanset, listDriveImagesRecursive } from "@/lib/drive-plansets";
> import { getDealProperties, DEAL_STAGE_MAP } from "@/lib/hubspot";
> ```

**Files:**
- Create: `src/lib/pe-turnover.ts`

- [ ] **Step 1: Write tests for checklist filtering by system type**

Add to `src/__tests__/pe-turnover.test.ts`:

```typescript
import {
  PE_M1_CHECKLIST,
  PE_M2_CHECKLIST,
  filterChecklist,
  type SystemType,
} from "@/lib/pe-turnover";

describe("PE checklist filtering", () => {
  it("filters M1 checklist for solar-only (excludes storage photos 9-11)", () => {
    const items = filterChecklist(PE_M1_CHECKLIST, "solar");
    const photoNums = items.filter((i) => i.isPhoto).map((i) => i.pePhotoNumber);
    expect(photoNums).toContain(1);
    expect(photoNums).toContain(2);
    expect(photoNums).toContain(3);
    expect(photoNums).not.toContain(9);
    expect(photoNums).not.toContain(10);
    expect(photoNums).not.toContain(11);
  });

  it("filters M1 checklist for battery-only (excludes PV photos 2-5, 7-8)", () => {
    const items = filterChecklist(PE_M1_CHECKLIST, "battery");
    const photoNums = items.filter((i) => i.isPhoto).map((i) => i.pePhotoNumber);
    expect(photoNums).toContain(1);
    expect(photoNums).toContain(6);
    expect(photoNums).toContain(9);
    expect(photoNums).toContain(10);
    expect(photoNums).toContain(11);
    expect(photoNums).not.toContain(2);
    expect(photoNums).not.toContain(3);
  });

  it("includes all 11 photos for solar+battery", () => {
    const items = filterChecklist(PE_M1_CHECKLIST, "solar+battery");
    const photoNums = items.filter((i) => i.isPhoto).map((i) => i.pePhotoNumber);
    expect(photoNums).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("M2 checklist has 5 items regardless of system type", () => {
    expect(filterChecklist(PE_M2_CHECKLIST, "solar").length).toBe(5);
    expect(filterChecklist(PE_M2_CHECKLIST, "battery").length).toBe(5);
    expect(filterChecklist(PE_M2_CHECKLIST, "solar+battery").length).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern pe-turnover`
Expected: FAIL — module `@/lib/pe-turnover` does not exist

- [ ] **Step 3: Implement types and checklist definitions**

Create `src/lib/pe-turnover.ts`:

```typescript
// ---------------------------------------------------------------------------
// PE Turnover Readiness — Types & Checklist Definitions
// ---------------------------------------------------------------------------

export type SystemType = "solar" | "battery" | "solar+battery";
export type Milestone = "m1" | "m2";
export type ChecklistStatus = "found" | "likely" | "missing" | "needs_review" | "not_applicable" | "error";

export interface ChecklistItem {
  id: string;
  label: string;
  category: string;
  milestone: Milestone;
  appliesTo: SystemType[];
  driveFolders: string[];
  searchAllFolders: boolean;
  fileHints: string[];
  combinedWith?: string[];
  isPhoto: boolean;
  pePhotoNumber?: number;
}

export interface ChecklistResult {
  item: ChecklistItem;
  status: ChecklistStatus;
  statusNote?: string;
  foundFile?: {
    name: string;
    id: string;
    url: string;
    modifiedTime: string;
    size: number;
  };
  combinedFile?: boolean;
  visionResult?: {
    status: "pass" | "fail" | "needs_review";
    notes: string;
  };
}

export interface TurnoverAuditResult {
  dealId: string;
  dealName: string;
  address: string;
  systemType: SystemType;
  milestone: Milestone;
  peStatus: string | null;
  categories: {
    name: string;
    label: string;
    items: ChecklistResult[];
    found: number;
    total: number;
  }[];
  summary: {
    totalItems: number;
    found: number;
    missing: number;
    needsReview: number;
    notApplicable: number;
    errors: number;
    ready: boolean;
  };
}

export type TurnoverAuditOutput =
  | TurnoverAuditResult
  | [TurnoverAuditResult, TurnoverAuditResult];

// ---------------------------------------------------------------------------
// HubSpot properties needed for PE turnover
// ---------------------------------------------------------------------------

export const PE_TURNOVER_PROPERTIES = [
  "hs_object_id", "dealname", "dealstage", "pipeline",
  "tags", "is_participate_energy", "participate_energy_status",
  "pe_m1_status", "pe_m2_status",
  "project_type",
  "address_line_1", "city", "state", "postal_code",
  "all_document_parent_folder_id", "design_documents",
  "site_survey_documents", "permit_documents", "g_drive",
  "pb_location",
];

// ---------------------------------------------------------------------------
// Stage-to-milestone mapping
// ---------------------------------------------------------------------------

const STAGE_TO_MILESTONE: Record<string, Milestone> = {
  "Site Survey": "m1",
  "Design & Engineering": "m1",
  "Permitting & Interconnection": "m1",
  "RTB - Blocked": "m1",
  "Ready To Build": "m1",
  "Construction": "m1",
  "Inspection": "m1",
  "Permission To Operate": "m2",
  "Close Out": "m2",
};

const TERMINAL_STAGES = new Set(["Project Complete", "Cancelled", "On Hold"]);
const TERMINAL_PE_STATUSES = new Set(["Submitted", "Approved", "Paid"]);

export function inferMilestone(stageName: string): { milestone: Milestone | null; isTerminal: boolean } {
  if (TERMINAL_STAGES.has(stageName)) return { milestone: null, isTerminal: true };
  return { milestone: STAGE_TO_MILESTONE[stageName] ?? "m1", isTerminal: false };
}

export function isMilestoneTerminal(peStatus: string | null): boolean {
  return peStatus != null && TERMINAL_PE_STATUSES.has(peStatus);
}

// ---------------------------------------------------------------------------
// All system types (used for items that apply to every project)
// ---------------------------------------------------------------------------

const ALL: SystemType[] = ["solar", "battery", "solar+battery"];
const SOLAR: SystemType[] = ["solar", "solar+battery"];
const STORAGE: SystemType[] = ["battery", "solar+battery"];

// ---------------------------------------------------------------------------
// M1 Checklist — Inspection Complete
// ---------------------------------------------------------------------------

export const PE_M1_CHECKLIST: ChecklistItem[] = [
  // --- Contract & Proposal ---
  {
    id: "m1.contract.customer_agreement",
    label: "Countersigned Customer Agreement",
    category: "contract",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: ["0"],
    searchAllFolders: false,
    fileHints: ["customer agreement", "ca_signed", "contract_package", "contract"],
    combinedWith: ["m1.contract.installation_order", "m1.contract.disclosures"],
    isPhoto: false,
  },
  {
    id: "m1.contract.installation_order",
    label: "Countersigned Installation Order",
    category: "contract",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: ["0"],
    searchAllFolders: false,
    fileHints: ["installation order", "io_signed", "contract_package"],
    combinedWith: ["m1.contract.customer_agreement", "m1.contract.disclosures"],
    isPhoto: false,
  },
  {
    id: "m1.contract.disclosures",
    label: "Required Disclosures",
    category: "contract",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: ["0"],
    searchAllFolders: false,
    fileHints: ["disclosure", "contract_package"],
    combinedWith: ["m1.contract.customer_agreement", "m1.contract.installation_order"],
    isPhoto: false,
  },
  {
    id: "m1.contract.proposal",
    label: "Signed Proposal",
    category: "contract",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: ["0"],
    searchAllFolders: false,
    fileHints: ["proposal", "quote"],
    isPhoto: false,
  },
  {
    id: "m1.contract.utility_bill",
    label: "Utility Bill (12mo usage)",
    category: "contract",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: ["0"],
    searchAllFolders: false,
    fileHints: ["utility bill", "utility_bill", "electric bill", "xcel", "usage"],
    isPhoto: false,
  },
  {
    id: "m1.contract.loan_docs",
    label: "Loan Documents (if applicable)",
    category: "contract",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: ["0"],
    searchAllFolders: false,
    fileHints: ["loan", "sunraise", "financing"],
    isPhoto: false,
  },
  {
    id: "m1.contract.incentive_forms",
    label: "Incentive Forms (if applicable)",
    category: "contract",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: ["0", "8"],
    searchAllFolders: false,
    fileHints: ["incentive", "rebate", "3ce", "xcel_rebate"],
    isPhoto: false,
  },

  // --- Design Package ---
  {
    id: "m1.design.planset",
    label: "Final Plan Set",
    category: "design",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: ["2"],
    searchAllFolders: false,
    fileHints: [], // uses pickBestPlanset() instead of hints
    isPhoto: false,
  },

  // --- Photos (PE numbered 1-11) ---
  {
    id: "m1.photos.1_site_address",
    label: "Site address + home",
    category: "photos",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: ["5"],
    searchAllFolders: false,
    fileHints: ["address", "exterior", "front", "street"],
    isPhoto: true,
    pePhotoNumber: 1,
  },
  {
    id: "m1.photos.2_pv_array",
    label: "Wide-angle PV array",
    category: "photos",
    milestone: "m1",
    appliesTo: SOLAR,
    driveFolders: ["5"],
    searchAllFolders: false,
    fileHints: ["array", "modules", "panels", "roof"],
    isPhoto: true,
    pePhotoNumber: 2,
  },
  {
    id: "m1.photos.3_module_nameplate",
    label: "Module nameplate label",
    category: "photos",
    milestone: "m1",
    appliesTo: SOLAR,
    driveFolders: ["5"],
    searchAllFolders: false,
    fileHints: ["nameplate", "label", "serial"],
    isPhoto: true,
    pePhotoNumber: 3,
  },
  {
    id: "m1.photos.4_electrical",
    label: "Wide-angle all electrical",
    category: "photos",
    milestone: "m1",
    appliesTo: SOLAR,
    driveFolders: ["5"],
    searchAllFolders: false,
    fileHints: ["electrical", "equipment", "indoor", "outdoor"],
    isPhoto: true,
    pePhotoNumber: 4,
  },
  {
    id: "m1.photos.5_msp",
    label: "Main service panel (cover off)",
    category: "photos",
    milestone: "m1",
    appliesTo: SOLAR,
    driveFolders: ["5"],
    searchAllFolders: false,
    fileHints: ["msp", "panel", "breaker", "service_panel"],
    isPhoto: true,
    pePhotoNumber: 5,
  },
  {
    id: "m1.photos.6_invoice_bom",
    label: "Invoice & BOM",
    category: "photos",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: ["5", "0"],
    searchAllFolders: false,
    fileHints: ["invoice", "bom", "bill_of_materials"],
    isPhoto: true,
    pePhotoNumber: 6,
  },
  {
    id: "m1.photos.7_inverter",
    label: "Inverter/micro/optimizer model",
    category: "photos",
    milestone: "m1",
    appliesTo: SOLAR,
    driveFolders: ["5"],
    searchAllFolders: false,
    fileHints: ["inverter", "microinverter", "optimizer", "enphase", "solaredge"],
    isPhoto: true,
    pePhotoNumber: 7,
  },
  {
    id: "m1.photos.8_racking",
    label: "Racking parts + markings",
    category: "photos",
    milestone: "m1",
    appliesTo: SOLAR,
    driveFolders: ["5"],
    searchAllFolders: false,
    fileHints: ["racking", "rail", "ironridge", "unirac", "clamp"],
    isPhoto: true,
    pePhotoNumber: 8,
  },
  {
    id: "m1.photos.9_storage_wide",
    label: "Storage wide angle",
    category: "photos",
    milestone: "m1",
    appliesTo: STORAGE,
    driveFolders: ["5"],
    searchAllFolders: false,
    fileHints: ["battery", "storage", "powerwall", "encharge"],
    isPhoto: true,
    pePhotoNumber: 9,
  },
  {
    id: "m1.photos.10_storage_nameplate",
    label: "Storage nameplate & labels",
    category: "photos",
    milestone: "m1",
    appliesTo: STORAGE,
    driveFolders: ["5"],
    searchAllFolders: false,
    fileHints: ["battery_label", "storage_nameplate", "battery_serial"],
    isPhoto: true,
    pePhotoNumber: 10,
  },
  {
    id: "m1.photos.11_storage_controller",
    label: "Storage controller/disconnect",
    category: "photos",
    milestone: "m1",
    appliesTo: STORAGE,
    driveFolders: ["5"],
    searchAllFolders: false,
    fileHints: ["controller", "gateway", "disconnect", "battery_disconnect"],
    isPhoto: true,
    pePhotoNumber: 11,
  },

  // --- Admin ---
  {
    id: "m1.admin.commissioning",
    label: "Commissioning Proof",
    category: "admin",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: ["5", "8"],
    searchAllFolders: false,
    fileHints: ["commissioning", "monitoring", "site_id", "enphase", "solaredge", "tesla_app"],
    isPhoto: false,
  },
  {
    id: "m1.admin.hoa",
    label: "HOA Approval (if applicable)",
    category: "admin",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: ["0"],
    searchAllFolders: true,
    fileHints: ["hoa", "homeowner association"],
    isPhoto: false,
  },

  // --- Post-Install ---
  {
    id: "m1.post_install.attestation",
    label: "Installer Attestation (Exhibit A)",
    category: "post_install",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: [],
    searchAllFolders: true,
    fileHints: ["attestation", "exhibit_a", "installer_attestation"],
    isPhoto: false,
  },
  {
    id: "m1.post_install.acceptance",
    label: "Customer Acceptance Certificate (Exhibit B)",
    category: "post_install",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: [],
    searchAllFolders: true,
    fileHints: ["acceptance", "exhibit_b", "customer_acceptance", "certificate_of_acceptance"],
    isPhoto: false,
  },

  // --- Inspection ---
  {
    id: "m1.inspection.ahj_permit",
    label: "AHJ Signed Final Permit",
    category: "inspection",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: ["6"],
    searchAllFolders: false,
    fileHints: ["inspection", "permit", "inspection_card", "final_inspection", "passed"],
    isPhoto: false,
  },

  // --- Lien ---
  {
    id: "m1.lien.conditional",
    label: "Conditional Progress Lien Waiver",
    category: "lien",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: [],
    searchAllFolders: true,
    fileHints: ["conditional_waiver", "progress_waiver", "conditional_lien"],
    isPhoto: false,
  },
];

// ---------------------------------------------------------------------------
// M2 Checklist — Project Complete
// ---------------------------------------------------------------------------

export const PE_M2_CHECKLIST: ChecklistItem[] = [
  {
    id: "m2.pto.pto_letter",
    label: "PTO Letter",
    category: "pto",
    milestone: "m2",
    appliesTo: ALL,
    driveFolders: ["7"],
    searchAllFolders: false,
    fileHints: ["pto", "permission to operate", "pto_letter"],
    isPhoto: false,
  },
  {
    id: "m2.pto.interconnection",
    label: "Interconnection Agreement",
    category: "pto",
    milestone: "m2",
    appliesTo: ALL,
    driveFolders: ["7"],
    searchAllFolders: false,
    fileHints: ["interconnection", "ia_signed", "net metering", "interconnection_agreement"],
    isPhoto: false,
  },
  {
    id: "m2.warranty.assignment",
    label: "Warranty Assignment",
    category: "warranty",
    milestone: "m2",
    appliesTo: ALL,
    driveFolders: ["7"],
    searchAllFolders: false,
    fileHints: ["warranty", "warranty_assignment"],
    isPhoto: false,
  },
  {
    id: "m2.incentives.documentation",
    label: "Incentive Documentation",
    category: "incentives",
    milestone: "m2",
    appliesTo: ALL,
    driveFolders: ["7", "8"],
    searchAllFolders: false,
    fileHints: ["incentive", "rebate", "approval_letter"],
    isPhoto: false,
  },
  {
    id: "m2.lien.final",
    label: "Final Lien Waiver",
    category: "lien",
    milestone: "m2",
    appliesTo: ALL,
    driveFolders: [],
    searchAllFolders: true,
    fileHints: ["final_waiver", "unconditional_waiver", "final_lien"],
    isPhoto: false,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Filter a checklist to only items that apply to the given system type. */
export function filterChecklist(checklist: ChecklistItem[], systemType: SystemType): ChecklistItem[] {
  return checklist.filter((item) => item.appliesTo.includes(systemType));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern pe-turnover`
Expected: PASS — all checklist filtering tests green

- [ ] **Step 5: Commit**

```bash
git add src/lib/pe-turnover.ts src/__tests__/pe-turnover.test.ts
git commit -m "feat(pe-turnover): add types, M1/M2 checklists, filtering, stage mapping"
```

---

### Task 4: Implement file matching logic

**Files:**
- Modify: `src/lib/pe-turnover.ts`
- Modify: `src/__tests__/pe-turnover.test.ts`

- [ ] **Step 1: Write tests for `matchFileToItem`**

Add to `src/__tests__/pe-turnover.test.ts`:

```typescript
import { matchFileToItem, type ChecklistItem } from "@/lib/pe-turnover";

const makeItem = (hints: string[], id = "test"): ChecklistItem => ({
  id,
  label: "Test",
  category: "test",
  milestone: "m1",
  appliesTo: ["solar", "battery", "solar+battery"],
  driveFolders: [],
  searchAllFolders: false,
  fileHints: hints,
  isPhoto: false,
});

describe("matchFileToItem", () => {
  it("matches by case-insensitive substring", () => {
    const item = makeItem(["customer agreement"]);
    const files = [
      { name: "PE_Customer_Agreement_Smith.pdf", id: "f1", mimeType: "application/pdf", modifiedTime: "2026-01-01T00:00:00Z", size: "100" },
    ];
    const result = matchFileToItem(item, files);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("PE_Customer_Agreement_Smith.pdf");
  });

  it("returns null when no hints match", () => {
    const item = makeItem(["pto", "permission to operate"]);
    const files = [
      { name: "Utility_Bill.pdf", id: "f1", mimeType: "application/pdf", modifiedTime: "2026-01-01T00:00:00Z", size: "100" },
    ];
    expect(matchFileToItem(item, files)).toBeNull();
  });

  it("picks most recently modified when multiple match", () => {
    const item = makeItem(["proposal"]);
    const files = [
      { name: "Proposal_v1.pdf", id: "old", mimeType: "application/pdf", modifiedTime: "2025-01-01T00:00:00Z", size: "100" },
      { name: "Proposal_v3.pdf", id: "new", mimeType: "application/pdf", modifiedTime: "2026-03-01T00:00:00Z", size: "200" },
    ];
    const result = matchFileToItem(item, files);
    expect(result!.id).toBe("new");
  });

  it("matches underscored hints against filenames with spaces and vice versa", () => {
    const item = makeItem(["utility_bill"]);
    const files = [
      { name: "Utility Bill Jan 2026.pdf", id: "f1", mimeType: "application/pdf", modifiedTime: "2026-01-01T00:00:00Z", size: "100" },
    ];
    expect(matchFileToItem(item, files)).not.toBeNull();
  });
});

describe("lien waiver disambiguation", () => {
  it("bare 'lien waiver' is not matched by conditional lien hint", () => {
    const item = makeItem(["conditional_waiver", "progress_waiver", "conditional_lien"], "m1.lien.conditional");
    const files = [
      { name: "Lien Waiver.pdf", id: "f1", mimeType: "application/pdf", modifiedTime: "2026-01-01T00:00:00Z", size: "100" },
    ];
    // bare "lien waiver" should NOT match conditional-specific hints
    expect(matchFileToItem(item, files)).toBeNull();
  });

  it("'Conditional Lien Waiver' matches conditional hint", () => {
    const item = makeItem(["conditional_waiver", "progress_waiver", "conditional_lien"], "m1.lien.conditional");
    const files = [
      { name: "Conditional_Lien_Waiver_Smith.pdf", id: "f1", mimeType: "application/pdf", modifiedTime: "2026-01-01T00:00:00Z", size: "100" },
    ];
    expect(matchFileToItem(item, files)).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern pe-turnover`
Expected: FAIL — `matchFileToItem` not exported

- [ ] **Step 3: Implement `matchFileToItem`**

Add to `src/lib/pe-turnover.ts`:

```typescript
import type { DriveGenericFile } from "@/lib/drive-plansets";

/**
 * Match a checklist item against a list of Drive files using fileHints.
 * Returns the best match (most recently modified) or null.
 */
export function matchFileToItem(
  item: ChecklistItem,
  files: DriveGenericFile[],
): DriveGenericFile | null {
  if (item.fileHints.length === 0) return null;

  const matches = files.filter((file) => {
    const normalizedName = file.name.toLowerCase().replace(/[_-]/g, " ");
    return item.fileHints.some((hint) => {
      const normalizedHint = hint.toLowerCase().replace(/[_-]/g, " ");
      return normalizedName.includes(normalizedHint);
    });
  });

  if (matches.length === 0) return null;

  // Pick most recently modified
  matches.sort((a, b) =>
    new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime()
  );
  return matches[0];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern pe-turnover`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/pe-turnover.ts src/__tests__/pe-turnover.test.ts
git commit -m "feat(pe-turnover): add matchFileToItem with hint normalization"
```

---

### Task 5: Implement combined-file handling

**Files:**
- Modify: `src/lib/pe-turnover.ts`
- Modify: `src/__tests__/pe-turnover.test.ts`

- [ ] **Step 1: Write tests for combined file resolution**

Add to `src/__tests__/pe-turnover.test.ts`:

```typescript
import { resolveCombinedFiles, type ChecklistResult } from "@/lib/pe-turnover";

describe("resolveCombinedFiles", () => {
  it("marks combined items as found when one item in the group matches", () => {
    const results: ChecklistResult[] = [
      {
        item: PE_M1_CHECKLIST.find((i) => i.id === "m1.contract.customer_agreement")!,
        status: "found",
        foundFile: { name: "Contract_Package.pdf", id: "f1", url: "", modifiedTime: "", size: 0 },
      },
      {
        item: PE_M1_CHECKLIST.find((i) => i.id === "m1.contract.installation_order")!,
        status: "missing",
      },
      {
        item: PE_M1_CHECKLIST.find((i) => i.id === "m1.contract.disclosures")!,
        status: "missing",
      },
    ];

    const resolved = resolveCombinedFiles(results);
    expect(resolved[0].status).toBe("found");
    expect(resolved[1].status).toBe("found");
    expect(resolved[1].combinedFile).toBe(true);
    expect(resolved[1].foundFile!.name).toBe("Contract_Package.pdf");
    expect(resolved[2].status).toBe("found");
    expect(resolved[2].combinedFile).toBe(true);
  });

  it("does not affect items without combinedWith", () => {
    const results: ChecklistResult[] = [
      {
        item: PE_M1_CHECKLIST.find((i) => i.id === "m1.contract.proposal")!,
        status: "missing",
      },
    ];
    const resolved = resolveCombinedFiles(results);
    expect(resolved[0].status).toBe("missing");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern pe-turnover`
Expected: FAIL — `resolveCombinedFiles` not exported

- [ ] **Step 3: Implement `resolveCombinedFiles`**

Add to `src/lib/pe-turnover.ts`:

```typescript
/**
 * If any item in a combinedWith group is "found", mark all others in the group
 * as "found" with combinedFile=true, sharing the same foundFile.
 */
export function resolveCombinedFiles(results: ChecklistResult[]): ChecklistResult[] {
  const byId = new Map(results.map((r) => [r.item.id, r]));

  for (const result of results) {
    if (result.status !== "found" || !result.item.combinedWith) continue;

    // This item is found and part of a combined group — propagate to missing siblings
    for (const siblingId of result.item.combinedWith) {
      const sibling = byId.get(siblingId);
      if (sibling && sibling.status === "missing") {
        sibling.status = "found";
        sibling.combinedFile = true;
        sibling.foundFile = result.foundFile;
      }
    }
  }

  return results;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern pe-turnover`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/pe-turnover.ts src/__tests__/pe-turnover.test.ts
git commit -m "feat(pe-turnover): add combined-file resolution for contract packages"
```

---

## Chunk 3: Drive Audit and Report Generation

### Task 6: Implement `auditDriveFolder` — the core folder-walking audit

**Files:**
- Modify: `src/lib/pe-turnover.ts`

- [ ] **Step 1: Implement folder structure validation and subfolder mapping**

Add to `src/lib/pe-turnover.ts`:

```typescript
import {
  extractFolderId,
  listDriveSubfolders,
  listDriveFiles,
  listPlansetPdfs,
  pickBestPlanset,
  listDriveImagesRecursive,
  type DriveFolder,
  type DriveGenericFile,
  type DriveImageFile,
} from "@/lib/drive-plansets";

interface FolderMap {
  /** Maps prefix number (e.g., "0", "2", "5") to folder ID */
  byPrefix: Map<string, string>;
  /** All folder IDs for breadth-first search */
  allFolderIds: string[];
  /** Warnings about folder structure */
  warnings: string[];
}

/**
 * Validate and map the root Drive folder's numbered subfolders.
 * Returns a map from prefix number to folder ID.
 */
export async function buildFolderMap(rootFolderId: string): Promise<FolderMap> {
  const warnings: string[] = [];
  let subfolders: DriveFolder[];

  try {
    subfolders = await listDriveSubfolders(rootFolderId);
  } catch (err) {
    return {
      byPrefix: new Map(),
      allFolderIds: [],
      warnings: [`Could not list root folder: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  const byPrefix = new Map<string, string>();
  for (const folder of subfolders) {
    const match = folder.name.match(/^(\d+)\./);
    if (match) {
      byPrefix.set(match[1], folder.id);
    }
  }

  if (byPrefix.size < 3) {
    warnings.push(
      `Non-standard Drive folder structure (found ${byPrefix.size} numbered subfolders). ` +
      `Folders: ${subfolders.map((f) => f.name).join(", ")}`
    );
  }

  // Check if root is itself a subfolder (e.g., "2. Design")
  // We can't check this without getting the root folder's name, which is an extra API call.
  // Skip for now — the warning above covers the practical case.

  return {
    byPrefix,
    allFolderIds: subfolders.map((f) => f.id),
    warnings,
  };
}
```

- [ ] **Step 2: Implement the main audit function**

Add to `src/lib/pe-turnover.ts`:

```typescript
interface AuditOptions {
  verifyPhotos?: boolean;
}

/**
 * Run the Drive file audit for a single milestone's checklist.
 * Walks the folder tree and matches files to checklist items.
 */
export async function auditDriveFiles(
  checklist: ChecklistItem[],
  rootFolderId: string,
  folderMap: FolderMap,
  designFolderId: string | null,
  _options?: AuditOptions,
): Promise<ChecklistResult[]> {
  // Cache: folder ID → files list
  const fileCache = new Map<string, DriveGenericFile[]>();

  async function getFiles(folderId: string): Promise<DriveGenericFile[]> {
    if (fileCache.has(folderId)) return fileCache.get(folderId)!;
    try {
      const files = await listDriveFiles(folderId);
      fileCache.set(folderId, files);
      return files;
    } catch {
      return [];
    }
  }

  // Collect all files from all folders for searchAllFolders items
  async function getAllFiles(): Promise<DriveGenericFile[]> {
    const all: DriveGenericFile[] = [];
    for (const folderId of folderMap.allFolderIds) {
      const files = await getFiles(folderId);
      all.push(...files);
      // Also check one level of subfolders
      try {
        const subs = await listDriveSubfolders(folderId);
        for (const sub of subs.slice(0, 10)) { // cap at 10 subfolders per folder
          const subFiles = await getFiles(sub.id);
          all.push(...subFiles);
        }
      } catch {
        // skip
      }
    }
    return all;
  }

  let allFilesCache: DriveGenericFile[] | null = null;

  // Pre-fetch recursive photo listing for the Installation folder
  let photoFiles: DriveGenericFile[] = [];
  const installFolderId = folderMap.byPrefix.get("5");
  if (installFolderId) {
    try {
      const images = await listDriveImagesRecursive(installFolderId, 3, 50);
      photoFiles = images.map((img: DriveImageFile) => ({
        id: img.id,
        name: img.name,
        mimeType: img.mimeType,
        modifiedTime: img.modifiedTime,
        size: img.size,
      }));
    } catch {
      // Will fall back to flat file listing
    }
  }

  const results: ChecklistResult[] = [];

  for (const item of checklist) {
    // Special case: planset uses dedicated logic
    if (item.id === "m1.design.planset") {
      const result = await auditPlanset(item, designFolderId);
      results.push(result);
      continue;
    }

    let candidateFiles: DriveGenericFile[] = [];

    if (item.isPhoto) {
      // Photos use recursive image listing from Installation folder
      candidateFiles = photoFiles;
      // Photo 6 (Invoice/BOM) also checks document folders
      if (item.pePhotoNumber === 6) {
        for (const prefix of item.driveFolders) {
          const folderId = folderMap.byPrefix.get(prefix);
          if (folderId) {
            const files = await getFiles(folderId);
            candidateFiles = [...candidateFiles, ...files];
          }
        }
      }
    } else if (item.searchAllFolders) {
      if (!allFilesCache) allFilesCache = await getAllFiles();
      candidateFiles = allFilesCache;
    } else {
      // Search preferred folders
      for (const prefix of item.driveFolders) {
        const folderId = folderMap.byPrefix.get(prefix);
        if (folderId) {
          const files = await getFiles(folderId);
          candidateFiles.push(...files);
        }
      }
    }

    const matched = matchFileToItem(item, candidateFiles);
    if (matched) {
      results.push({
        item,
        status: "found",
        foundFile: {
          name: matched.name,
          id: matched.id,
          url: `https://drive.google.com/file/d/${matched.id}/view`,
          modifiedTime: matched.modifiedTime,
          size: parseInt(matched.size ?? "0", 10),
        },
      });
    } else {
      results.push({ item, status: "missing" });
    }
  }

  // Post-pass: lien waiver disambiguation
  // If a lien item is "missing" but a generic "lien waiver" file exists, mark needs_review
  const allSearchedFiles = allFilesCache ?? [];
  const genericLienFile = allSearchedFiles.find((f) => {
    const n = f.name.toLowerCase();
    return n.includes("lien") && n.includes("waiver")
      && !n.includes("conditional") && !n.includes("progress")
      && !n.includes("final") && !n.includes("unconditional");
  });
  if (genericLienFile) {
    for (const r of results) {
      if (r.item.category === "lien" && r.status === "missing") {
        r.status = "needs_review";
        r.statusNote = `Generic "lien waiver" found but cannot determine if conditional or final`;
        r.foundFile = {
          name: genericLienFile.name,
          id: genericLienFile.id,
          url: `https://drive.google.com/file/d/${genericLienFile.id}/view`,
          modifiedTime: genericLienFile.modifiedTime,
          size: parseInt(genericLienFile.size ?? "0", 10),
        };
      }
    }
  }

  return resolveCombinedFiles(results);
}

/** Special-case audit for the planset item using existing drive-plansets.ts logic. */
async function auditPlanset(
  item: ChecklistItem,
  designFolderId: string | null,
): Promise<ChecklistResult> {
  if (!designFolderId) {
    return { item, status: "error", statusNote: "No design folder ID on deal" };
  }

  const folderId = extractFolderId(designFolderId);
  if (!folderId) {
    return { item, status: "error", statusNote: "Invalid design folder URL" };
  }

  try {
    const pdfs = await listPlansetPdfs(folderId);
    const best = pickBestPlanset(pdfs);
    if (best) {
      return {
        item,
        status: "found",
        foundFile: {
          name: best.name,
          id: best.id,
          url: `https://drive.google.com/file/d/${best.id}/view`,
          modifiedTime: best.modifiedTime,
          size: parseInt(best.size ?? "0", 10),
        },
      };
    }
    return { item, status: "missing" };
  } catch (err) {
    return { item, status: "error", statusNote: `Planset lookup failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
```

- [ ] **Step 3: Verify build passes**

Run: `npx tsc --noEmit --pretty`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/lib/pe-turnover.ts
git commit -m "feat(pe-turnover): add auditDriveFiles with folder mapping, caching, planset delegation"
```

---

### Task 7: Implement `generateTextReport`

**Files:**
- Modify: `src/lib/pe-turnover.ts`
- Modify: `src/__tests__/pe-turnover.test.ts`

- [ ] **Step 1: Write test for report generation**

Add to `src/__tests__/pe-turnover.test.ts`:

```typescript
import { buildAuditResult, generateTextReport } from "@/lib/pe-turnover";

describe("generateTextReport", () => {
  it("produces correct summary line", () => {
    const result = buildAuditResult({
      dealId: "123",
      dealName: "Smith Residence",
      address: "123 Main St, Denver, CO",
      systemType: "solar",
      milestone: "m1",
      peStatus: "Ready to Submit",
      results: [
        { item: PE_M1_CHECKLIST[0], status: "found", foundFile: { name: "CA.pdf", id: "f1", url: "", modifiedTime: "", size: 0 } },
        { item: PE_M1_CHECKLIST[3], status: "missing" },
        { item: PE_M1_CHECKLIST[5], status: "not_applicable", statusNote: "No loan" },
      ],
    });

    const report = generateTextReport(result);
    expect(report).toContain("Smith Residence");
    expect(report).toContain("123 Main St, Denver, CO");
    expect(report).toContain("MISSING: 1");
    expect(report).toContain("N/A: 1");
  });

  it("shows combined file grouping", () => {
    const results: ChecklistResult[] = [
      {
        item: PE_M1_CHECKLIST.find((i) => i.id === "m1.contract.customer_agreement")!,
        status: "found",
        foundFile: { name: "Contract_Package.pdf", id: "f1", url: "", modifiedTime: "", size: 0 },
      },
      {
        item: PE_M1_CHECKLIST.find((i) => i.id === "m1.contract.installation_order")!,
        status: "found",
        combinedFile: true,
        foundFile: { name: "Contract_Package.pdf", id: "f1", url: "", modifiedTime: "", size: 0 },
      },
    ];

    const result = buildAuditResult({
      dealId: "123",
      dealName: "Test",
      address: "123 Main",
      systemType: "solar",
      milestone: "m1",
      peStatus: null,
      results,
    });

    const report = generateTextReport(result);
    // Combined items should show the grouping indicator
    expect(report).toContain("Contract_Package.pdf");
  });
});
```

- [ ] **Step 2: Implement `buildAuditResult` and `generateTextReport`**

Add to `src/lib/pe-turnover.ts`:

```typescript
// ---------------------------------------------------------------------------
// Category labels (display order)
// ---------------------------------------------------------------------------

const CATEGORY_META: Record<string, { label: string; order: number }> = {
  contract: { label: "CONTRACT & PROPOSAL", order: 0 },
  design: { label: "DESIGN PACKAGE", order: 1 },
  photos: { label: "PHOTOS", order: 2 },
  admin: { label: "ADMIN", order: 3 },
  post_install: { label: "POST-INSTALL", order: 4 },
  inspection: { label: "INSPECTION", order: 5 },
  lien: { label: "LIEN", order: 6 },
  pto: { label: "PTO", order: 0 },
  warranty: { label: "WARRANTY & INCENTIVES", order: 1 },
  incentives: { label: "INCENTIVES", order: 2 },
};

// ---------------------------------------------------------------------------
// Build structured result from raw ChecklistResult[]
// ---------------------------------------------------------------------------

export function buildAuditResult(params: {
  dealId: string;
  dealName: string;
  address: string;
  systemType: SystemType;
  milestone: Milestone;
  peStatus: string | null;
  results: ChecklistResult[];
}): TurnoverAuditResult {
  // Group by category
  const catMap = new Map<string, ChecklistResult[]>();
  for (const r of params.results) {
    const key = r.item.category;
    if (!catMap.has(key)) catMap.set(key, []);
    catMap.get(key)!.push(r);
  }

  const categories = [...catMap.entries()]
    .sort(([a], [b]) => (CATEGORY_META[a]?.order ?? 99) - (CATEGORY_META[b]?.order ?? 99))
    .map(([name, items]) => ({
      name,
      label: CATEGORY_META[name]?.label ?? name.toUpperCase(),
      items,
      found: items.filter((i) => i.status === "found" || i.status === "likely").length,
      total: items.filter((i) => i.status !== "not_applicable").length,
    }));

  const all = params.results;
  const found = all.filter((r) => r.status === "found" || r.status === "likely").length;
  const missing = all.filter((r) => r.status === "missing").length;
  const needsReview = all.filter((r) => r.status === "needs_review").length;
  const notApplicable = all.filter((r) => r.status === "not_applicable").length;
  const errors = all.filter((r) => r.status === "error").length;
  const requiredTotal = all.length - notApplicable - errors;

  return {
    dealId: params.dealId,
    dealName: params.dealName,
    address: params.address,
    systemType: params.systemType,
    milestone: params.milestone,
    peStatus: params.peStatus,
    categories,
    summary: {
      totalItems: all.length,
      found,
      missing,
      needsReview,
      notApplicable,
      errors,
      ready: found >= requiredTotal,
    },
  };
}

// ---------------------------------------------------------------------------
// Text report
// ---------------------------------------------------------------------------

const MILESTONE_LABELS: Record<Milestone, string> = {
  m1: "M1 (Inspection Complete)",
  m2: "M2 (Project Complete)",
};

const STATUS_ICONS: Record<ChecklistStatus, string> = {
  found: "✓",
  likely: "~",
  missing: "✗",
  needs_review: "?",
  not_applicable: "—",
  error: "!",
};

export function generateTextReport(result: TurnoverAuditResult): string {
  const lines: string[] = [];

  lines.push(`PE Turnover Readiness — ${result.dealName}, ${result.address}`);
  lines.push(
    `Deal: ${result.dealId} | Type: ${result.systemType} | Milestone: ${MILESTONE_LABELS[result.milestone]}`
  );
  if (result.peStatus) {
    lines.push(`PE ${result.milestone.toUpperCase()} Status: ${result.peStatus}`);
  }
  lines.push("");

  for (const cat of result.categories) {
    lines.push(`${cat.label} (${cat.found}/${cat.total})`);

    // Detect combined-file groups for display
    const combinedGroups = new Map<string, ChecklistResult[]>();
    for (const r of cat.items) {
      if (r.combinedFile && r.foundFile) {
        const key = r.foundFile.id;
        if (!combinedGroups.has(key)) combinedGroups.set(key, []);
        combinedGroups.get(key)!.push(r);
      }
    }

    for (const r of cat.items) {
      const icon = STATUS_ICONS[r.status];
      const label = r.item.isPhoto ? `${r.item.pePhotoNumber}. ${r.item.label}` : r.item.label;
      let detail = "";

      if (r.status === "found" || r.status === "likely") {
        detail = `→ ${r.foundFile?.name ?? "found"}`;
        if (r.combinedFile) detail += " (combined)";
      } else if (r.status === "missing") {
        detail = "→ MISSING";
        if (r.item.searchAllFolders) detail += " (searched all folders)";
      } else if (r.status === "not_applicable") {
        detail = `→ N/A${r.statusNote ? ` (${r.statusNote})` : ""}`;
      } else if (r.status === "error") {
        detail = `→ ERROR${r.statusNote ? `: ${r.statusNote}` : ""}`;
      } else if (r.status === "needs_review") {
        detail = `→ ${r.foundFile?.name ?? "NEEDS REVIEW"}${r.statusNote ? ` (${r.statusNote})` : ""}`;
      }

      lines.push(`  ${icon} ${label.padEnd(35)} ${detail}`);
    }
    lines.push("");
  }

  const s = result.summary;
  const summaryParts = [
    `READY: ${s.found}/${s.totalItems - s.notApplicable - s.errors}`,
    `MISSING: ${s.missing}`,
  ];
  if (s.needsReview > 0) summaryParts.push(`NEEDS REVIEW: ${s.needsReview}`);
  if (s.notApplicable > 0) summaryParts.push(`N/A: ${s.notApplicable}`);
  if (s.errors > 0) summaryParts.push(`ERRORS: ${s.errors}`);

  lines.push("━".repeat(50));
  lines.push(summaryParts.join(" | "));

  return lines.join("\n");
}
```

- [ ] **Step 3: Run tests**

Run: `npm test -- --testPathPattern pe-turnover`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/lib/pe-turnover.ts src/__tests__/pe-turnover.test.ts
git commit -m "feat(pe-turnover): add buildAuditResult and generateTextReport"
```

---

## Chunk 4: Deal Resolution and Skill File

### Task 8: Implement `resolvePEDeal`

**Files:**
- Modify: `src/lib/pe-turnover.ts`

- [ ] **Step 1: Implement the deal resolution function**

Add to `src/lib/pe-turnover.ts`:

```typescript
import { getDealProperties, DEAL_STAGE_MAP } from "@/lib/hubspot";

function parseTags(tagsValue: unknown): string[] {
  const str = String(tagsValue ?? "");
  return str.split(";").map((t) => t.trim()).filter(Boolean);
}

export interface ResolvedPEDeal {
  dealId: string;
  dealName: string;
  address: string;
  systemType: SystemType;
  stageName: string;
  peM1Status: string | null;
  peM2Status: string | null;
  rootFolderId: string | null;
  designFolderId: string | null;
}

/**
 * Resolve a HubSpot deal for PE turnover:
 * - Fetch properties
 * - Verify PE financing
 * - Extract system type, address, Drive folder IDs
 */
export async function resolvePEDeal(dealId: string): Promise<ResolvedPEDeal> {
  const props = await getDealProperties(dealId, PE_TURNOVER_PROPERTIES);
  if (!props) throw new Error(`Deal ${dealId} not found`);

  // Verify PE financing
  const tags = parseTags(props.tags);
  const isPE = tags.includes("Participate Energy") || props.is_participate_energy === "true";
  if (!isPE) {
    throw new Error(`Deal ${dealId} is not a Participate Energy deal (tags: ${tags.join(", ")})`);
  }

  // System type
  const rawType = (props.project_type ?? "solar").toLowerCase();
  const systemType: SystemType =
    rawType === "battery" ? "battery" :
    rawType.includes("battery") || rawType.includes("storage") ? "solar+battery" :
    "solar";

  // Address
  const parts = [props.address_line_1, props.city, props.state].filter(Boolean);
  const address = parts.join(", ") || "Unknown address";

  // Stage
  const stageId = props.dealstage ?? "";
  const stageName = DEAL_STAGE_MAP[stageId] || stageId;

  // Drive folders
  const rootFolderRaw = props.all_document_parent_folder_id ?? props.g_drive ?? "";
  const rootFolderId = extractFolderId(rootFolderRaw) ?? null;

  const designRaw = props.design_documents ?? props.all_document_parent_folder_id ?? "";
  const designFolderId = designRaw || null;

  return {
    dealId,
    dealName: props.dealname ?? "Unknown",
    address,
    systemType,
    stageName,
    peM1Status: props.pe_m1_status || null,
    peM2Status: props.pe_m2_status || null,
    rootFolderId,
    designFolderId,
  };
}
```

- [ ] **Step 2: Verify build passes**

Run: `npx tsc --noEmit --pretty`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/pe-turnover.ts
git commit -m "feat(pe-turnover): add resolvePEDeal with PE verification, system type, Drive IDs"
```

---

### Task 9: Implement the top-level `runTurnoverAudit` orchestrator

**Files:**
- Modify: `src/lib/pe-turnover.ts`

- [ ] **Step 1: Implement the orchestrator**

Add to `src/lib/pe-turnover.ts`:

```typescript
export interface TurnoverAuditOptions {
  milestone?: Milestone | "both";
  verifyPhotos?: boolean;
  force?: boolean;
}

/**
 * Top-level orchestrator: resolve deal → build folder map → audit → report.
 * Returns one or two TurnoverAuditResults depending on milestone option.
 */
export async function runTurnoverAudit(
  dealId: string,
  options: TurnoverAuditOptions = {},
): Promise<TurnoverAuditOutput> {
  const deal = await resolvePEDeal(dealId);

  // Determine milestone(s) to audit
  let milestones: Milestone[];
  if (options.milestone === "both") {
    milestones = ["m1", "m2"];
  } else if (options.milestone) {
    milestones = [options.milestone];
  } else {
    const inferred = inferMilestone(deal.stageName);
    if (inferred.isTerminal && !options.force) {
      throw new Error(
        `Deal is in terminal stage "${deal.stageName}". Use --force to audit anyway.`
      );
    }
    milestones = [inferred.milestone ?? "m1"];
  }

  // Check terminal PE statuses
  for (const m of milestones) {
    const peStatus = m === "m1" ? deal.peM1Status : deal.peM2Status;
    if (isMilestoneTerminal(peStatus) && !options.force) {
      throw new Error(
        `PE ${m.toUpperCase()} status is "${peStatus}". Use --force to re-audit.`
      );
    }
  }

  // Build folder map (shared across milestones)
  let folderMap: FolderMap = { byPrefix: new Map(), allFolderIds: [], warnings: [] };
  if (deal.rootFolderId) {
    folderMap = await buildFolderMap(deal.rootFolderId);
  } else {
    folderMap.warnings.push("No root Drive folder ID found on deal");
  }

  // Run audit per milestone
  const auditResults: TurnoverAuditResult[] = [];
  for (const milestone of milestones) {
    const checklist = filterChecklist(
      milestone === "m1" ? PE_M1_CHECKLIST : PE_M2_CHECKLIST,
      deal.systemType,
    );

    const peStatus = milestone === "m1" ? deal.peM1Status : deal.peM2Status;

    const rawResults = await auditDriveFiles(
      checklist,
      deal.rootFolderId ?? "",
      folderMap,
      deal.designFolderId,
      { verifyPhotos: options.verifyPhotos },
    );

    const result = buildAuditResult({
      dealId: deal.dealId,
      dealName: deal.dealName,
      address: deal.address,
      systemType: deal.systemType,
      milestone,
      peStatus,
      results: rawResults,
    });

    auditResults.push(result);
  }

  if (milestones.length === 2) {
    return auditResults as [TurnoverAuditResult, TurnoverAuditResult];
  }
  return auditResults[0];
}
```

- [ ] **Step 2: Verify build passes**

Run: `npx tsc --noEmit --pretty`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/pe-turnover.ts
git commit -m "feat(pe-turnover): add runTurnoverAudit orchestrator with milestone detection"
```

---

### Task 10: Create the SKILL.md file

**Files:**
- Create: `.claude/skills/pe-turnover/SKILL.md`

- [ ] **Step 1: Create the skill directory and file**

```bash
mkdir -p .claude/skills/pe-turnover
```

- [ ] **Step 2: Write SKILL.md**

Create `.claude/skills/pe-turnover/SKILL.md`:

```markdown
---
name: pe-turnover
description: This skill should be used when the user asks to "check PE turnover readiness", "audit PE documents", "check Participate Energy submission", "gather PE files", "PE turnover", "pe-turnover", "turnover package", or any variation of checking what documents/photos are ready for a Participate Energy milestone submission.
version: 0.1.0
---

# PE Turnover Readiness

Audit and assemble Participate Energy turnover packages. Given a deal, verifies PE financing, detects system type, walks the project's Google Drive folder tree, matches files to PE's milestone checklists, and produces a gap report.

## When To Use

- User wants to check if a PE deal is ready for M1 (Inspection Complete) or M2 (Project Complete) submission
- User asks what documents/photos are missing for PE turnover
- User wants to assemble files for PE submission

## Workflow

### 1. Identify the deal

Get the HubSpot deal ID or customer name from the user. Look up the deal:

```typescript
import { resolvePEDeal, runTurnoverAudit, generateTextReport } from "@/lib/pe-turnover";

const deal = await resolvePEDeal(dealId);
```

If the user provides a name instead of a deal ID, search HubSpot first:
- Use `mcp__98214750__search_crm_objects` to find deals by name
- Then pass the deal ID to `resolvePEDeal`

### 2. Run the audit

```typescript
const result = await runTurnoverAudit(dealId, {
  milestone: "m1",       // or "m2" or "both"
  verifyPhotos: false,   // set true if user wants photo verification
  force: false,          // set true to override terminal status warnings
});
```

### 3. Display the report

```typescript
const report = generateTextReport(result);
// Print the report to the user
```

## Flags (from user request)

| Flag | When to use |
|------|-------------|
| `--milestone m1` | User asks about inspection complete / M1 |
| `--milestone m2` | User asks about project complete / M2 / PTO |
| `--milestone both` | User wants full picture |
| `--verify-photos` | User wants AI to check photo quality against PE requirements |
| `--force` | User wants to re-audit a deal with terminal PE status |

## PE Photo Requirements (Quick Reference)

| # | Requirement | System Types |
|---|-------------|-------------|
| 1 | Site address + home | All |
| 2 | Wide-angle PV array | Solar |
| 3 | Module nameplate | Solar |
| 4 | All electrical equipment | Solar |
| 5 | Main service panel (cover off) | Solar |
| 6 | Invoice & BOM | All |
| 7 | Inverter/micro model | Solar |
| 8 | Racking parts + markings | Solar |
| 9 | Storage wide angle | Storage |
| 10 | Storage nameplate | Storage |
| 11 | Storage controller/disconnect | Storage |

## Key Notes

- PE deals identified by `tags` containing "Participate Energy" or `is_participate_energy` property
- System type from `project_type` deal property (solar / battery / solar+battery)
- Drive folder structure: `all_document_parent_folder_id` → numbered subfolders (0. Sales through 8. Incentives)
- Contract package (Customer Agreement + Installation Order + Disclosures) often combined in one PDF
- Installer Attestation, Customer Acceptance, and Lien Waivers have no fixed folder (PandaDoc automation in progress) — searched across all folders
- PE milestone statuses: Ready to Submit, Waiting on Information, Submitted, Rejected, Ready to Resubmit, Resubmitted, Approved, Paid
- Reference: PE Deals dashboard at `/dashboards/pe-deals`
```

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/pe-turnover/SKILL.md
git commit -m "feat(pe-turnover): add Claude Code skill definition"
```

---

## Chunk 5: Integration Test and Polish

### Task 11: Add milestone inference tests

**Files:**
- Modify: `src/__tests__/pe-turnover.test.ts`

- [ ] **Step 1: Write milestone inference tests**

Add to `src/__tests__/pe-turnover.test.ts`:

```typescript
import { inferMilestone, isMilestoneTerminal } from "@/lib/pe-turnover";

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

  it("flags Project Complete as terminal", () => {
    expect(inferMilestone("Project Complete")).toEqual({ milestone: null, isTerminal: true });
  });

  it("flags Cancelled as terminal", () => {
    expect(inferMilestone("Cancelled")).toEqual({ milestone: null, isTerminal: true });
  });

  it("defaults unknown stages to m1", () => {
    expect(inferMilestone("Some Unknown Stage")).toEqual({ milestone: "m1", isTerminal: false });
  });
});

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
});
```

- [ ] **Step 2: Run all tests**

Run: `npm test -- --testPathPattern pe-turnover`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/pe-turnover.test.ts
git commit -m "test(pe-turnover): add milestone inference and terminal status tests"
```

---

### Task 12: Run full build verification

**Files:** None (verification only)

- [ ] **Step 1: Run TypeScript compilation**

Run: `npx tsc --noEmit --pretty`
Expected: No errors related to pe-turnover files

- [ ] **Step 2: Run all tests**

Run: `npm test -- --testPathPattern pe-turnover`
Expected: ALL PASS

- [ ] **Step 3: Run linter**

Run: `npm run lint`
Expected: No new errors in pe-turnover files

- [ ] **Step 4: Final commit with any lint fixes**

If lint fixes needed:
```bash
git add -A
git commit -m "fix(pe-turnover): lint cleanup"
```

---

## Phase A.1 Follow-Up (Deferred from Phase A core)

These features are in the Phase A spec but deferred from the initial implementation to keep the first pass focused on the audit + report core. They should be added as soon as the core is validated against real PE deals.

### `--verbose` flag
- Add `verbose?: boolean` to `TurnoverAuditOptions`
- In `generateTextReport`, when verbose is true, append file metadata after each found item: `(size, modified: date, [Drive link])`
- Estimated: 1 task, ~15 min

### `--assemble` flag / `assemblePackage()`
- Add `assemblePackage(result: TurnoverAuditResult, outputDir: string): Promise<string>` to `pe-turnover.ts`
- Downloads all found files using `downloadDriveFile()` (images via `downloadDriveImage()` for HEIC support)
- Renames per the Assembly File Naming table in the spec
- Creates `missing.txt` with unfound items
- Optionally zips to `{street_number}_{street_name}_{city}.zip`
- Estimated: 2 tasks, ~30 min

### `--verify-photos` / vision analysis
- Add `PE_PHOTO_REQUIREMENTS` data structure with per-photo vision prompts
- Download photos, send to Claude vision API with structured prompt
- Map vision results back to `ChecklistResult.visionResult`
- For unlabeled photos (`IMG_XXXX.jpg`), classify first, then match to PE photo number
- Estimated: 3 tasks, ~45 min

### Lien waiver disambiguation test
- Add test case: generic "Lien Waiver.pdf" with no qualifier should produce `needs_review` status for both M1 conditional and M2 final lien items
