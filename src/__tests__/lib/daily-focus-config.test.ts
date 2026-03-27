import {
  PI_LEADS,
  DESIGN_LEADS,
  PI_QUERY_DEFS,
  DESIGN_QUERY_DEFS,
  EXCLUDED_STAGES,
  MANAGER_EMAIL,
} from "@/lib/daily-focus/config";

describe("daily-focus config", () => {
  test("every PI lead has a valid email and at least one role", () => {
    for (const lead of PI_LEADS) {
      expect(lead.email).toMatch(/@photonbrothers\.com$/);
      expect(lead.roles.length).toBeGreaterThan(0);
    }
  });

  test("every Design lead has a valid email", () => {
    for (const lead of DESIGN_LEADS) {
      expect(lead.email).toMatch(/@photonbrothers\.com$/);
    }
  });

  test("no duplicate status values within a single query def", () => {
    for (const def of [...PI_QUERY_DEFS, ...DESIGN_QUERY_DEFS]) {
      const all = [...def.readyStatuses, ...(def.resubmitStatuses ?? [])];
      const unique = new Set(all);
      expect(unique.size).toBe(all.length);
    }
  });

  test("EXCLUDED_STAGES is non-empty", () => {
    expect(EXCLUDED_STAGES.length).toBeGreaterThan(0);
  });

  test("manager email is set", () => {
    expect(MANAGER_EMAIL).toMatch(/@photonbrothers\.com$/);
  });
});
