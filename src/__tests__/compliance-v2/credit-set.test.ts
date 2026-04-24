import { computeCreditSet, type CreditSetInputs } from "@/lib/compliance-v2/credit-set";

const mkTask = (opts: Partial<CreditSetInputs["task"]> = {}): CreditSetInputs["task"] => ({
  service_task_uid: "t1",
  service_task_title: "PV Install - Colorado",
  service_task_status: "COMPLETED",
  assigned_to: [],
  asset_inspection_submission_uid: null,
  ...opts,
});

const mkAssignee = (uid: string, name: string) => ({
  user: { user_uid: uid, first_name: name, last_name: "Test", is_active: true },
});

describe("computeCreditSet", () => {
  it("returns empty credit set when task has no assignees and no form", () => {
    const result = computeCreditSet({ task: mkTask(), form: null });
    expect(result.userUids).toEqual([]);
  });

  it("returns assigned users only", () => {
    const result = computeCreditSet({
      task: mkTask({ assigned_to: [mkAssignee("u1", "Alice"), mkAssignee("u2", "Bob")] }),
      form: null,
    });
    expect(result.userUids.sort()).toEqual(["u1", "u2"]);
  });

  it("includes form created_by when no task assignees (form-filer-only case)", () => {
    const result = computeCreditSet({
      task: mkTask(),
      form: { created_by: { user_uid: "u3", first_name: "Carol", last_name: "Test" }, created_at: "2026-01-01T00:00:00Z" },
    });
    expect(result.userUids).toEqual(["u3"]);
  });

  it("unions task assignees and form submitter", () => {
    const result = computeCreditSet({
      task: mkTask({ assigned_to: [mkAssignee("u1", "Alice")] }),
      form: { created_by: { user_uid: "u3", first_name: "Carol", last_name: "Test" }, created_at: "2026-01-01T00:00:00Z" },
    });
    expect(result.userUids.sort()).toEqual(["u1", "u3"]);
  });

  it("deduplicates when task assignee is also form submitter", () => {
    const result = computeCreditSet({
      task: mkTask({ assigned_to: [mkAssignee("u1", "Alice")] }),
      form: { created_by: { user_uid: "u1", first_name: "Alice", last_name: "Test" }, created_at: "2026-01-01T00:00:00Z" },
    });
    expect(result.userUids).toEqual(["u1"]);
  });

  it("excludes inactive assigned users", () => {
    const task = mkTask({
      assigned_to: [
        { user: { user_uid: "u1", first_name: "Active", last_name: "Tech", is_active: true } },
        { user: { user_uid: "u2", first_name: "Inactive", last_name: "Tech", is_active: false } },
      ],
    });
    const result = computeCreditSet({ task, form: null });
    expect(result.userUids).toEqual(["u1"]);
  });

  it("captures display name per user", () => {
    const result = computeCreditSet({
      task: mkTask({ assigned_to: [mkAssignee("u1", "Alice")] }),
      form: null,
    });
    expect(result.nameByUid.get("u1")).toBe("Alice Test");
  });

  it("prefers task-assigned name over form name for the same uid", () => {
    const result = computeCreditSet({
      task: mkTask({ assigned_to: [mkAssignee("u1", "AliceTask")] }),
      form: { created_by: { user_uid: "u1", first_name: "AliceForm", last_name: "Test" }, created_at: "2026-01-01T00:00:00Z" },
    });
    expect(result.nameByUid.get("u1")).toBe("AliceTask Test");
  });
});
