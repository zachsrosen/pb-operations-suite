# PE Photo Submission Skills Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build two skills (`pe-final-permit-photos`, `pe-policy-photos`) that assemble a project's Drive photos into a vision-verified, correctly-ordered PDF ready for upload to the PE portal.

**Architecture:** Two thin `SKILL.md` wrappers over one shared engine. Pure, unit-tested helpers in `src/lib/pe-photo-submit.ts` (doc-type config, target parsing, filename derivation, deal disambiguation, low-res detection, shot ordering); an I/O orchestrator script `scripts/pe-photo-submit.ts` that wires those helpers to existing `lib/` modules (PE API, HubSpot, Drive, vision classifier, reference library) and `pdf-lib`/`sharp`. The reference library gains a doc-level "approved-on-v1" selector.

**Tech Stack:** TypeScript, Next.js app libs (`@/lib/*`), Jest, `pdf-lib`, `sharp`, Anthropic vision (`pe-vision-classifier`), run via `node --env-file=.env --import tsx`.

**Spec:** `docs/superpowers/specs/2026-06-15-pe-photo-submission-skills-design.md`

---

## File Structure

- **Create** `src/lib/pe-photo-submit.ts` — pure helpers + types + `DOC_CONFIGS`. No network/FS. The unit-testable core.
- **Create** `src/__tests__/pe-photo-submit.test.ts` — unit tests for the pure helpers.
- **Modify** `src/lib/pe-reference-library.ts` — add `findApprovedOnV1(docKey, limit)` doc-level selector.
- **Create** `scripts/pe-photo-submit.ts` — CLI orchestrator (`--doc`, `--project`, `--batch`, `--hours`, `--no-stage`). Wires helpers to I/O.
- **Create** `.claude/skills/pe-final-permit-photos/SKILL.md`
- **Create** `.claude/skills/pe-policy-photos/SKILL.md`

Conventions: scripts run with `node --env-file=.env --import tsx scripts/<name>.ts`. Tests run with `npm test -- <pattern>`. Imports use the `@/lib/...` alias.

---

## Chunk 1: Pure helper core (`pe-photo-submit.ts`)

All functions here are pure (no network, no FS) so they are TDD-tested directly. Shared by both doc types.

### Task 1: Types + doc-type config

**Files:**
- Create: `src/lib/pe-photo-submit.ts`
- Test: `src/__tests__/pe-photo-submit.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { DOC_CONFIGS } from "@/lib/pe-photo-submit";

describe("DOC_CONFIGS", () => {
  it("maps final-permit to folder 6 with fallback 3 and the signedFinalPermit key", () => {
    const c = DOC_CONFIGS["final-permit"];
    expect(c.sourceFolders).toEqual(["6", "3"]);
    expect(c.peDocKey).toBe("signedFinalPermit");
    expect(c.embedsSalesOrder).toBe(false);
  });

  it("maps policy-photos to folder 5 with the photos key and SO embed", () => {
    const c = DOC_CONFIGS["policy-photos"];
    expect(c.sourceFolders).toEqual(["5"]);
    expect(c.peDocKey).toBe("photos");
    expect(c.embedsSalesOrder).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- pe-photo-submit`
Expected: FAIL — cannot find module `@/lib/pe-photo-submit`.

- [ ] **Step 3: Write minimal implementation**

```typescript
export type DocType = "final-permit" | "policy-photos";

export interface DocConfig {
  sourceFolders: string[];      // numbered Drive subfolder prefixes, in priority order
  peDocKey: "signedFinalPermit" | "photos";
  embedsSalesOrder: boolean;
  outputDir: string;            // ~/Downloads subdir
}

export const DOC_CONFIGS: Record<DocType, DocConfig> = {
  "final-permit": {
    sourceFolders: ["6", "3"],
    peDocKey: "signedFinalPermit",
    embedsSalesOrder: false,
    outputDir: "pe-final-permit-pdfs",
  },
  "policy-photos": {
    sourceFolders: ["5"],
    peDocKey: "photos",
    embedsSalesOrder: true,
    outputDir: "pe-policy-photos-pdfs",
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- pe-photo-submit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pe-photo-submit.ts src/__tests__/pe-photo-submit.test.ts
git commit -m "feat(pe): doc-type config for photo-submit engine"
```

