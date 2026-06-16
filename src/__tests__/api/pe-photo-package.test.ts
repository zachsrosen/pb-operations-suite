/**
 * Tests for:
 *   POST /api/pe/photo-package/triage
 *   POST /api/pe/photo-package/assemble
 *
 * TDD — tests written before routes.
 */

// ---------------------------------------------------------------------------
// Module mocks — MUST be declared before any imports per Jest hoisting rules
// ---------------------------------------------------------------------------

// auth
jest.mock("@/lib/api-auth", () => ({
  requireApiAuth: jest.fn(),
}));

// PE project list
jest.mock("@/lib/pe-api", () => ({
  listAllProjects: jest.fn(),
}));

// Fully mock pe-photo-package.
// normalizeSystemType and buildPhotoPdf are re-implemented as functional stubs
// so the route can call them without pulling in their full transitive deps.
jest.mock("@/lib/pe-photo-package", () => ({
  normalizeSystemType: jest.fn((raw: string | undefined) => {
    const s = (raw ?? "").toLowerCase();
    const hasSolar = s.includes("solar") || s.includes("pv");
    const hasStorage = s.includes("battery") || s.includes("storage");
    if (hasStorage && !hasSolar) return "battery";
    if (hasStorage && hasSolar) return "solar+battery";
    return "solar";
  }),
  resolveDealContext: jest.fn(),
  buildPhotoPdf: jest.fn(),
}));

// Vision classifier
jest.mock("@/lib/pe-vision-classifier", () => ({
  uploadToAnthropic: jest.fn(),
  triagePhotoBatch: jest.fn(),
}));

// pe-photo-coverage — pure logic, no I/O; can use actual
jest.mock("@/lib/pe-photo-coverage", () => {
  const actual = jest.requireActual<typeof import("@/lib/pe-photo-coverage")>(
    "@/lib/pe-photo-coverage"
  );
  return actual;
});

// pe-turnover — mocked to avoid transitive DB import chain
jest.mock("@/lib/pe-turnover", () => {
  // Provide just enough of PE_M1_CHECKLIST for the test scenarios
  const CHECKLIST = [
    {
      id: "m1.photos.1_site_address",
      label: "Site address + home",
      category: "photos",
      milestone: "m1",
      appliesTo: ["solar", "battery", "solar+battery"],
      driveFolders: ["5"],
      searchAllFolders: false,
      fileHints: [],
      isPhoto: true,
      pePhotoNumber: 1,
    },
    {
      id: "m1.photos.4_electrical",
      label: "Wide-angle all electrical",
      category: "photos",
      milestone: "m1",
      appliesTo: ["solar", "battery", "solar+battery"],
      driveFolders: ["5"],
      searchAllFolders: false,
      fileHints: [],
      isPhoto: true,
      pePhotoNumber: 4,
    },
    {
      id: "m1.photos.5_msp",
      label: "Main service panel (cover off)",
      category: "photos",
      milestone: "m1",
      appliesTo: ["solar", "battery", "solar+battery"],
      driveFolders: ["5"],
      searchAllFolders: false,
      fileHints: [],
      isPhoto: true,
      pePhotoNumber: 5,
    },
    {
      id: "m1.photos.6_invoice_bom",
      label: "Invoice & BOM",
      category: "photos",
      milestone: "m1",
      appliesTo: ["solar", "battery", "solar+battery"],
      driveFolders: ["5"],
      searchAllFolders: false,
      fileHints: [],
      isPhoto: true,
      pePhotoNumber: 6,
    },
  ];
  return {
    PE_M1_CHECKLIST: CHECKLIST,
    buildFolderMap: jest.fn(),
  };
});

