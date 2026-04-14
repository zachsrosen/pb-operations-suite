import { FIELD_LABELS } from "@/components/deal-detail/section-registry";

describe("FIELD_LABELS", () => {
  it("maps known column names to human-readable labels", () => {
    expect(FIELD_LABELS["address"]).toBe("Address");
    expect(FIELD_LABELS["siteSurveyScheduleDate"]).toBe("Survey Scheduled");
    expect(FIELD_LABELS["installCrew"]).toBe("Install Crew");
    expect(FIELD_LABELS["designCompletionDate"]).toBe("Design Completed");
  });

  it("includes fields from all remaining sections", () => {
    // Project Details, Milestone Dates, Status Details, Install Planning, Service, Roofing
    expect(Object.keys(FIELD_LABELS).length).toBeGreaterThan(50);
  });
});
