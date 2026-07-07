/**
 * Assignee filter for the availability-override → scheduled-survey conflict
 * scan (my-availability overrides route).
 *
 * A CrewMember row may have a blank zuperUserUid (rows created before Zuper
 * linkage, e.g. coverage additions). `assignedUserUid: { contains: "" }`
 * matches EVERY row in Prisma, which made one surveyor's day-off flag every
 * survey on the calendar that day and email every deal owner (7/7 incident:
 * Lenny Uematsu's block alerted on Joe Lynch's Westminster survey).
 *
 * Only emit clauses for identifiers that actually exist; return null when
 * there is nothing to match on so callers skip the scan entirely.
 */
export function buildSurveyConflictAssigneeFilter(crew: {
  name?: string | null;
  zuperUserUid?: string | null;
}):
  | {
      OR: Array<
        | { assignedUserUid: { contains: string } }
        | { assignedUser: { equals: string; mode: "insensitive" } }
      >;
    }
  | null {
  const clauses: Array<
    | { assignedUserUid: { contains: string } }
    | { assignedUser: { equals: string; mode: "insensitive" } }
  > = [];

  const uid = (crew.zuperUserUid || "").trim();
  if (uid) {
    // contains (not equals): assignedUserUid can hold comma-joined UIDs for
    // multi-crew records.
    clauses.push({ assignedUserUid: { contains: uid } });
  }

  const name = (crew.name || "").trim();
  if (name) {
    clauses.push({ assignedUser: { equals: name, mode: "insensitive" } });
  }

  return clauses.length > 0 ? { OR: clauses } : null;
}
