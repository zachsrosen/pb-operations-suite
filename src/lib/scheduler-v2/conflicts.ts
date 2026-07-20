/**
 * Pure conflict detection for scheduler-v2.
 *
 * detectConflicts() accepts a proposed assignment (params) and pre-fetched
 * context (no network calls) and returns a ConflictResult describing every
 * issue found. All inputs are injected — this module has zero side effects
 * and is safe to call in tests, API routes, and client-side drag-hover handlers.
 *
 * ## Rules
 *
 * Hard flags (block scheduling):
 *   double_book     — existingAssignments already contains an entry on `date`.
 *                     The caller is expected to pre-filter existingAssignments
 *                     to the resource in question (the assignment shape has no
 *                     resourceId field, only resourceName; the /board endpoint
 *                     groups assignments per resource before calling this).
 *   weekend_holiday — isHolidayOrWeekend is true (caller resolves via
 *                     on-call-holidays + date.getDay()).
 *   lead_time       — leadTimeError is non-null (caller checks scheduling-policy
 *                     e.g. "Sales can only schedule surveys 2+ days out").
 *
 * Soft flags (warn, do not block):
 *   over_capacity   — the CapacityCell for this location+date exists AND
 *                     (cell.loadDays + 1) > cell.capacityDays. The "+1" is
 *                     because loadDays reflects existing assignments; adding this
 *                     job increments the load by 1.
 *   travel          — travel.infeasible is true (caller resolves via
 *                     travel-time.ts on demand).
 *
 * ok = hard.length === 0
 */

import type { Assignment, CapacityCell, ConflictFlag, ConflictResult } from "./types";

/* ------------------------------------------------------------------ */
/*  Input shapes                                                       */
/* ------------------------------------------------------------------ */

export interface ConflictParams {
  /** Zuper user UID or CrewMember.id — identifies the assignee. */
  resourceId: string;
  /** Normalized PB location name ("Westminster", "Pueblo", etc.). */
  location: string;
  /** Proposed start date in YYYY-MM-DD format. */
  date: string;
  /** Duration of the job in install-days. */
  days: number;
  /** Work type ("install", "survey", etc.). */
  workType: string;
}

export interface ConflictContext {
  /**
   * Existing assignments for the *same resource* within the relevant period.
   * Pre-filtered by the caller. Each entry represents one already-committed
   * install-day; if any has the same `date`, it's a double-book.
   */
  existingAssignments: Assignment[];
  /**
   * Capacity cells covering the proposed location + date.
   * Populated via computeCapacityCells() in capacity.ts.
   */
  capacityCells: CapacityCell[];
  /**
   * True when the proposed date falls on a weekend or a PB-observed holiday.
   * Resolved by the caller using on-call-holidays + JS Date.getDay().
   */
  isHolidayOrWeekend: boolean;
  /**
   * Non-null error string when a scheduling-policy lead-time rule is violated.
   * The string is surfaced verbatim in the flag's message.
   * Resolved by the caller using scheduling-policy.ts.
   */
  leadTimeError: string | null;
  /**
   * Optional travel context resolved on demand via travel-time.ts.
   * If absent, no travel flag is emitted.
   */
  travel?: {
    infeasible: boolean;
    /** Drive time in minutes (informational, included in flag detail). */
    minutes?: number;
  };
}

/* ------------------------------------------------------------------ */
/*  Implementation                                                     */
/* ------------------------------------------------------------------ */

/**
 * Detect scheduling conflicts for a proposed assignment.
 *
 * Pure function — no network calls, no DB access.
 * All relevant data must be injected via `context`.
 */
export function detectConflicts(
  params: ConflictParams,
  context: ConflictContext
): ConflictResult {
  const hard: ConflictFlag[] = [];
  const soft: ConflictFlag[] = [];

  /* ---- Hard: double_book ------------------------------------------ */
  const alreadyBookedOnDate = context.existingAssignments.some(
    (a) => a.date === params.date
  );
  if (alreadyBookedOnDate) {
    hard.push({
      kind: "double_book",
      severity: "hard",
      message: `Resource is already assigned on ${params.date}.`,
    });
  }

  /* ---- Hard: weekend_holiday --------------------------------------- */
  if (context.isHolidayOrWeekend) {
    hard.push({
      kind: "weekend_holiday",
      severity: "hard",
      message: `${params.date} falls on a weekend or observed holiday.`,
    });
  }

  /* ---- Hard: lead_time --------------------------------------------- */
  if (context.leadTimeError !== null) {
    hard.push({
      kind: "lead_time",
      severity: "hard",
      message: context.leadTimeError,
    });
  }

  /* ---- Soft: over_capacity ----------------------------------------- */
  const capacityCell = context.capacityCells.find(
    (c) => c.location === params.location && c.date === params.date
  );
  if (capacityCell !== undefined) {
    // Adding this job increments load by 1; compare projected load to capacity.
    const projectedLoad = capacityCell.loadDays + 1;
    if (projectedLoad > capacityCell.capacityDays) {
      soft.push({
        kind: "over_capacity",
        severity: "soft",
        message: `${params.location} would be at ${projectedLoad}/${capacityCell.capacityDays} jobs on ${params.date}.`,
        detail: {
          currentLoad: capacityCell.loadDays,
          projectedLoad,
          capacityDays: capacityCell.capacityDays,
        },
      });
    }
  }

  /* ---- Soft: travel ------------------------------------------------ */
  if (context.travel?.infeasible) {
    soft.push({
      kind: "travel",
      severity: "soft",
      message: `Travel time is infeasible for this assignment${
        context.travel.minutes !== undefined
          ? ` (${context.travel.minutes} min drive).`
          : "."
      }`,
      detail: { minutes: context.travel.minutes },
    });
  }

  return {
    ok: hard.length === 0,
    hard,
    soft,
  };
}
