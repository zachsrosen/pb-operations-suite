import {
  getCustomerName,
  formatAssignee,
  isOverdue,
  toCalendarProject,
  type RawApiProject,
} from "@/lib/calendar-events";

describe("getCustomerName", () => {
  it("extracts customer name from pipe-delimited string", () => {
    expect(getCustomerName("PROJ-001 | Smith")).toBe("Smith");
  });

  it("returns full name when no pipe delimiter", () => {
    expect(getCustomerName("John Smith")).toBe("John Smith");
  });

  it("handles empty string", () => {
    expect(getCustomerName("")).toBe("");
  });

  it("handles multiple pipes — takes second segment only", () => {
    expect(getCustomerName("A | B | C")).toBe("B");
  });
});

describe("formatAssignee", () => {
  it("formats first name + last initial", () => {
    expect(formatAssignee("John Doe")).toBe("John D.");
  });

  it("returns single name as-is", () => {
    expect(formatAssignee("John")).toBe("John");
  });

  it("handles null/undefined as empty string", () => {
    expect(formatAssignee(null)).toBe("");
    expect(formatAssignee(undefined)).toBe("");
  });

  it("formats multi-word names (crew names use p.crew directly, not this function)", () => {
    expect(formatAssignee("DTC Alpha")).toBe("DTC A.");
  });

  it("trims whitespace", () => {
    expect(formatAssignee("  Jane Smith  ")).toBe("Jane S.");
  });
});

describe("isOverdue", () => {
  const today = new Date(2026, 3, 11); // April 11, 2026
  today.setHours(0, 0, 0, 0);

  it("returns false for completed events", () => {
    expect(isOverdue("2026-04-01", 1, true, false, today)).toBe(false);
  });

  it("survey: not overdue on its scheduled day", () => {
    expect(isOverdue("2026-04-11", 1, false, false, today)).toBe(false);
  });

  it("survey: overdue the day after", () => {
    expect(isOverdue("2026-04-10", 1, false, false, today)).toBe(true);
  });

  it("construction 3-day: not overdue during the span", () => {
    expect(isOverdue("2026-04-09", 3, false, true, today)).toBe(false);
  });

  it("construction 3-day: overdue the day after span ends", () => {
    expect(isOverdue("2026-04-07", 3, false, true, today)).toBe(true);
  });

  it("construction 1-day: not overdue same day", () => {
    expect(isOverdue("2026-04-10", 1, false, true, today)).toBe(false);
  });

  it("construction 1-day: overdue the next day", () => {
    expect(isOverdue("2026-04-09", 1, false, true, today)).toBe(true);
  });
});

describe("toCalendarProject", () => {
  const baseRaw: RawApiProject = {
    id: 12345,
    name: "PB-001 | Smith Residence",
    pbLocation: "Westminster",
    amount: 45000,
    stage: "Construction",
    installCrew: "DTC Alpha",
    expectedDaysForInstall: 3,
    daysForInstallers: 2,
    constructionScheduleDate: "2026-04-14",
    inspectionScheduleDate: null,
    siteSurveyScheduleDate: "2026-04-07",
    siteSurveyCompletionDate: "2026-04-07",
    constructionCompleteDate: null,
    inspectionPassDate: null,
    finalInspectionStatus: null,
  };

  it("maps API Project fields to CalendarProject fields", () => {
    const result = toCalendarProject(baseRaw);
    expect(result.id).toBe("12345");
    expect(result.location).toBe("Westminster");
    expect(result.crew).toBe("DTC Alpha");
    expect(result.surveyScheduleDate).toBe("2026-04-07");
    expect(result.surveyCompleted).toBe("2026-04-07");
    expect(result.constructionScheduleDate).toBe("2026-04-14");
    expect(result.constructionCompleted).toBeNull();
    expect(result.daysInstall).toBe(2);
  });

  it("derives scheduleDate from stage — construction stage uses constructionScheduleDate", () => {
    const result = toCalendarProject(baseRaw);
    expect(result.scheduleDate).toBe("2026-04-14");
  });

  it("derives scheduleDate from stage — survey stage uses siteSurveyScheduleDate", () => {
    const raw: RawApiProject = { ...baseRaw, stage: "Site Survey" };
    const result = toCalendarProject(raw);
    expect(result.scheduleDate).toBe("2026-04-07");
  });

  it("derives scheduleDate from stage — inspection stage uses inspectionScheduleDate", () => {
    const raw: RawApiProject = {
      ...baseRaw,
      stage: "Inspection",
      inspectionScheduleDate: "2026-04-20",
    };
    const result = toCalendarProject(raw);
    expect(result.scheduleDate).toBe("2026-04-20");
  });

  it("maps inspectionPassDate to inspectionCompleted", () => {
    const raw: RawApiProject = {
      ...baseRaw,
      inspectionPassDate: "2026-04-20",
    };
    const result = toCalendarProject(raw);
    expect(result.inspectionCompleted).toBe("2026-04-20");
  });

  it("maps finalInspectionStatus to inspectionStatus", () => {
    const raw: RawApiProject = {
      ...baseRaw,
      finalInspectionStatus: "Fail",
    };
    const result = toCalendarProject(raw);
    expect(result.inspectionStatus).toBe("Fail");
  });

  it("falls back to expectedDaysForInstall when daysForInstallers is 0", () => {
    const raw: RawApiProject = {
      ...baseRaw,
      daysForInstallers: 0,
      expectedDaysForInstall: 4,
    };
    const result = toCalendarProject(raw);
    expect(result.daysInstall).toBe(4);
  });
});
