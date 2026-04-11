import {
  getCustomerName,
  formatAssignee,
  isOverdue,
  toCalendarProject,
  generateProjectEvents,
  type RawApiProject,
  type CalendarProject,
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

describe("generateProjectEvents", () => {
  const baseProject: CalendarProject = {
    id: "deal-1",
    name: "PB-001 | Smith Residence",
    location: "Westminster",
    amount: 45000,
    stage: "construction",
    crew: "DTC Alpha",
    daysInstall: 3,
    scheduleDate: null,
    constructionScheduleDate: "2026-04-14",
    inspectionScheduleDate: null,
    surveyScheduleDate: "2026-04-07",
    surveyCompleted: "2026-04-07",
    constructionCompleted: null,
    inspectionCompleted: null,
    inspectionStatus: null,
    zuperScheduledStart: null,
    zuperScheduledEnd: null,
    zuperJobCategory: null,
  };

  it("generates survey-complete + construction events", () => {
    const events = generateProjectEvents([baseProject], "Westminster");
    expect(events).toHaveLength(2);

    const survey = events.find(e => e.eventType === "survey-complete");
    expect(survey).toBeDefined();
    expect(survey!.date).toBe("2026-04-07");
    expect(survey!.days).toBe(1);
    expect(survey!.isCompleted).toBe(true);
    expect(survey!.name).toBe("Smith Residence");

    const construction = events.find(e => e.eventType === "construction");
    expect(construction).toBeDefined();
    expect(construction!.date).toBe("2026-04-14");
    expect(construction!.days).toBe(3);
    expect(construction!.assignee).toBe("DTC Alpha");
  });

  it("filters by location — excludes non-matching projects", () => {
    const events = generateProjectEvents([baseProject], "Centennial");
    expect(events).toHaveLength(0);
  });

  it("prefers Zuper start date for construction when zuperJobCategory is construction", () => {
    const withZuper: CalendarProject = {
      ...baseProject,
      zuperScheduledStart: "2026-04-15T07:00:00Z",
      zuperJobCategory: "construction",
    };
    const events = generateProjectEvents([withZuper], "Westminster");
    const construction = events.find(e => e.eventType === "construction");
    expect(construction!.date).toBe("2026-04-15");
  });

  it("ignores Zuper date when zuperJobCategory is not construction", () => {
    const withZuper: CalendarProject = {
      ...baseProject,
      zuperScheduledStart: "2026-04-15T07:00:00Z",
      zuperJobCategory: "survey",
    };
    const events = generateProjectEvents([withZuper], "Westminster");
    const construction = events.find(e => e.eventType === "construction");
    expect(construction!.date).toBe("2026-04-14");
  });

  it("generates inspection-fail event", () => {
    const proj: CalendarProject = {
      ...baseProject,
      inspectionScheduleDate: "2026-04-20",
      inspectionCompleted: "2026-04-20",
      inspectionStatus: "Fail",
    };
    const events = generateProjectEvents([proj], "Westminster");
    const insp = events.find(e => e.eventType === "inspection-fail");
    expect(insp).toBeDefined();
    expect(insp!.isFailed).toBe(true);
  });

  it("generates rtb fallback when stage is rtb with scheduleDate but no constructionScheduleDate", () => {
    const proj: CalendarProject = {
      ...baseProject,
      stage: "rtb",
      constructionScheduleDate: null,
      scheduleDate: "2026-04-21",
    };
    const events = generateProjectEvents([proj], "Westminster");
    const rtb = events.find(e => e.eventType === "rtb");
    expect(rtb).toBeDefined();
    expect(rtb!.date).toBe("2026-04-21");
  });

  it("normalizes DTC location to Centennial", () => {
    const proj: CalendarProject = {
      ...baseProject,
      location: "DTC",
    };
    const events = generateProjectEvents([proj], "Centennial");
    expect(events.length).toBeGreaterThan(0);
  });
});
