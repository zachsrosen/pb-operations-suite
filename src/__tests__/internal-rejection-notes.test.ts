import {
  composeInternalRejectionNotes,
  scopeCheckedDocsToMilestones,
  parseCheckedDocs,
  INTERNAL_DOC_TO_TEAM_FIELD,
  INTERNAL_REASON_FIELD_BY_DOC,
  INTERNAL_REJECTION_TEAM_FIELDS,
} from "@/lib/internal-rejection-notes";

describe("composeInternalRejectionNotes", () => {
  it("routes each checked doc's reason to the owning team field", () => {
    const out = composeInternalRejectionNotes(
      { "Design Plan": "wrong module number", Proposal: "system size mismatch" },
      ["Design Plan", "Proposal"],
    );
    expect(out["internal_rejection_notes_for_design"]).toBe("Design Plan:\n• wrong module number");
    expect(out["internal_rejection_notes_for_sales"]).toBe("Proposal:\n• system size mismatch");
  });

  it("groups multiple checked docs for the same team, separated by a blank line, in registry order", () => {
    const out = composeInternalRejectionNotes(
      {
        "Utility Bill": "illegible",
        Proposal: "wrong size",
        "Customer Agreement": "missing signature",
      },
      ["Utility Bill", "Proposal", "Customer Agreement"],
    );
    expect(out["internal_rejection_notes_for_sales"]).toBe(
      "Proposal:\n• wrong size\n\n" +
        "Customer Agreement:\n• missing signature\n\n" +
        "Utility Bill:\n• illegible",
    );
  });

  it("splits a multi-line reason into one bullet per line", () => {
    const out = composeInternalRejectionNotes(
      { "Design Plan": "Page 8 — wrong inverter\nPage 12 — missing rapid shutdown" },
      ["Design Plan"],
    );
    expect(out["internal_rejection_notes_for_design"]).toBe(
      "Design Plan:\n• Page 8 — wrong inverter\n• Page 12 — missing rapid shutdown",
    );
  });

  it("renders a bare 'Doc:' header when a checked doc has an empty reason", () => {
    const out = composeInternalRejectionNotes({ Photos: "" }, ["Photos"]);
    expect(out["internal_rejection_notes_for_ops"]).toBe("Photos:");
  });

  it("treats a whitespace-only reason as empty (bare header)", () => {
    const out = composeInternalRejectionNotes({ Photos: "   \n  " }, ["Photos"]);
    expect(out["internal_rejection_notes_for_ops"]).toBe("Photos:");
  });

  it("dedupes identical issue lines within a reason", () => {
    const out = composeInternalRejectionNotes(
      { "Design Plan": "missing label\nmissing label\nwrong gauge" },
      ["Design Plan"],
    );
    expect(out["internal_rejection_notes_for_design"]).toBe(
      "Design Plan:\n• missing label\n• wrong gauge",
    );
  });

  it("routes Load Justification Form directly to Design (its own field, no proposal parsing)", () => {
    const out = composeInternalRejectionNotes(
      { "Load Justification Form": "offset exceeds 135%" },
      ["Load Justification Form"],
    );
    expect(out["internal_rejection_notes_for_design"]).toBe(
      "Load Justification Form:\n• offset exceeds 135%",
    );
  });

  it("groups Design Plan + Load Justification Form together under Design", () => {
    const out = composeInternalRejectionNotes(
      { "Design Plan": "wrong inverter", "Load Justification Form": "offset too high" },
      ["Design Plan", "Load Justification Form"],
    );
    expect(out["internal_rejection_notes_for_design"]).toBe(
      "Design Plan:\n• wrong inverter\n\nLoad Justification Form:\n• offset too high",
    );
  });

  it("routes M2 docs: Interconnection Agreement + PTO → Interconnection, Final-Payment waiver → Accounting", () => {
    const out = composeInternalRejectionNotes(
      {
        "Signed Interconnection Agreement": "missing signature",
        "Permission to Operate": "utility denied",
        "Conditional Waiver and Release": "amount wrong",
      },
      ["Signed Interconnection Agreement", "Permission to Operate", "Conditional Waiver and Release"],
    );
    expect(out["internal_rejection_notes_for_interconnection"]).toBe(
      "Signed Interconnection Agreement:\n• missing signature\n\nPermission to Operate:\n• utility denied",
    );
    expect(out["internal_rejection_notes_for_accounting"]).toBe(
      "Conditional Waiver and Release:\n• amount wrong",
    );
  });

  it("uses the CORRECT spelling of the interconnection field (not the PE typo)", () => {
    const out = composeInternalRejectionNotes({ "Permission to Operate": "x" }, [
      "Permission to Operate",
    ]);
    expect(out).toHaveProperty("internal_rejection_notes_for_interconnection");
    expect(out).not.toHaveProperty("internal_rejection_notes_for_intercocnnection");
  });

  it("leaves teams with no checked docs as empty strings (clears stale notes)", () => {
    const out = composeInternalRejectionNotes({ Photos: "blurry" }, ["Photos"]);
    expect(out["internal_rejection_notes_for_ops"]).toBe("Photos:\n• blurry");
    expect(out["internal_rejection_notes_for_design"]).toBe("");
    expect(out["internal_rejection_notes_for_sales"]).toBe("");
    expect(out["internal_rejection_notes_for_permitting"]).toBe("");
    expect(out["internal_rejection_notes_for_compliance"]).toBe("");
    expect(out["internal_rejection_notes_for_accounting"]).toBe("");
    expect(out["internal_rejection_notes_for_interconnection"]).toBe("");
  });

  it("always returns all 7 team fields plus the combined field", () => {
    const out = composeInternalRejectionNotes({}, []);
    expect(Object.keys(out).sort()).toEqual(
      [
        ...INTERNAL_REJECTION_TEAM_FIELDS,
        "internal_rejection_comments",
      ].sort(),
    );
    for (const v of Object.values(out)) expect(v).toBe("");
  });

  it("ignores a doc that is not in the checked list, even if a reason was supplied", () => {
    const out = composeInternalRejectionNotes(
      { "Design Plan": "rejected", Proposal: "stale reason left over" },
      ["Design Plan"],
    );
    expect(out["internal_rejection_notes_for_design"]).toBe("Design Plan:\n• rejected");
    expect(out["internal_rejection_notes_for_sales"]).toBe("");
  });

  it("ignores an unknown checkbox value", () => {
    const out = composeInternalRejectionNotes({ "Mystery Doc": "??" }, ["Mystery Doc"]);
    for (const v of Object.values(out)) expect(v).toBe("");
  });

  it("dedupes a doc that appears twice in the checked list", () => {
    const out = composeInternalRejectionNotes({ Photos: "blurry" }, ["Photos", "Photos"]);
    expect(out["internal_rejection_notes_for_ops"]).toBe("Photos:\n• blurry");
  });

  describe("combined internal_rejection_comments", () => {
    it("includes every checked doc as one block, in registry order (LJF included normally)", () => {
      const out = composeInternalRejectionNotes(
        {
          "Design Plan": "module mismatch",
          "Load Justification Form": "offset too high",
          Photos: "blurry",
        },
        ["Photos", "Load Justification Form", "Design Plan"],
      );
      expect(out["internal_rejection_comments"]).toBe(
        "Design Plan:\n• module mismatch\n\n" +
          "Load Justification Form:\n• offset too high\n\n" +
          "Photos:\n• blurry",
      );
    });

    it("is an empty string when nothing is checked", () => {
      const out = composeInternalRejectionNotes({}, []);
      expect(out["internal_rejection_comments"]).toBe("");
    });
  });
});

