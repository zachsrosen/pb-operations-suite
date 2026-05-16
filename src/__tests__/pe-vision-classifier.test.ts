import { visionResultToEnriched, type VisionResult } from "@/lib/pe-vision-classifier";

describe("visionResultToEnriched", () => {
  it("maps error result to needs_review", () => {
    const result: VisionResult = { kind: "error", error: "API timeout" };
    const enriched = visionResultToEnriched(result);
    expect(enriched).not.toBeNull();
    expect(enriched!.status).toBe("needs_review");
    expect(enriched!.confidence).toBe("low");
    expect(enriched!.issues).toEqual(["API timeout"]);
  });

  it("maps high-confidence document with no issues to pass", () => {
    const result: VisionResult = {
      kind: "document",
      classification: {
        matchedChecklistIds: ["m1.contract.customer_agreement"],
        confidence: "high",
        documentType: "Customer Agreement",
        issues: [],
        signatures: { present: true, count: 2, allSigned: true },
      },
    };
    const enriched = visionResultToEnriched(result);
    expect(enriched!.status).toBe("pass");
    expect(enriched!.signatures?.allSigned).toBe(true);
  });

  it("maps low-confidence document to needs_review", () => {
    const result: VisionResult = {
      kind: "document",
      classification: {
        matchedChecklistIds: ["m1.contract.utility_bill"],
        confidence: "low",
        documentType: "Utility Bill",
        issues: [],
        signatures: { present: false, count: 0, allSigned: false },
      },
    };
    const enriched = visionResultToEnriched(result);
    expect(enriched!.status).toBe("needs_review");
  });

  it("maps document with issues to needs_review", () => {
    const result: VisionResult = {
      kind: "document",
      classification: {
        matchedChecklistIds: ["m1.contract.customer_agreement"],
        confidence: "high",
        documentType: "Customer Agreement",
        issues: ["Missing signature on page 3"],
        signatures: { present: true, count: 1, allSigned: false },
      },
    };
    const enriched = visionResultToEnriched(result);
    expect(enriched!.status).toBe("needs_review");
    expect(enriched!.issues).toEqual(["Missing signature on page 3"]);
  });

  it("maps photo pass verdict", () => {
    const result: VisionResult = {
      kind: "photo",
      verification: {
        matchedChecklistId: "m1.photos.2_pv_array",
        requirement: "Wide-angle PV array",
        verdict: "pass",
        issues: [],
        equipmentVisible: ["REC Alpha 400W", "IronRidge XR100"],
        confidence: "high",
      },
    };
    const enriched = visionResultToEnriched(result);
    expect(enriched!.status).toBe("pass");
    expect(enriched!.equipmentVisible).toEqual(["REC Alpha 400W", "IronRidge XR100"]);
  });

  it("maps photo fail verdict", () => {
    const result: VisionResult = {
      kind: "photo",
      verification: {
        matchedChecklistId: "m1.photos.5_msp",
        requirement: "Main service panel (cover off)",
        verdict: "fail",
        issues: ["Panel cover is still on"],
        equipmentVisible: [],
        confidence: "high",
      },
    };
    const enriched = visionResultToEnriched(result);
    expect(enriched!.status).toBe("fail");
    expect(enriched!.issues).toEqual(["Panel cover is still on"]);
  });
});