// pe-photo-submit — avoid pulling in pe-turnover via its import.
// orderPolicyPhotos and policyPhotosFilename use jest.requireActual so the real
// ordering logic is exercised (pe-turnover is already mocked above, so the real
// fn sees our stub checklist with no heavy/Prisma imports).
jest.mock("@/lib/pe-photo-submit", () => {
  const actual = jest.requireActual<typeof import("@/lib/pe-photo-submit")>(
    "@/lib/pe-photo-submit"
  );
  return {
    ...actual,
    isUsableImage: jest.fn(),
    // Pass through the real orderPolicyPhotos and policyPhotosFilename
    orderPolicyPhotos: actual.orderPolicyPhotos,
    policyPhotosFilename: actual.policyPhotosFilename,
    ClassifiedPhoto: undefined, // type only
    DOC_CONFIGS: {
      "policy-photos": {
        folderProps: ["installation_documents"],
        sourceFolders: ["5"],
        peDocKey: "photos",
        embedsSalesOrder: true,
      },
      "final-permit": {
        folderProps: ["inspection_documents", "permit_documents"],
        sourceFolders: ["6", "3"],
        peDocKey: "signedFinalPermit",
        embedsSalesOrder: false,
      },
    },
    pickDealByAddress: jest.fn(),
  };
});

