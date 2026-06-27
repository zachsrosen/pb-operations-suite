/**
 * Tests for scheduler-v2 normalize helpers.
 * Exercises mapStage, getCustomerName, and isOverdue from scheduler-v2/normalize.ts.
 */
import { mapStage, getCustomerName, isOverdue } from "@/lib/scheduler-v2/normalize";

describe("mapStage", () => {
  // Exact HubSpot stage name matches
  it("maps 'Site Survey' → 'survey'", () => {
    expect(mapStage("Site Survey")).toBe("survey");
  });

  it("maps 'Ready To Build' → 'rtb'", () => {
    expect(mapStage("Ready To Build")).toBe("rtb");
  });

  it("maps 'RTB - Blocked' → 'blocked'", () => {
    expect(mapStage("RTB - Blocked")).toBe("blocked");
  });

  it("maps 'Construction' → 'construction'", () => {
    expect(mapStage("Construction")).toBe("construction");
  });

  it("maps 'Inspection' → 'inspection'", () => {
    expect(mapStage("Inspection")).toBe("inspection");
  });

  // Case-insensitive fallback
  it("maps lowercase 'site survey' → 'survey'", () => {
    expect(mapStage("site survey")).toBe("survey");
  });

  it("maps lowercase 'survey' → 'survey'", () => {
    expect(mapStage("survey")).toBe("survey");
  });

  it("maps lowercase 'ready to build' → 'rtb'", () => {
    expect(mapStage("ready to build")).toBe("rtb");
  });

  it("maps lowercase 'rtb' → 'rtb'", () => {
    expect(mapStage("rtb")).toBe("rtb");
  });

  it("maps lowercase 'rtb - blocked' → 'blocked'", () => {
    expect(mapStage("rtb - blocked")).toBe("blocked");
  });

  it("maps lowercase 'blocked' → 'blocked'", () => {
    expect(mapStage("blocked")).toBe("blocked");
  });

  it("maps lowercase 'construction' → 'construction'", () => {
    expect(mapStage("construction")).toBe("construction");
  });

  it("maps lowercase 'inspection' → 'inspection'", () => {
    expect(mapStage("inspection")).toBe("inspection");
  });

  // Unknown / empty
  it("returns 'other' for unknown stage", () => {
    expect(mapStage("Permitting & Interconnection")).toBe("other");
  });

  it("returns 'other' for empty string", () => {
    expect(mapStage("")).toBe("other");
  });

  it("returns 'other' for null", () => {
    expect(mapStage(null)).toBe("other");
  });

  it("returns 'other' for undefined", () => {
    expect(mapStage(undefined)).toBe("other");
  });

  // Whitespace trimming
  it("trims whitespace before mapping", () => {
    expect(mapStage("  Construction  ")).toBe("construction");
  });
});

describe("getCustomerName", () => {
  it("extracts name from full pipe-delimited string", () => {
    expect(getCustomerName("PROJ-9031 | Smith, John | 123 Main")).toBe("Smith, John");
  });

  it("extracts name from 2-part string", () => {
    expect(getCustomerName("PROJ-9031 | Smith, John")).toBe("Smith, John");
  });

  it("returns full string when no pipe delimiter exists", () => {
    expect(getCustomerName("Smith, John")).toBe("Smith, John");
  });

  it("handles empty string by returning empty string", () => {
    expect(getCustomerName("")).toBe("");
  });

  it("handles leading pipe (empty project number)", () => {
    // " | Smith, John" → second segment is "Smith, John"
    expect(getCustomerName(" | Smith, John")).toBe("Smith, John");
  });
});

describe("isOverdue", () => {
  // Fixed "today" to avoid test flakiness
  const TODAY = "2026-06-26";

  describe("construction (multi-day) work items", () => {
    it("is not overdue when scheduled end is in the future", () => {
      // start=2026-06-25 (Wed), durationDays=2 → business end = Thu 06-25+1bd = Fri 06-26 → overdue Thu 06-27
      // With today=06-26, not yet overdue
      expect(isOverdue("2026-06-25", 2, "scheduled", false, TODAY)).toBe(false);
    });

    it("is overdue when the day after the business end has passed", () => {
      // start=2026-06-23 (Mon), durationDays=2 → business end = Tue 06-24 → overdue 06-25
      // today=06-26 → overdue
      expect(isOverdue("2026-06-23", 2, "scheduled", false, TODAY)).toBe(true);
    });

    it("is not overdue on the last day of the job (end date = today)", () => {
      // start=2026-06-25 (Wed), durationDays=1 → business end = Wed 06-25 → overdue 06-26
      // today=06-26, so overdue exactly on 06-26 (endDate < today fails — endDate IS today)
      // Per v1 logic: endDate < today (strict less than), so on the end date itself it's NOT overdue
      expect(isOverdue("2026-06-25", 1, "scheduled", false, TODAY)).toBe(false);
    });

    it("becomes overdue the day AFTER the end date", () => {
      // start=2026-06-24 (Tue), durationDays=1 → end = Tue 06-24 → overdue 06-25
      // today=06-26 → is overdue
      expect(isOverdue("2026-06-24", 1, "scheduled", false, TODAY)).toBe(true);
    });
  });

  describe("non-construction (single-day) work items", () => {
    it("is not overdue when scheduled date is today", () => {
      // schedMidnight = 06-26, today = 06-26 → not overdue (strict less than)
      expect(isOverdue("2026-06-26", 1, "scheduled", true, TODAY)).toBe(false);
    });

    it("is overdue when scheduled date is before today", () => {
      // schedMidnight = 06-25 < today 06-26 → overdue
      expect(isOverdue("2026-06-25", 1, "scheduled", true, TODAY)).toBe(true);
    });
  });

  describe("done / completed status", () => {
    it("is never overdue when status is done", () => {
      expect(isOverdue("2026-06-01", 5, "done", false, TODAY)).toBe(false);
    });

    it("is never overdue when status is cancelled", () => {
      expect(isOverdue("2026-06-01", 5, "cancelled", false, TODAY)).toBe(false);
    });
  });

  describe("future dates", () => {
    it("is not overdue for a future construction start", () => {
      expect(isOverdue("2026-07-01", 3, "scheduled", false, TODAY)).toBe(false);
    });

    it("is not overdue for a future single-day item", () => {
      expect(isOverdue("2026-07-01", 1, "survey", true, TODAY)).toBe(false);
    });
  });
});
