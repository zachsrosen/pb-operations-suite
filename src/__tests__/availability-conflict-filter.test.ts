/**
 * Tests for the availability-override → survey conflict assignee filter.
 *
 * Bug (reported 7/7 by Steve via Zach): Lenny Uematsu (Colorado Springs)
 * blocked a full day and the system emailed conflict alerts for EVERY
 * survey scheduled that day — including Joe Lynch's Westminster survey.
 * Root cause: his CrewMember row has zuperUserUid = "" and the Prisma
 * query used `assignedUserUid: { contains: "" }`, which matches all rows.
 *
 * The filter must only match on identifiers that actually exist, and
 * callers must skip the conflict scan entirely when the crew member has
 * no usable identifier.
 */
import { buildSurveyConflictAssigneeFilter } from "@/lib/availability-conflict-filter";

describe("buildSurveyConflictAssigneeFilter", () => {
  it("matches on both UID and exact name when both exist", () => {
    const filter = buildSurveyConflictAssigneeFilter({
      name: "Joe Lynch",
      zuperUserUid: "f203f99b-4aaf-488e-8e6a-8ee5e94ec217",
    });
    expect(filter).toEqual({
      OR: [
        { assignedUserUid: { contains: "f203f99b-4aaf-488e-8e6a-8ee5e94ec217" } },
        { assignedUser: { equals: "Joe Lynch", mode: "insensitive" } },
      ],
    });
  });

  it("never emits a contains clause for a blank UID (the Lenny bug)", () => {
    const filter = buildSurveyConflictAssigneeFilter({
      name: "Lenny Uematsu",
      zuperUserUid: "",
    });
    expect(filter).toEqual({
      OR: [{ assignedUser: { equals: "Lenny Uematsu", mode: "insensitive" } }],
    });
  });

  it("treats whitespace-only UID as missing", () => {
    const filter = buildSurveyConflictAssigneeFilter({ name: "X Y", zuperUserUid: "   " });
    expect(filter).toEqual({ OR: [{ assignedUser: { equals: "X Y", mode: "insensitive" } }] });
  });

  it("returns null when there is no usable identifier at all", () => {
    expect(buildSurveyConflictAssigneeFilter({ name: "", zuperUserUid: "" })).toBeNull();
    expect(buildSurveyConflictAssigneeFilter({ name: null, zuperUserUid: null })).toBeNull();
    expect(buildSurveyConflictAssigneeFilter({ name: "  ", zuperUserUid: undefined })).toBeNull();
  });
});