### Task 2: Output filename derivation

Final Permit: `{ProjCode}_{LastName}_Final_Permit.pdf`. Policy Photos: `{street}_{city}.pdf` from PE structured address (never deal-name parsing — spec §4/§7).

- [ ] **Step 1: Write the failing test**

```typescript
import { finalPermitFilename, policyPhotosFilename } from "@/lib/pe-photo-submit";

describe("filename derivation", () => {
  it("builds the final-permit filename from code + last name", () => {
    expect(finalPermitFilename("CO2605-TORP2", "Torpey")).toBe("CO2605-TORP2_Torpey_Final_Permit.pdf");
  });

  it("builds the policy-photos filename from structured PE address", () => {
    expect(policyPhotosFilename({ street: "295 Via Piedras Blancas", city: "San Simeon" }))
      .toBe("295 Via Piedras Blancas_San Simeon.pdf");
  });

  it("sanitizes path-hostile characters and trims", () => {
    expect(policyPhotosFilename({ street: " 102 S/Tanager Ct ", city: "Louisville " }))
      .toBe("102 S_Tanager Ct_Louisville.pdf");
  });

  it("falls back to UNKNOWN when address is missing", () => {
    expect(policyPhotosFilename({ street: "", city: "" })).toBe("UNKNOWN_address.pdf");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- pe-photo-submit`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Write minimal implementation**

```typescript
const sanitize = (s: string) => s.replace(/[\/\\:*?"<>|]/g, "_").trim();

export function finalPermitFilename(projCode: string, lastName: string): string {
  return `${projCode}_${sanitize(lastName)}_Final_Permit.pdf`;
}

export function policyPhotosFilename(addr: { street?: string; city?: string }): string {
  const street = sanitize(addr.street ?? "");
  const city = sanitize(addr.city ?? "");
  if (!street && !city) return "UNKNOWN_address.pdf";
  return `${[street, city].filter(Boolean).join("_")}.pdf`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- pe-photo-submit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pe-photo-submit.ts src/__tests__/pe-photo-submit.test.ts
git commit -m "feat(pe): output filename derivation"
```

### Task 3: Low-res / sliver image detection (the Torpey guard)

Flag images too small or too extreme an aspect ratio to be a real document/photo.

- [ ] **Step 1: Write the failing test**

```typescript
import { isUsableImage } from "@/lib/pe-photo-submit";

describe("isUsableImage", () => {
  it("rejects the Torpey sliver (661x111)", () => {
    expect(isUsableImage(661, 111).ok).toBe(false);
  });
  it("accepts a normal screenshot/photo", () => {
    expect(isUsableImage(1300, 800).ok).toBe(true);
  });
  it("rejects a tiny thumbnail", () => {
    expect(isUsableImage(120, 90).ok).toBe(false);
  });
  it("gives a reason when rejected", () => {
    expect(isUsableImage(661, 111).reason).toMatch(/aspect|small/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- pe-photo-submit`
Expected: FAIL — `isUsableImage` not exported.

- [ ] **Step 3: Write minimal implementation**

```typescript
export interface UsableResult { ok: boolean; reason?: string; }

// Minimums chosen so real screenshots/photos pass but slivers/thumbnails fail.
const MIN_DIM = 400;        // px on the short side
const MAX_ASPECT = 4.5;     // long:short ratio

export function isUsableImage(width: number, height: number): UsableResult {
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  if (short < MIN_DIM) return { ok: false, reason: `too small (${width}x${height})` };
  if (long / short > MAX_ASPECT) return { ok: false, reason: `extreme aspect (${width}x${height})` };
  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- pe-photo-submit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(pe): low-res/sliver image guard"
```

### Task 4: Deal disambiguation by PE address (the Bucey guard)

