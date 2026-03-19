/**
 * Tests for the exported shouldRunPoCreation() gate in bom-pipeline.ts.
 *
 * Exercises the real function — not a reimplemented copy.
 *
 * Validates:
 *  1. RTB trigger + flag on → true
 *  2. RTB trigger + flag off → false
 *  3. MANUAL trigger + existing POs → true (continuation)
 *  4. MANUAL trigger + zero existing POs → false
 *  5. MANUAL trigger + flag on but no POs → false
 *  6. DESIGN_COMPLETE trigger → false regardless of flag
 *  7. DESIGN_COMPLETE trigger + existing POs → false
 *  8. undefined trigger → false
 */

// Mock heavy dependencies so the module can load in Jest without ESM issues.
// We only need the pure shouldRunPoCreation() export — everything else is unused.
jest.mock("@/lib/db", () => ({ prisma: null, logActivity: jest.fn() }));
jest.mock("@/lib/google-auth", () => ({ getServiceAccountToken: jest.fn() }));
jest.mock("@/lib/drive-plansets", () => ({}));
jest.mock("@/lib/bom-extract", () => ({}));
jest.mock("@/lib/bom-snapshot", () => ({}));
jest.mock("@/lib/bom-so-create", () => ({}));
jest.mock("@/lib/bom-po-create", () => ({}));
jest.mock("@/lib/hubspot", () => ({}));
jest.mock("@/lib/bom-customer-resolve", () => ({}));
jest.mock("@/lib/email", () => ({}));
jest.mock("@/lib/actor-context", () => ({ PIPELINE_ACTOR: {} }));
jest.mock("@/lib/anthropic", () => ({}));
jest.mock("@/lib/bom-pipeline-lock", () => ({}));
jest.mock("@/lib/zoho-inventory", () => ({ zohoInventory: { isConfigured: () => true } }));
jest.mock("@react-pdf/renderer", () => ({ renderToBuffer: jest.fn() }));
jest.mock("@/components/BomPdfDocument", () => ({}));

import { shouldRunPoCreation } from "@/lib/bom-pipeline";

describe("shouldRunPoCreation", () => {
  it("allows PO creation on RTB trigger when flag is on", () => {
    expect(shouldRunPoCreation("WEBHOOK_READY_TO_BUILD", true, 0)).toBe(true);
  });

  it("skips PO creation on RTB trigger when flag is off", () => {
    expect(shouldRunPoCreation("WEBHOOK_READY_TO_BUILD", false, 0)).toBe(false);
  });

  it("allows PO creation on MANUAL trigger with existing POs", () => {
    expect(shouldRunPoCreation("MANUAL", false, 2)).toBe(true);
  });

  it("skips PO creation on MANUAL trigger with zero existing POs", () => {
    expect(shouldRunPoCreation("MANUAL", false, 0)).toBe(false);
  });

  it("skips PO creation on MANUAL trigger even when flag is on but no POs exist", () => {
    expect(shouldRunPoCreation("MANUAL", true, 0)).toBe(false);
  });

  it("skips PO creation on DESIGN_COMPLETE regardless of flag", () => {
    expect(shouldRunPoCreation("WEBHOOK_DESIGN_COMPLETE", true, 0)).toBe(false);
  });

  it("skips PO creation on DESIGN_COMPLETE even with existing POs", () => {
    expect(shouldRunPoCreation("WEBHOOK_DESIGN_COMPLETE", true, 3)).toBe(false);
  });

  it("skips PO creation when trigger is undefined", () => {
    expect(shouldRunPoCreation(undefined, true, 0)).toBe(false);
  });
});
