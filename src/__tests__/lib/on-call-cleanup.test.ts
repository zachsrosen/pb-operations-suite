import { planPoolCleanup, phasePreservingMonday, type ExistingRow } from "@/lib/on-call-cleanup";
import { addDays, dayOfWeek, daysBetween, type RotationMember } from "@/lib/on-call-rotation";

// Reproduce the schedule that's CURRENTLY published — the old weekly rotation
// anchored on the SUNDAY of startDate (Sun-Sat weeks), which is how the engine
// generated rows before this change. This is the "what's already on the
// schedule" that the cleanup has to reconcile without breaking.
function oldSunSatSchedule(
  startDate: string,
  members: RotationMember[],
  fromDate: string,
  toDate: string,
): ExistingRow[] {
  const active = members.filter((m) => m.isActive).sort((a, b) => a.orderIndex - b.orderIndex);
  const oldSundayAnchor = addDays(startDate, -dayOfWeek(startDate)); // Sunday of startDate's week
  const rows: ExistingRow[] = [];
  for (let d = fromDate; d <= toDate; d = addDays(d, 1)) {
    const sundayOfWeek = addDays(d, -dayOfWeek(d));
    const wk = Math.floor(daysBetween(oldSundayAnchor, sundayOfWeek) / 7);
    const idx = ((wk % active.length) + active.length) % active.length;
    rows.push({ date: d, crewMemberId: active[idx].crewMemberId });
  }
  return rows;
}

function makeMembers(names: string[]): RotationMember[] {
  return names.map((crewMemberId, orderIndex) => ({ crewMemberId, orderIndex, isActive: true }));
}

// Representative real pools (member counts + order as seeded). startDate is the
// May-trial Sunday anchor. The phase-preservation property holds for any
// startDate, so the exact value only affects which names land where, not the
// guarantee under test.
const START = "2026-05-03"; // Sunday
const FROM = "2026-06-10"; // a Wednesday — mid-week, like "today"
const TO = "2026-09-08"; // ~90-day horizon

const POOLS = {
  California: { members: makeMembers(["nick", "lucas", "charlie", "ruben"]), coversSundays: false },
  Denver: {
    members: makeMembers(["adolphe", "chrisk", "chad", "nathan", "rich", "alan", "olek", "gaige", "paul", "jeremy"]),
    coversSundays: true,
  },
  "Southern CO": {
    members: makeMembers(["alex", "lenny", "ro", "joshh", "jerry", "tom", "christianw", "terrell"]),
    coversSundays: true,
  },
} as const;

describe("on-call Monday-shift cleanup — keeps the same people", () => {
  it("re-anchors to the Monday right after the old Sunday anchor", () => {
    expect(phasePreservingMonday("2026-05-03")).toBe("2026-05-04"); // Sun → next Mon
    expect(dayOfWeek(phasePreservingMonday("2026-05-03"))).toBe(1); // it's a Monday
    // Idempotent: re-running on the new Monday yields the same Monday.
    expect(phasePreservingMonday("2026-05-04")).toBe("2026-05-04");
  });

  for (const [name, cfg] of Object.entries(POOLS)) {
    describe(name, () => {
      const existing = oldSunSatSchedule(START, cfg.members, FROM, TO);
      const plan = planPoolCleanup({
        startDate: START,
        rotationUnit: "weekly",
        members: cfg.members,
        coversSundays: cfg.coversSundays,
        existing,
      });

      it("NEVER touches a Mon-Sat assignment (every change is a Sunday)", () => {
        const touched = [...plan.updates.map((u) => u.date), ...plan.deletes.map((d) => d.date)];
        const nonSundayTouched = touched.filter((d) => dayOfWeek(d) !== 0);
        expect(nonSundayTouched).toEqual([]);
      });

      it("leaves the overwhelming majority of rows unchanged", () => {
        // unchanged = all Mon-Sat (+ Sundays for pools that keep them and whose
        // owner happens to coincide). Should be ~6/7 of the horizon at minimum.
        expect(plan.unchanged).toBeGreaterThanOrEqual(existing.length - countSundays(FROM, TO) - 1);
      });

      if (cfg.coversSundays) {
        it("(Colorado) reassigns each Sunday to the prior week's owner, deletes none", () => {
          expect(plan.deletes).toEqual([]);
          expect(plan.updates.length).toBe(countSundays(FROM, TO));
          for (const u of plan.updates) {
            expect(dayOfWeek(u.date)).toBe(0);
            // Sunday now belongs to whoever owned that Saturday (same Mon-Sun week).
            const saturday = existing.find((r) => r.date === addDays(u.date, -1));
            expect(u.to).toBe(saturday?.crewMemberId);
          }
        });
      } else {
        it("(California) drops every Sunday and reassigns nothing", () => {
          expect(plan.updates).toEqual([]);
          expect(plan.deletes.length).toBe(countSundays(FROM, TO));
          for (const d of plan.deletes) expect(dayOfWeek(d.date)).toBe(0);
        });
      }
    });
  }
});

function countSundays(from: string, to: string): number {
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (dayOfWeek(d) === 0) n++;
  return n;
}