Given multiple HubSpot deals matching one `pe_project_id`, pick the one whose address matches the PE project; flag if ambiguous.

- [ ] **Step 1: Write the failing test**

```typescript
import { pickDealByAddress } from "@/lib/pe-photo-submit";

const deals = [
  { id: "1", address: "1365 Georgetown Rd, Boulder, CO 80305" },
  { id: "2", address: "2605 Kohler Dr, Boulder, CO 80305" },
];

describe("pickDealByAddress", () => {
  it("returns the single deal when only one", () => {
    expect(pickDealByAddress([deals[0]], "1365 Georgetown Rd").deal?.id).toBe("1");
  });
  it("matches on street number + name", () => {
    const r = pickDealByAddress(deals, "1365 Georgetown Rd");
    expect(r.deal?.id).toBe("1");
    expect(r.ambiguous).toBe(false);
  });
  it("flags ambiguous when nothing matches the PE address", () => {
    const r = pickDealByAddress(deals, "999 Nowhere St");
    expect(r.ambiguous).toBe(true);
    expect(r.deal).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- pe-photo-submit`
Expected: FAIL — `pickDealByAddress` not exported.

- [ ] **Step 3: Write minimal implementation**

```typescript
export interface DealLike { id: string; address: string; }
export interface PickResult { deal: DealLike | null; ambiguous: boolean; }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
// Leading street number + first street token, e.g. "1365 georgetown".
const streetKey = (s: string) => {
  const n = norm(s);
  const m = n.match(/^(\d+)\s+(\w+)/);
  return m ? `${m[1]} ${m[2]}` : n.split(" ").slice(0, 2).join(" ");
};

export function pickDealByAddress(deals: DealLike[], peAddress: string): PickResult {
  if (deals.length === 1) return { deal: deals[0], ambiguous: false };
  const target = streetKey(peAddress);
  const matches = deals.filter((d) => streetKey(d.address) === target);
  if (matches.length === 1) return { deal: matches[0], ambiguous: false };
  return { deal: null, ambiguous: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- pe-photo-submit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(pe): deal disambiguation by PE address"
```

### Task 5: Shot ordering for policy photos

Order classified photos by the canonical shot sequence (spec §5), filtered to the system type via `pe-turnover`'s checklist. Input: photos each tagged with a `shotId` (from the classifier) + the system type. Output: ordered list, with the Sales Order slotted at item #6.

- [ ] **Step 1: Write the failing test**

```typescript
import { orderPolicyPhotos } from "@/lib/pe-photo-submit";

describe("orderPolicyPhotos", () => {
  const photos = [
    { fileId: "a", shotId: "m1.photos.3_module_nameplate" },
    { fileId: "b", shotId: "m1.photos.1_site_address" },
    { fileId: "c", shotId: "m1.photos.2_pv_array" },
    { fileId: "d", shotId: "m1.photos.2_pv_array" }, // a shot can repeat
  ];
  it("orders by canonical shot sequence, keeping repeats in input order", () => {
    const out = orderPolicyPhotos(photos, "solar");
    expect(out.map((p) => p.fileId)).toEqual(["b", "c", "d", "a"]);
  });
  it("drops shots that do not apply to the system type", () => {
    const storagePhotos = [
      { fileId: "x", shotId: "m1.photos.2_pv_array" },       // SOLAR only
      { fileId: "y", shotId: "m1.photos.9_storage_wide" },   // STORAGE
    ];
    const out = orderPolicyPhotos(storagePhotos, "battery");
    expect(out.map((p) => p.fileId)).toEqual(["y"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- pe-photo-submit`
Expected: FAIL — `orderPolicyPhotos` not exported.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { PE_M1_CHECKLIST, filterChecklist, type SystemType } from "@/lib/pe-turnover";

export interface ClassifiedPhoto { fileId: string; shotId: string; }

