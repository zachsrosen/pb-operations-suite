import { FIELD_LABELS } from "@/components/deal-detail/section-registry";

// Noise field filtering is internal to deal-timeline.ts fetchSyncEvents,
// so we test the FIELD_LABELS contract here.

describe("FIELD_LABELS", () => {
  it("maps known deal properties to human-readable labels", () => {
    // Spot-check a few known fields from section-registry
    expect(FIELD_LABELS["address"]).toBe("Address");
    expect(FIELD_LABELS["siteSurveyScheduleDate"]).toBe("Survey Scheduled");
    expect(FIELD_LABELS["amount"]).toBe("Amount");
    expect(typeof FIELD_LABELS["address"]).toBe("string");
  });

  it("does not include noise fields", () => {
    expect(FIELD_LABELS["lastmodifieddate"]).toBeUndefined();
    expect(FIELD_LABELS["hs_lastmodifieddate"]).toBeUndefined();
    expect(FIELD_LABELS["notes_last_updated"]).toBeUndefined();
    expect(FIELD_LABELS["hs_object_id"]).toBeUndefined();
  });
});

describe("SYNC_NOISE_FIELDS filtering", () => {
  it("noise fields are not present in FIELD_LABELS (they are HubSpot system fields)", () => {
    const noiseFields = ["lastmodifieddate", "hs_lastmodifieddate", "notes_last_updated", "hs_object_id"];
    for (const field of noiseFields) {
      expect(FIELD_LABELS[field]).toBeUndefined();
    }
  });
});

describe("STATIC_FIELD_LABELS fallback", () => {
  it("covers deal fields that are not rendered in any section (ownership, equipment, flags)", () => {
    // Fields not in any SECTION_REGISTRY section but can change via sync
    expect(FIELD_LABELS["dealOwnerName"]).toBe("Deal Owner");
    expect(FIELD_LABELS["customerName"]).toBe("Customer");
    expect(FIELD_LABELS["moduleBrand"]).toBe("Module Brand");
    expect(FIELD_LABELS["batterySizeKwh"]).toBe("Battery Size (kWh)");
    expect(FIELD_LABELS["isPermitIssued"]).toBe("Permit Issued");
    expect(FIELD_LABELS["totalRevisionCount"]).toBe("Total Revisions");
  });
});
