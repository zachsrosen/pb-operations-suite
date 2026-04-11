import {
  getCustomerName,
  formatAssignee,
  isOverdue,
  toCalendarProject,
  generateProjectEvents,
  generateZuperEvents,
  expandToDayPills,
  type RawApiProject,
  type CalendarProject,
  type ZuperCategoryJob,
  type CalendarEvent,
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

describe("generateZuperEvents", () => {
  const baseJob: ZuperCategoryJob = {
    jobUid: "zuper-1",
    title: "Service Visit — Jones",
    categoryName: "Service Visit",
    categoryUid: "cff6f839-c043-46ee-a09f-8d0e9f363437",
    statusName: "Started",
    statusColor: "#00ff00",
    dueDate: "2026-04-15",
    scheduledStart: "2026-04-15T14:00:00Z",
    scheduledEnd: "2026-04-15T16:00:00Z",
    customerName: "Jones",
    address: "123 Main St, Westminster, CO",
    city: "Westminster",
    state: "CO",
    assignedUser: "Mike Thompson",
    assignedUsers: ["Mike Thompson"],
    teamName: "Westminster Team",
    hubspotDealId: "12345",
    jobTotal: 500,
    createdAt: "2026-04-10T10:00:00Z",
    workOrderNumber: "WO-001",
  };

  it("generates a service event from a Zuper job", () => {
    const events = generateZuperEvents([baseJob], "service", "Westminster");
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe("service");
    expect(events[0].date).toBe("2026-04-15");
    expect(events[0].name).toBe("Jones");
    expect(events[0].assignee).toBe("Mike T.");
  });

  it("filters by location — uses teamName normalization", () => {
    const events = generateZuperEvents([baseJob], "service", "Centennial");
    expect(events).toHaveLength(0);
  });

  it("uses dueDate when scheduledStart is null", () => {
    const job: ZuperCategoryJob = {
      ...baseJob,
      scheduledStart: null,
      scheduledEnd: null,
    };
    const events = generateZuperEvents([job], "service", "Westminster");
    expect(events[0].date).toBe("2026-04-15");
  });

  it("skips jobs with no date", () => {
    const job: ZuperCategoryJob = {
      ...baseJob,
      scheduledStart: null,
      scheduledEnd: null,
      dueDate: "",
    };
    const events = generateZuperEvents([job], "service", "Westminster");
    expect(events).toHaveLength(0);
  });

  it("generates dnr events with correct eventType", () => {
    const events = generateZuperEvents([baseJob], "dnr", "Westminster");
    expect(events[0].eventType).toBe("dnr");
  });
});

describe("expandToDayPills", () => {
  const makeEvent = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
    id: "deal-1-construction",
    projectId: "deal-1",
    name: "Smith Residence",
    date: "2026-04-14",
    days: 3,
    eventType: "construction",
    assignee: "DTC Alpha",
    isCompleted: false,
    isOverdue: false,
    isFailed: false,
    amount: 45000,
    ...overrides,
  });

  it("expands a 3-day event into 3 pills on consecutive days", () => {
    const result = expandToDayPills([makeEvent()], 2026, 4);
    const apr14 = result.get("2026-04-14") || [];
    const apr15 = result.get("2026-04-15") || [];
    const apr16 = result.get("2026-04-16") || [];

    expect(apr14).toHaveLength(1);
    expect(apr14[0].dayIndex).toBe(1);
    expect(apr14[0].totalDays).toBe(3);
    expect(apr14[0].isFirstDay).toBe(true);

    expect(apr15).toHaveLength(1);
    expect(apr15[0].dayIndex).toBe(2);
    expect(apr15[0].isFirstDay).toBe(false);

    expect(apr16).toHaveLength(1);
    expect(apr16[0].dayIndex).toBe(3);
    expect(apr16[0].isFirstDay).toBe(false);
  });

  it("clips pills that fall outside the visible month", () => {
    const event = makeEvent({ date: "2026-04-29", days: 5 });
    const result = expandToDayPills([event], 2026, 4);
    expect(result.get("2026-04-29")).toHaveLength(1);
    expect(result.get("2026-04-30")).toHaveLength(1);
    expect(result.has("2026-05-01")).toBe(false);
  });

  it("includes continuation days from events starting in previous month", () => {
    const event = makeEvent({ date: "2026-03-30", days: 4 });
    const result = expandToDayPills([event], 2026, 4);
    expect(result.has("2026-03-30")).toBe(false);
    expect(result.has("2026-03-31")).toBe(false);
    expect(result.get("2026-04-01")).toHaveLength(1);
    expect(result.get("2026-04-01")![0].dayIndex).toBe(3);
    expect(result.get("2026-04-02")).toHaveLength(1);
    expect(result.get("2026-04-02")![0].dayIndex).toBe(4);
  });

  it("single-day event produces one pill with dayIndex=1, totalDays=1", () => {
    const event = makeEvent({ days: 1 });
    const result = expandToDayPills([event], 2026, 4);
    const pills = result.get("2026-04-14") || [];
    expect(pills).toHaveLength(1);
    expect(pills[0].dayIndex).toBe(1);
    expect(pills[0].totalDays).toBe(1);
    expect(pills[0].isFirstDay).toBe(true);
  });

  it("multiple events on same day stack in the map", () => {
    const event1 = makeEvent({ id: "a", date: "2026-04-14", days: 1 });
    const event2 = makeEvent({
      id: "b",
      date: "2026-04-14",
      days: 1,
      eventType: "survey",
      name: "Jones",
    });
    const result = expandToDayPills([event1, event2], 2026, 4);
    expect(result.get("2026-04-14")).toHaveLength(2);
  });
});