// Drive helpers for assemble
jest.mock("@/lib/pe-audit-orchestrator", () => ({
  findOrCreatePeFolder: jest.fn(),
}));
jest.mock("@/lib/drive-plansets", () => ({
  uploadDriveBinaryFile: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { listAllProjects } from "@/lib/pe-api";
import { resolveDealContext, buildPhotoPdf } from "@/lib/pe-photo-package";
import {
  uploadToAnthropic,
  triagePhotoBatch,
} from "@/lib/pe-vision-classifier";
import { isUsableImage } from "@/lib/pe-photo-submit";
import { findOrCreatePeFolder } from "@/lib/pe-audit-orchestrator";
import { uploadDriveBinaryFile } from "@/lib/drive-plansets";

// Typed mock helpers
const mockRequireApiAuth = requireApiAuth as jest.MockedFunction<typeof requireApiAuth>;
const mockListAllProjects = listAllProjects as jest.MockedFunction<typeof listAllProjects>;
const mockResolveDealContext = resolveDealContext as jest.MockedFunction<typeof resolveDealContext>;
const mockBuildPhotoPdf = buildPhotoPdf as jest.MockedFunction<typeof buildPhotoPdf>;
const mockUploadToAnthropic = uploadToAnthropic as jest.MockedFunction<typeof uploadToAnthropic>;
const mockTriagePhotoBatch = triagePhotoBatch as jest.MockedFunction<typeof triagePhotoBatch>;
const mockIsUsableImage = isUsableImage as jest.MockedFunction<typeof isUsableImage>;
// orderPolicyPhotos is the real implementation (not a jest.fn) — no mock handle needed

const mockFindOrCreatePeFolder = findOrCreatePeFolder as jest.MockedFunction<typeof findOrCreatePeFolder>;
const mockUploadDriveBinaryFile = uploadDriveBinaryFile as jest.MockedFunction<typeof uploadDriveBinaryFile>;

// ---------------------------------------------------------------------------
// Test fixtures built in beforeAll
// ---------------------------------------------------------------------------

let pngBuffer: Buffer;
let soBuffer: Buffer;
let minimalPdfBytes: Uint8Array;

beforeAll(async () => {
  // Generate a real minimal PNG (1200x1600) — sharp is available in test env
  pngBuffer = await sharp({
    create: {
      width: 1200,
      height: 1600,
      channels: 3,
      background: { r: 1, g: 1, b: 1 },
    },
  })
    .png()
    .toBuffer();

  // Generate a 1-page PDF via pdf-lib for SO buffer
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  soBuffer = Buffer.from(await doc.save());

  // A minimal "assembled" PDF for buildPhotoPdf stub return value
  const assembled = await PDFDocument.create();
  assembled.addPage([612, 792]);
  minimalPdfBytes = await assembled.save();
});

// ---------------------------------------------------------------------------
// Shared stub data
// ---------------------------------------------------------------------------

const FAKE_PROJECT = {
  projectId: "CO9999-TEST1",
  assets: { systemType: "Storage Only" },
};

const FAKE_DEAL = {
  id: "deal-42",
  properties: {
    hs_object_id: "deal-42",
    address_line_1: "123 Main St",
    city: "Denver",
    state: "CO",
    all_document_parent_folder_id: null,
    g_drive: null,
  },
};

const AUTHED_USER = {
  email: "zach@photonbrothers.com",
  name: "Zach",
  role: "ACCOUNTING",
  roles: ["ACCOUNTING"],
  ip: "127.0.0.1",
  userAgent: "jest",
};

function setupAuthOk() {
  mockRequireApiAuth.mockResolvedValue(AUTHED_USER);
}

function setupProject() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockListAllProjects.mockResolvedValue([FAKE_PROJECT as any]);
}

function setupDealContext() {
  mockResolveDealContext.mockResolvedValue({
    deal: FAKE_DEAL,
    ambiguous: false,
    rootFolderId: "root-folder-id",
    sourceFolderId: "src-folder-id",
    soBuffer: soBuffer,
    folderMapWarnings: [],
    peCode: FAKE_PROJECT.projectId,
  });
}

function setupVision() {
  mockIsUsableImage.mockReturnValue({ ok: true });
  mockUploadToAnthropic.mockResolvedValue("anthropic-file-id-001");
  mockTriagePhotoBatch.mockResolvedValue({
    assignments: new Map([
      [
        0,
        {
          checklistId: "m1.photos.1_site_address",
          verdict: "pass" as const,
          confidence: "high" as const,
          issues: [],
          equipmentVisible: [],
        },
      ],
    ]),
  });
}

function setupAssemble() {
  mockBuildPhotoPdf.mockResolvedValue(minimalPdfBytes);
  // orderPolicyPhotos is the real implementation — no mock setup needed
  mockFindOrCreatePeFolder.mockResolvedValue("pe-folder-id");
  mockUploadDriveBinaryFile.mockResolvedValue({ id: "uploaded-file-id", name: "test.pdf" });
}

function makeRequest(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Mock global fetch to return our PNG buffer
function setupFetch() {
  global.fetch = jest.fn(async (_url: RequestInfo | URL) => {
    const ab = pngBuffer.buffer.slice(
      pngBuffer.byteOffset,
      pngBuffer.byteOffset + pngBuffer.byteLength,
    );
    return {
      ok: true,
      arrayBuffer: async () => ab,
    } as Response;
  });
}

// ---------------------------------------------------------------------------
// TRIAGE tests (Task 5)
// ---------------------------------------------------------------------------

describe("POST /api/pe/photo-package/triage", () => {
  // Late-import to ensure mocks are hoisted first
  let POST: (req: NextRequest) => Promise<NextResponse>;

  beforeAll(async () => {
    const mod = await import("@/app/api/pe/photo-package/triage/route");
    POST = mod.POST;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    setupAuthOk();
    setupProject();
    setupDealContext();
    setupVision();
    setupFetch();
  });

  it("returns 401 when unauthenticated", async () => {
    mockRequireApiAuth.mockResolvedValue(
      NextResponse.json({ error: "Authentication required" }, { status: 401 })
    );
    const req = makeRequest("/api/pe/photo-package/triage", {
      code: "CO9999-TEST1",
      photos: [{ clientId: "c1", name: "a.png", blobUrl: "https://blob/a.png" }],
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 when code is missing", async () => {
    const req = makeRequest("/api/pe/photo-package/triage", {
      photos: [{ clientId: "c1", name: "a.png", blobUrl: "https://blob/a.png" }],
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when photos is empty", async () => {
    const req = makeRequest("/api/pe/photo-package/triage", {
      code: "CO9999-TEST1",
      photos: [],
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 404 when no deal is found at all", async () => {
    // resolveDealContext returns no deal (cascade exhausted)
    mockResolveDealContext.mockResolvedValue({ deal: null });
    const req = makeRequest("/api/pe/photo-package/triage", {
      code: "CO9999-NOTFOUND",
      photos: [{ clientId: "c1", name: "a.png", blobUrl: "https://blob/a.png" }],
    });
    const res = await POST(req);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/no deal found/i);
  });

  it("returns 404 with 'not linked to a PE project' when deal found but no PE project", async () => {
    // Deal resolved but pe_project_id is absent → ctx.peCode is null
    // listAllProjects returns a project with a different ID → no match
    mockResolveDealContext.mockResolvedValue({
      deal: FAKE_DEAL,
      ambiguous: false,
      rootFolderId: "root-folder-id",
      sourceFolderId: "src-folder-id",
      soBuffer: null,
      folderMapWarnings: [],
      peCode: null, // ← no PE code on this deal
    });
    mockListAllProjects.mockResolvedValue([FAKE_PROJECT as never]);
    const req = makeRequest("/api/pe/photo-package/triage", {
      code: "PROJ-1234",
      photos: [{ clientId: "c1", name: "a.png", blobUrl: "https://blob/a.png" }],
    });
    const res = await POST(req);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/isn't linked to a PE project/i);
  });

  it("resolves when given a PROJ number — uses ctx.peCode to look up the PE project", async () => {
    // resolveDealContext is already set up to return peCode: FAKE_PROJECT.projectId
    // via setupDealContext() called in beforeEach. listAllProjects returns FAKE_PROJECT.
    const req = makeRequest("/api/pe/photo-package/triage", {
      code: "PROJ-9999",
      photos: [{ clientId: "c1", name: "a.png", blobUrl: "https://blob/a.png" }],
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    // FAKE_PROJECT.assets.systemType = "Storage Only" → "battery"
    expect(body.systemType).toBe("battery");
  });

  it("returns 409 when deal is ambiguous", async () => {
    mockResolveDealContext.mockResolvedValue({
      deal: null,
      ambiguous: true,
      candidates: [
        { id: "d1", address: "123 Main St, Denver, CO", dealName: "Smith Solar PROJ-100" },
        { id: "d2", address: "456 Oak Ave, Denver, CO", dealName: "Jones Solar PROJ-101" },
      ],
    });
    const req = makeRequest("/api/pe/photo-package/triage", {
      code: "CO9999-TEST1",
      photos: [{ clientId: "c1", name: "a.png", blobUrl: "https://blob/a.png" }],
    });
    const res = await POST(req);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.candidates).toHaveLength(2);
  });

  it("returns 200 with correct systemType, soFound, coverage, and photo results", async () => {
    const req = makeRequest("/api/pe/photo-package/triage", {
      code: "CO9999-TEST1",
      photos: [{ clientId: "c1", name: "a.png", blobUrl: "https://blob/a.png" }],
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();

    // "Storage Only" → "battery"
    expect(body.systemType).toBe("battery");

    // SO buffer was provided
    expect(body.soFound).toBe(true);

    // Coverage: site_address (photo 1) matched → covered; msp (photo 5) → missing
    const siteShot = body.coverage.shots.find(
      (s: { id: string }) => s.id === "m1.photos.1_site_address"
    );
    expect(siteShot?.status).toBe("covered");

    const mspShot = body.coverage.shots.find(
      (s: { id: string }) => s.id === "m1.photos.5_msp"
    );
    expect(mspShot?.status).toBe("missing");

    // Photo result for c1 should be assigned to site_address with "pass" verdict
    const photoResult = body.photos.find((p: { clientId: string }) => p.clientId === "c1");
    expect(photoResult?.shot).toBe("m1.photos.1_site_address");
    expect(photoResult?.verdict).toBe("pass");
  });

  it("marks unusable images as skipped with null shot", async () => {
    // Make the image fail the usability check
    mockIsUsableImage.mockReturnValue({ ok: false, reason: "too small (50x50)" });
    const req = makeRequest("/api/pe/photo-package/triage", {
      code: "CO9999-TEST1",
      photos: [{ clientId: "c1", name: "tiny.png", blobUrl: "https://blob/tiny.png" }],
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    const photoResult = body.photos.find((p: { clientId: string }) => p.clientId === "c1");
    expect(photoResult?.shot).toBeNull();
  });

  it("returns 502 when vision service throws", async () => {
    mockTriagePhotoBatch.mockRejectedValue(new Error("Vision API error"));
    const req = makeRequest("/api/pe/photo-package/triage", {
      code: "CO9999-TEST1",
      photos: [{ clientId: "c1", name: "a.png", blobUrl: "https://blob/a.png" }],
    });
    const res = await POST(req);
    expect(res.status).toBe(502);
  });
});

// ---------------------------------------------------------------------------
// ASSEMBLE tests (Task 6)
// ---------------------------------------------------------------------------

describe("POST /api/pe/photo-package/assemble", () => {
  let POST: (req: NextRequest) => Promise<NextResponse>;

  beforeAll(async () => {
    const mod = await import("@/app/api/pe/photo-package/assemble/route");
    POST = mod.POST;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    setupAuthOk();
    setupDealContext();
    setupAssemble();
    setupFetch();
  });

  it("returns 401 when unauthenticated", async () => {
    mockRequireApiAuth.mockResolvedValue(
      NextResponse.json({ error: "Authentication required" }, { status: 401 })
    );
    const req = makeRequest("/api/pe/photo-package/assemble", {
      code: "CO9999-TEST1",
      assignments: [{ clientId: "c1", blobUrl: "https://blob/a.png", shotId: "m1.photos.1_site_address" }],
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 when no assignments have a shotId", async () => {
    const req = makeRequest("/api/pe/photo-package/assemble", {
      code: "CO9999-TEST1",
      assignments: [{ clientId: "c1", blobUrl: "https://blob/a.png", shotId: null }],
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns a PDF binary with content-type application/pdf and content-disposition", async () => {
    const req = makeRequest("/api/pe/photo-package/assemble", {
      code: "CO9999-TEST1",
      assignments: [
        { clientId: "c1", blobUrl: "https://blob/a.png", shotId: "m1.photos.1_site_address" },
      ],
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");

    const disposition = res.headers.get("content-disposition") ?? "";
    expect(disposition).toMatch(/attachment.*filename=/);

    const body = await res.arrayBuffer();
    expect(body.byteLength).toBeGreaterThan(0);
  });

  it("calls the Drive upload helper exactly once", async () => {
    const req = makeRequest("/api/pe/photo-package/assemble", {
      code: "CO9999-TEST1",
      assignments: [
        { clientId: "c1", blobUrl: "https://blob/a.png", shotId: "m1.photos.1_site_address" },
      ],
    });
    await POST(req);
    expect(mockUploadDriveBinaryFile).toHaveBeenCalledTimes(1);
  });

  it("does not 500 when Drive upload fails — returns PDF with warning header", async () => {
    mockFindOrCreatePeFolder.mockRejectedValue(new Error("Drive error"));
    const req = makeRequest("/api/pe/photo-package/assemble", {
      code: "CO9999-TEST1",
      assignments: [
        { clientId: "c1", blobUrl: "https://blob/a.png", shotId: "m1.photos.1_site_address" },
      ],
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const warnings = JSON.parse(res.headers.get("x-pe-warnings") ?? "[]") as string[];
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("soInsertIndex is the count of photos ordered before m1.photos.6_invoice_bom", async () => {
    // Provide 4 photos: shots 1, 4, 5 (rank 0,1,2 — BEFORE invoice_bom rank 3)
    // and shot 6_invoice_bom itself (rank 3 — NOT strictly before, so not counted).
    // Real orderPolicyPhotos (backed by the mock checklist) will order them by rank
    // and filter out any IDs not in the checklist.
    // Expected soInsertIndex = 3 (three photos ranked strictly before invoice_bom).
    const EXPECTED_SO_INSERT_INDEX = 3;

    // Make buildPhotoPdf return a real small PDF so the response body is non-empty
    const soDoc = await (await import("pdf-lib")).PDFDocument.create();
    soDoc.addPage([612, 792]);
    const smallPdf = await soDoc.save();
    mockBuildPhotoPdf.mockResolvedValue(smallPdf);

    const req = makeRequest("/api/pe/photo-package/assemble", {
      code: "CO9999-TEST1",
      assignments: [
        { clientId: "c1", blobUrl: "https://blob/p1.png", shotId: "m1.photos.1_site_address" },
        { clientId: "c4", blobUrl: "https://blob/p4.png", shotId: "m1.photos.4_electrical" },
        { clientId: "c5", blobUrl: "https://blob/p5.png", shotId: "m1.photos.5_msp" },
        { clientId: "c6", blobUrl: "https://blob/p6.png", shotId: "m1.photos.6_invoice_bom" },
      ],
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");

    // Verify buildPhotoPdf was called with the correct soInsertIndex
    expect(mockBuildPhotoPdf).toHaveBeenCalledTimes(1);
    const [, , soInsertIndex] = mockBuildPhotoPdf.mock.calls[0];
    expect(soInsertIndex).toBe(EXPECTED_SO_INSERT_INDEX);

    // Response body should be non-empty (real PDF bytes)
    const body = await res.arrayBuffer();
    expect(body.byteLength).toBeGreaterThan(0);
  });
});
