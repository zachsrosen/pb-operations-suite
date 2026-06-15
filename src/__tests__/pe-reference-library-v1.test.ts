/**
 * Tests for the doc-level approved-on-v1 selector in pe-reference-library.ts.
 *
 * pe-reference-library transitively imports Prisma (via @/lib/db), HubSpot,
 * and pe-turnover (Zuper), none of which load cleanly under Jest. We mock the
 * heavy module boundaries so the pure `isApprovedOnV1` helper imports in
 * isolation. The mocks are inert — `isApprovedOnV1` never touches them.
 */

jest.mock("@/lib/db", () => ({ prisma: {} }));
jest.mock("@/lib/hubspot", () => ({ searchWithRetry: jest.fn() }));
jest.mock("@hubspot/api-client/lib/codegen/crm/deals", () => ({
  FilterOperatorEnum: { Eq: "EQ" },
}));
jest.mock("@/lib/pe-turnover", () => ({
  PE_M1_CHECKLIST: [],
  PE_M2_CHECKLIST: [],
  filterChecklist: jest.fn(),
  resolvePEDeal: jest.fn(),
  buildFolderMap: jest.fn(),
}));
jest.mock("@/lib/drive-plansets", () => ({
  listDriveFiles: jest.fn(),
  listDriveImagesRecursive: jest.fn(),
  downloadDriveFile: jest.fn(),
  downloadDriveImage: jest.fn(),
}));
jest.mock("@/lib/anthropic", () => ({ getAnthropicClient: jest.fn() }));

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
