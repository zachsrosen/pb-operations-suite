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

// pe-photo-submit — avoid pulling in pe-turnover via its import
jest.mock("@/lib/pe-photo-submit", () => ({
  isUsableImage: jest.fn(),
  orderPolicyPhotos: jest.fn((photos: Array<{ fileId: string; shotId: string }>) => photos),
  policyPhotosFilename: jest.fn(
    (addr: { street?: string; city?: string }) =>
      `${addr.street ?? "UNKNOWN"}_${addr.city ?? ""}.pdf`
  ),
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
}));

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
import { isUsableImage, orderPolicyPhotos } from "@/lib/pe-photo-submit";
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
const mockOrderPolicyPhotos = orderPolicyPhotos as jest.MockedFunction<typeof orderPolicyPhotos>;

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
  mockOrderPolicyPhotos.mockImplementation((photos) => photos);
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

  it("returns 404 when project not found", async () => {
    mockListAllProjects.mockResolvedValue([]);
    const req = makeRequest("/api/pe/photo-package/triage", {
      code: "CO9999-NOTFOUND",
      photos: [{ clientId: "c1", name: "a.png", blobUrl: "https://blob/a.png" }],
    });
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it("returns 409 when deal is ambiguous", async () => {
    mockResolveDealContext.mockResolvedValue({
      deal: null,
      ambiguous: true,
      candidates: [
        { id: "d1", address: "123 Main St, Denver, CO" },
        { id: "d2", address: "456 Oak Ave, Denver, CO" },
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
});
