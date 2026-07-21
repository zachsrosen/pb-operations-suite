import {
  formatDateRanges,
  formatDayShort,
  formatShiftWindow,
  formatTime12h,
  groupWeekAssignments,
  reminderSubject,
  type ReminderAssignmentRow,
} from "@/lib/on-call-reminders";

function row(date: string, crewMemberId: string, name: string, email: string | null = `${crewMemberId}@photonbrothers.com`): ReminderAssignmentRow {
  return { date, crewMemberId, crewMember: { name, email } };
}

describe("groupWeekAssignments", () => {
  it("groups a full Mon–Sun week under one member", () => {
    const rows = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"].map(
      (d) => row(d, "daniel", "Daniel Kelly"),
    );
    const groups = groupWeekAssignments(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("Daniel Kelly");
    expect(groups[0].dates).toHaveLength(7);
    expect(groups[0].dates[0]).toBe("2026-11-02");
  });

  it("splits a swapped week into one group per member, ordered by first held day", () => {
    const rows = [
      row("2026-08-13", "b", "Covering Person"),
      row("2026-08-10", "a", "Original Person"),
      row("2026-08-11", "a", "Original Person"),
      row("2026-08-14", "b", "Covering Person"),
      row("2026-08-12", "a", "Original Person"),
    ];
    const groups = groupWeekAssignments(rows);
    expect(groups.map((g) => g.name)).toEqual(["Original Person", "Covering Person"]);
    expect(groups[0].dates).toEqual(["2026-08-10", "2026-08-11", "2026-08-12"]);
    expect(groups[1].dates).toEqual(["2026-08-13", "2026-08-14"]);
  });

  it("returns empty for an empty week (published horizon exhausted)", () => {
    expect(groupWeekAssignments([])).toEqual([]);
  });

  it("preserves a null email so the caller can skip-and-warn", () => {
    const groups = groupWeekAssignments([row("2026-11-02", "x", "No Email", null)]);
    expect(groups[0].email).toBeNull();
  });
});

describe("formatDateRanges", () => {
  it("renders a contiguous Mon–Sun week as one range", () => {
    const dates = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"];
    expect(formatDateRanges(dates)).toBe("Mon, Nov 2 – Sun, Nov 8");
  });

  it("renders a Mon–Sat California week (no Sunday row) as one range", () => {
    const dates = ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-08"];
    expect(formatDateRanges(dates)).toBe("Mon, Aug 3 – Sat, Aug 8");
  });

  it("splits gapped dates into comma-joined segments", () => {
    expect(formatDateRanges(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-07"])).toBe(
      "Mon, Nov 2 – Wed, Nov 4, Sat, Nov 7",
    );
  });

  it("handles a month boundary inside one range", () => {
    const dates = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"];
    expect(formatDateRanges(dates)).toBe("Mon, Oct 26 – Sun, Nov 1");
  });

  it("renders a single day without a dash", () => {
    expect(formatDateRanges(["2026-11-07"])).toBe("Sat, Nov 7");
  });

  it("returns empty string for no dates", () => {
    expect(formatDateRanges([])).toBe("");
  });
});

describe("formatDayShort", () => {
  it("formats an ISO date without timezone drift", () => {
    expect(formatDayShort("2026-11-02")).toBe("Mon, Nov 2");
  });
});

describe("reminderSubject", () => {
  it("builds the week-of subject", () => {
    expect(reminderSubject("week-of", "Colorado", "Mon, Nov 2 – Sun, Nov 8")).toBe(
      "You're on call this week — Colorado (Mon, Nov 2 – Sun, Nov 8)",
    );
  });

  it("builds the week-ahead subject", () => {
    expect(reminderSubject("week-ahead", "California", "Mon, Aug 3 – Sat, Aug 8")).toBe(
      "You're on call next week — California (Mon, Aug 3 – Sat, Aug 8)",
    );
  });
});

describe("shift window formatting", () => {
  it("formats 24h times to 12h", () => {
    expect(formatTime12h("16:00")).toBe("4:00 PM");
    expect(formatTime12h("08:00")).toBe("8:00 AM");
    expect(formatTime12h("00:30")).toBe("12:30 AM");
    expect(formatTime12h("12:00")).toBe("12:00 PM");
  });

  it("formats a window that crosses midnight", () => {
    expect(formatShiftWindow("16:00", "08:00")).toBe("4:00 PM – 8:00 AM");
  });
});