describe("scopeCheckedDocsToMilestones", () => {
  const checked = ["Design Plan", "Photos", "Permission to Operate", "Conditional Waiver and Release"];

  it("keeps only M1 docs when only M1 is internally rejected", () => {
    expect(scopeCheckedDocsToMilestones(checked, { m1: true, m2: false })).toEqual([
      "Design Plan",
      "Photos",
    ]);
  });

  it("keeps only M2 docs when only M2 is internally rejected", () => {
    expect(scopeCheckedDocsToMilestones(checked, { m1: false, m2: true })).toEqual([
      "Permission to Operate",
      "Conditional Waiver and Release",
    ]);
  });

  it("keeps all docs when both milestones are internally rejected", () => {
    expect(scopeCheckedDocsToMilestones(checked, { m1: true, m2: true })).toEqual(checked);
  });

  it("drops everything when neither milestone is internally rejected", () => {
    expect(scopeCheckedDocsToMilestones(checked, { m1: false, m2: false })).toEqual([]);
  });

  it("drops unknown docs regardless of milestone flags", () => {
    expect(scopeCheckedDocsToMilestones(["Mystery"], { m1: true, m2: true })).toEqual([]);
  });
});

describe("parseCheckedDocs", () => {
  it("splits a semicolon-joined HubSpot checkbox value, trimming blanks", () => {
    expect(parseCheckedDocs("Design Plan;Photos;Proposal")).toEqual([
      "Design Plan",
      "Photos",
      "Proposal",
    ]);
  });

  it("returns an empty array for null/empty input", () => {
    expect(parseCheckedDocs(null)).toEqual([]);
    expect(parseCheckedDocs("")).toEqual([]);
    expect(parseCheckedDocs(undefined)).toEqual([]);
  });
});

describe("registry integrity", () => {
  it("maps all 16 docs to a correctly-spelled internal_rejection_notes_for_* field", () => {
    expect(Object.keys(INTERNAL_DOC_TO_TEAM_FIELD)).toHaveLength(16);
    for (const field of Object.values(INTERNAL_DOC_TO_TEAM_FIELD)) {
      expect(field).toMatch(/^internal_rejection_notes_for_(design|sales|ops|permitting|compliance|accounting|interconnection)$/);
    }
  });

  it("has a reason field for all 16 docs", () => {
    expect(Object.keys(INTERNAL_REASON_FIELD_BY_DOC)).toHaveLength(16);
    for (const field of Object.values(INTERNAL_REASON_FIELD_BY_DOC)) {
      expect(field).toMatch(/^internal_reason_/);
    }
  });

  it("exposes exactly the 7 unique team fields", () => {
    expect([...INTERNAL_REJECTION_TEAM_FIELDS].sort()).toEqual(
      [
        "internal_rejection_notes_for_accounting",
        "internal_rejection_notes_for_compliance",
        "internal_rejection_notes_for_design",
        "internal_rejection_notes_for_interconnection",
        "internal_rejection_notes_for_ops",
        "internal_rejection_notes_for_permitting",
        "internal_rejection_notes_for_sales",
      ].sort(),
    );
  });
});