export function orderPolicyPhotos(photos: ClassifiedPhoto[], systemType: SystemType): ClassifiedPhoto[] {
  const applicable = filterChecklist(PE_M1_CHECKLIST.filter((i) => i.isPhoto), systemType);
  const rank = new Map(applicable.map((item, idx) => [item.id, idx]));
  return photos
    .filter((p) => rank.has(p.shotId))
    .map((p, inputIdx) => ({ p, inputIdx }))
    .sort((a, b) => (rank.get(a.p.shotId)! - rank.get(b.p.shotId)!) || (a.inputIdx - b.inputIdx))
    .map(({ p }) => p);
}
```

> NOTE for implementer: `PE_M1_CHECKLIST`, `filterChecklist`, and `SystemType` are exported from `pe-turnover.ts`; do not duplicate the checklist. The shot ids used in the test fixtures above are the **real** `ChecklistItem.id` values (verified): `m1.photos.1_site_address`, `…2_pv_array`, `…3_module_nameplate`, `…4_electrical`, `…5_msp`, `…6_invoice_bom`, `…7_inverter`, `…8_racking`, `…9_storage_wide`, `…10_storage_nameplate`, `…11_storage_controller`. These match the `checklistId` values emitted by `triagePhotoBatch`, so the classifier output drops straight into `orderPolicyPhotos` with no mapping.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- pe-photo-submit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(pe): canonical shot ordering for policy photos"
```

### Task 6: Target argument parsing

Parse the CLI/skill target into a normalized request (single project vs batch-recent).

- [ ] **Step 1: Write the failing test**

```typescript
import { parseTarget } from "@/lib/pe-photo-submit";

describe("parseTarget", () => {
  it("parses a single PROJ/PE code", () => {
    expect(parseTarget({ project: "CO2605-TORP2" })).toEqual({ mode: "single", value: "CO2605-TORP2" });
  });
  it("parses batch-recent with default 24h, current user", () => {
    expect(parseTarget({ batch: "recent" })).toEqual({ mode: "recent", hours: 24, mineOnly: true });
  });
  it("honors an explicit hours window", () => {
    expect(parseTarget({ batch: "recent", hours: 48 })).toEqual({ mode: "recent", hours: 48, mineOnly: true });
  });
  it("parses an explicit comma list", () => {
    expect(parseTarget({ batch: "CO2605-TORP2,CO2604-MURR9" }))
      .toEqual({ mode: "list", codes: ["CO2605-TORP2", "CO2604-MURR9"] });
  });
  it("throws when no target is given", () => {
    expect(() => parseTarget({})).toThrow(/project or batch/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- pe-photo-submit`
Expected: FAIL — `parseTarget` not exported.

- [ ] **Step 3: Write minimal implementation**

```typescript
export type TargetRequest =
  | { mode: "single"; value: string }
  | { mode: "list"; codes: string[] }
  | { mode: "recent"; hours: number; mineOnly: boolean };

export function parseTarget(opts: { project?: string; batch?: string; hours?: number }): TargetRequest {
  if (opts.project) return { mode: "single", value: opts.project.trim() };
  if (opts.batch === "recent") return { mode: "recent", hours: opts.hours ?? 24, mineOnly: true };
  if (opts.batch) {
    const codes = opts.batch.split(",").map((c) => c.trim()).filter(Boolean);
    return { mode: "list", codes };
  }
  throw new Error("Provide a project or batch target");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- pe-photo-submit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(pe): target argument parsing"
```

---

## Chunk 2: Reference library + I/O orchestrator

### Task 7: Approved-on-v1 selector in the reference library

Doc-level selector: scan `listAllProjects()` for a doc that is `APPROVED` with exactly one version (spec §6).

**Files:**
- Modify: `src/lib/pe-reference-library.ts`
- Test: `src/__tests__/pe-reference-library-v1.test.ts`

- [ ] **Step 1: Write the failing test** (pure helper extracted for testability)

