import {
  dealPropertyMap,
  mapHubSpotToDeal,
  msToDays,
  DEAL_SYNC_PROPERTIES,
} from "@/lib/deal-property-map";

describe("deal-property-map", () => {
  describe("msToDays", () => {
    it("converts milliseconds to days (1 decimal)", () => {
      expect(msToDays("86400000")).toBe(1);
      expect(msToDays("172800000")).toBe(2);
      expect(msToDays("129600000")).toBe(1.5); // 1.5 days
    });
    it("returns null for null input", () => {
      expect(msToDays(null)).toBeNull();
    });
    it("returns null for empty string", () => {
      expect(msToDays("")).toBeNull();
    });
  });

  describe("DEAL_SYNC_PROPERTIES", () => {
    it("includes all mapped HubSpot properties", () => {
      const mappedProps = Object.keys(dealPropertyMap);
      for (const prop of mappedProps) {
        expect(DEAL_SYNC_PROPERTIES).toContain(prop);
      }
    });
    it("includes hs_lastmodifieddate for watermark", () => {
      expect(DEAL_SYNC_PROPERTIES).toContain("hs_lastmodifieddate");
    });
  });

  describe("mapHubSpotToDeal", () => {
    it("maps basic string fields", () => {
      const result = mapHubSpotToDeal({ dealname: "Test Deal" });
      expect(result.dealName).toBe("Test Deal");
    });

    it("maps decimal fields", () => {
      const result = mapHubSpotToDeal({ amount: "50000" });
      expect(result.amount).toBe(50000);
    });

    it("maps datetime fields", () => {
      const result = mapHubSpotToDeal({
        closedate: "2026-04-10T00:00:00.000Z",
      });
      expect(result.closeDate).toBeInstanceOf(Date);
    });

    it("maps boolean fields from HubSpot string", () => {
      const result = mapHubSpotToDeal({
        is_site_survey_scheduled_: "true",
      });
      expect(result.isSiteSurveyScheduled).toBe(true);
    });

    it("converts QC metrics from ms to days", () => {
      const result = mapHubSpotToDeal({
        site_survey_turnaround_time: "172800000",
      });
      expect(result.siteSurveyTurnaroundDays).toBe(2);
    });

    it("maps int fields", () => {
      const result = mapHubSpotToDeal({ module_count: "24" });
      expect(result.moduleCount).toBe(24);
    });

    it("skips null/undefined values without error", () => {
      const result = mapHubSpotToDeal({
        dealname: "Test",
        amount: null,
        closedate: undefined,
      });
      expect(result.dealName).toBe("Test");
      expect(result.amount).toBeNull();
    });

    it("computes isParticipateEnergy from tags", () => {
      const result = mapHubSpotToDeal({
        tags: "Participate Energy;Other Tag",
      });
      expect(result.isParticipateEnergy).toBe(true);
    });

    it("computes hubspotUrl from deal ID", () => {
      const result = mapHubSpotToDeal(
        { hs_object_id: "12345" },
        { portalId: "99999" }
      );
      // IMPORTANT: The correct URL format uses /record/0-3/ NOT /deal/
      // This matches the existing format in src/lib/hubspot.ts:880
      expect(result.hubspotUrl).toBe(
        "https://app.hubspot.com/contacts/99999/record/0-3/12345"
      );
    });

    it("computes departmentLeads JSON from dept lead properties", () => {
      const result = mapHubSpotToDeal({
        design: "Alice",
        permit_tech: "Bob",
        interconnections_tech: "Carol",
        rtb_lead: null,
      });
      expect(result.departmentLeads).toEqual({
        design: "Alice",
        permit_tech: "Bob",
        interconnections_tech: "Carol",
        rtb_lead: null,
      });
    });

    it("falls back to os_project_link for openSolarUrl", () => {
      const result = mapHubSpotToDeal({
        os_project_link: "https://opensolar.com/project/123",
      });
      expect(result.openSolarUrl).toBe("https://opensolar.com/project/123");
    });

    it("computes hubspotUpdatedAt from hs_lastmodifieddate", () => {
      const result = mapHubSpotToDeal({
        hs_lastmodifieddate: "2026-04-10T12:00:00.000Z",
      });
      expect(result.hubspotUpdatedAt).toBeInstanceOf(Date);
    });
  });
});