```typescript
import { isApprovedOnV1 } from "@/lib/pe-reference-library";

describe("isApprovedOnV1", () => {
  it("true when APPROVED and exactly one version", () => {
    expect(isApprovedOnV1({ status: "APPROVED", versions: [{ version: 1 }] } as any)).toBe(true);
  });
  it("false when approved but resubmitted (2 versions)", () => {
    expect(isApprovedOnV1({ status: "APPROVED", versions: [{ version: 1 }, { version: 2 }] } as any)).toBe(false);
  });
  it("false when not approved", () => {
    expect(isApprovedOnV1({ status: "PENDING_REVIEW", versions: [{ version: 1 }] } as any)).toBe(false);
  });
  it("false when doc missing", () => {
    expect(isApprovedOnV1(undefined as any)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- pe-reference-library-v1`
Expected: FAIL — `isApprovedOnV1` not exported.

- [ ] **Step 3: Write minimal implementation** (add to `pe-reference-library.ts`)

```typescript
import type { PeDocumentInfo } from "@/lib/pe-api";

export function isApprovedOnV1(doc: PeDocumentInfo | undefined): boolean {
  if (!doc) return false;
  return (doc.status ?? "").toUpperCase() === "APPROVED" && (doc.versions?.length ?? 0) === 1;
}

/** Return up to `limit` projects whose `docKey` doc was approved on v1, newest first. */
export async function findApprovedOnV1(
  docKey: "signedFinalPermit" | "photos",
  limit = 5,
): Promise<{ projectId: string; dealRecordId: number | undefined; fileName?: string }[]> {
  const { listAllProjects } = await import("@/lib/pe-api");
  const projects = await listAllProjects();
  return projects
    .filter((p) => isApprovedOnV1((p.documents as any)?.[docKey]))
    .slice(0, limit)
    .map((p) => ({
      projectId: p.projectId,
      dealRecordId: p._hubspot?.recordId,
      fileName: (p.documents as any)[docKey]?.versions?.[0]?.fileName,
    }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- pe-reference-library-v1`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(pe): doc-level approved-on-v1 selector"
```

### Task 8: Orchestrator script skeleton + arg wiring

**Files:**
- Create: `scripts/pe-photo-submit.ts`

- [ ] **Step 1: Implement arg parsing + dispatch**

Wire `process.argv` flags (`--doc`, `--project`, `--batch`, `--hours`, `--no-stage`) into `parseTarget` + `DOC_CONFIGS`. Resolve the target list:
- `single` → `[value]`
- `list` → `codes`
- `recent` → scan `listAllProjects()`, collect projects whose `DOC_CONFIGS[doc].peDocKey` doc has a version with `uploadedAt` within `hours` and (if `mineOnly`) `uploadedBy === process.env.GMAIL_SENDER_EMAIL`. NOTE (verified 2026-06-15): `version.uploadedBy` is the uploader's email in the exact form `zach@photonbrothers.com`, so an `.toLowerCase()` equality against `GMAIL_SENDER_EMAIL` is correct; `uploadedBy` is `null` on pre-attribution versions (the `?? ""` guard handles it).

```typescript
// scripts/pe-photo-submit.ts
import { DOC_CONFIGS, parseTarget, type DocType } from "@/lib/pe-photo-submit";
import { listAllProjects } from "@/lib/pe-api";

function getFlag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function resolveCodes(doc: DocType): Promise<string[]> {
  const req = parseTarget({
    project: getFlag("project"),
    batch: getFlag("batch"),
    hours: getFlag("hours") ? Number(getFlag("hours")) : undefined,
  });
  if (req.mode === "single") return [req.value];
  if (req.mode === "list") return req.codes;
  // recent
  const me = (process.env.GMAIL_SENDER_EMAIL ?? "").toLowerCase();
  const cutoff = Date.now() - req.hours * 3600_000;
  const key = DOC_CONFIGS[doc].peDocKey;
  const projects = await listAllProjects();
  return projects
    .filter((p) => ((p.documents as any)?.[key]?.versions ?? []).some((v: any) => {
      const t = Date.parse(v.uploadedAt);
      const mine = !req.mineOnly || (v.uploadedBy ?? "").toLowerCase() === me;
      return !Number.isNaN(t) && t >= cutoff && mine;
    }))
    .map((p) => p.projectId);
}

async function main() {
  const doc = (getFlag("doc") ?? "") as DocType;
  if (!DOC_CONFIGS[doc]) throw new Error("Pass --doc final-permit|policy-photos");
  if (!process.env.PE_FILE_PREP_ENABLED) {
    throw new Error("PE_FILE_PREP_ENABLED required for photo verification");
  }
  const codes = await resolveCodes(doc);
  console.log(`Targets (${doc}): ${codes.join(", ") || "(none)"}`);
  // per-project pipeline added in Task 9
}

main().catch((e) => { console.error("ERR", e?.message || e); process.exit(1); });
```

- [ ] **Step 2: Smoke-run dry resolution**

Run: `node --env-file=.env --import tsx scripts/pe-photo-submit.ts --doc final-permit --batch recent --hours 24`
Expected: prints a target list (your last-24h Final Permit projects). No crash.

- [ ] **Step 3: Commit**

```bash
git add scripts/pe-photo-submit.ts
git commit -m "feat(pe): photo-submit orchestrator skeleton + target resolution"
```

### Task 9: Per-project pipeline (resolve → folder → verify → assemble → deliver)

Wire the existing libs for one project. Keep each helper call thin; pure logic already lives in Chunk 1.

- [ ] **Step 1: Implement `processProject(code, doc, stage)`** using:
  - Deal resolution: `searchWithRetry({ filterGroups:[{filters:[{propertyName:"pe_project_id",operator:"EQ",value:code}]}], properties:["hs_object_id","all_document_parent_folder_id","design_documents","g_drive","pb_tech_ops_url","address_line_1","city","state"] })` → `pickDealByAddress(deals, peProjectAddress)`.
  - Folder: `extractFolderId` → `buildFolderMap` → first present of `DOC_CONFIGS[doc].sourceFolders`.
  - Images: `listDriveImages(folderId)`; download via `downloadDriveImage`; `sharp(buf).metadata()` → `isUsableImage` flag.
  - Verify:
    - **Classifier contract (verified):** `triagePhotoBatch(photos, photoItems)` returns `PhotoTriageResult { assignments: Map<photoIndex, { checklistId, verdict: "pass"|"fail"|"needs_review", confidence, issues[], equipmentVisible[] }> }` where **`checklistId` is exactly a `ChecklistItem.id`** (e.g. `m1.photos.2_pv_array`) — the same ids `orderPolicyPhotos` keys on. No translation layer needed.
    - **Policy-photos:** upload each usable image to Anthropic Files via `uploadToAnthropic` (from `pe-vision-classifier`) to get `anthropicFileId`; pass `photoItems = filterChecklist(PE_M1_CHECKLIST.filter(i => i.isPhoto), systemType)`. Build `classified: ClassifiedPhoto[]` from assignments where `verdict !== "fail"`, as `{ fileId: driveFileId, shotId: checklistId }`. Flag any `needs_review` and any `fail` (with the assignment's `issues`).
    - **Final-permit:** call `verifyPhoto` (or `classifyDocument`) per usable image to confirm it is a signed/passed/finaled permit or inspection card; exclude rejects; collect flags.
  - Order: policy → `orderPolicyPhotos(classified, systemType)`; final-permit → chronological by filename.
  - SO embed (policy only): locate SO PDF in the `Participate Energy` folder then folder `0`; if absent, flag and continue (spec §4). Embed its pages at slot #6.
  - Assemble with `pdf-lib`+`sharp` (image→page full-res; `copyPages` for the SO PDF).
  - Deliver: write to `~/Downloads/{outputDir}/{filename}`; unless `--no-stage`, upload a copy to the project's `Participate Energy` folder via `findOrCreatePeFolder` + `uploadDriveBinaryFile`.
  - Return a summary row `{ code, customer, pages, flags[], portalUrl }`.

- [ ] **Step 2: Build the per-project loop + `UPLOAD-CHECKLIST.md`** writer (unified format for both doc types: `☐ | Project | Customer | PDF | Portal | Note`).

- [ ] **Step 3: Integration smoke against the gold set**

Run: `node --env-file=.env --import tsx scripts/pe-photo-submit.ts --doc policy-photos --project CO2604-ROSE24 --no-stage`
Expected: writes `~/Downloads/pe-policy-photos-pdfs/334 Wild Horse_Boulder.pdf`; page count and shot order approximate the approved original (8pp; site → … → storage). Flags list is empty or explains any skip.

Run: `node --env-file=.env --import tsx scripts/pe-photo-submit.ts --doc final-permit --project CO2605-TORP2 --no-stage`
Expected: Torpey flagged (`too small`/`extreme aspect`) — proves the guard.

- [ ] **Step 4: Commit**

```bash
git add scripts/pe-photo-submit.ts
git commit -m "feat(pe): per-project photo-submit pipeline + checklist"
```

---

## Chunk 3: Skill wrappers + docs

### Task 10: `pe-final-permit-photos` skill

**Files:**
- Create: `.claude/skills/pe-final-permit-photos/SKILL.md`

- [ ] **Step 1: Write SKILL.md** with frontmatter (`name`, `description` with trigger phrases like "prep final permit photos for PROJ/Torpey", "final permit PDF", "my final permit submissions today", `version: 0.1.0`) and a body that: states the read-only-PE / manual-upload contract, documents the `node --env-file=.env --import tsx scripts/pe-photo-submit.ts --doc final-permit ...` invocations (single, `--batch recent`, list), references the spec, and lists the flags the user should eyeball (low-res, ambiguous deal, empty folder).

- [ ] **Step 2: Verify the skill loads**

Run: `ls .claude/skills/pe-final-permit-photos/SKILL.md` and re-read frontmatter; confirm `name` matches dir.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/pe-final-permit-photos/SKILL.md
git commit -m "feat(pe): pe-final-permit-photos skill"
```

### Task 11: `pe-policy-photos` skill

**Files:**
- Create: `.claude/skills/pe-policy-photos/SKILL.md`

- [ ] **Step 1: Write SKILL.md** mirroring Task 10 for `--doc policy-photos`, plus: the system-type-conditioned shot table (spec §5), the embedded-SO note, and the `{street}_{city}.pdf` output naming.

- [ ] **Step 2: Verify the skill loads** (as Task 10 Step 2).

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/pe-policy-photos/SKILL.md
git commit -m "feat(pe): pe-policy-photos skill"
```

### Task 12: Final verification + plan close-out

- [ ] **Step 1: Run the full unit suite**

Run: `npm test -- pe-photo-submit pe-reference-library-v1`
Expected: all green.

- [ ] **Step 2: Lint the new files**

Run: `npm run lint`
Expected: no new errors in `pe-photo-submit.ts`, `scripts/pe-photo-submit.ts`, `pe-reference-library.ts`.

- [ ] **Step 3: End-to-end batch dry-run (no staging)**

Run: `node --env-file=.env --import tsx scripts/pe-photo-submit.ts --doc final-permit --batch recent --hours 24 --no-stage`
Expected: rebuilds today's Final Permit PDFs locally + `UPLOAD-CHECKLIST.md`, flags Torpey.

- [ ] **Step 4: Commit any fixes; open PR**

```bash
git add -A && git commit -m "test(pe): verify photo-submit end to end"
```

---

## Notes for the implementer

- **Do not** add a portal-upload path — PE API is read-only (spec §2).
- **Do not** regenerate the SO PDF — locate-or-flag only (spec §4).
- Reuse existing libs; the only new lib file is `pe-photo-submit.ts` (pure) — all I/O lives in the script.
- Verify exact export names in `pe-turnover.ts` (`PE_M1_CHECKLIST`, `filterChecklist`, `SystemType`) and `pe-api.ts` (`PeDocumentInfo`, `listAllProjects`, `_hubspot.recordId`) before importing; adjust imports to match, never duplicate.
- The 2026-06-15 reference samples live in `~/Downloads/pe-reference-samples/` for manual structure comparison during Task 9 smoke tests.
