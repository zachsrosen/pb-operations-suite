// pe-hubspot-sync imports @/lib/db (Prisma/Neon, uses import.meta) — mock it so
// these pure-helper tests don't pull the real client.
jest.mock("@/lib/db", () => ({ prisma: {} }));

import {
  normalizeActionItemDocName,
  actionItemNotesByDoc,
} from "@/lib/pe-hubspot-sync";

describe("normalizeActionItemDocName", () => {
  it("aliases the Conditional Waiver label to the canonical doc name", () => {
    expect(normalizeActionItemDocName("Conditional Waiver/Release on Final Payment")).toBe(
      "Conditional Waiver — Final Payment",
    );
  });
  it("passes through labels that already match the canonical doc name", () => {
    expect(normalizeActionItemDocName("Certificate of Acceptance")).toBe("Certificate of Acceptance");
    expect(normalizeActionItemDocName("Customer Agreement (PPA/ESA)")).toBe("Customer Agreement (PPA/ESA)");
  });
});

describe("actionItemNotesByDoc", () => {
  it("keys by dealId::docName and joins the reviewer notes", () => {
    const m = actionItemNotesByDoc([
      { dealId: "1", docLabel: "Certificate of Acceptance", notes: "dates inconsistent" },
    ]);
    expect(m.get("1::Certificate of Acceptance")).toBe("dates inconsistent");
  });

  it("groups multiple action items for the same doc and dedupes identical lines", () => {
    const m = actionItemNotesByDoc([
      { dealId: "1", docLabel: "Design Plan", notes: "missing rapid shutdown" },
      { dealId: "1", docLabel: "Design Plan", notes: "wrong inverter" },
      { dealId: "1", docLabel: "Design Plan", notes: "wrong inverter" }, // dup
    ]);
    expect(m.get("1::Design Plan")).toBe("missing rapid shutdown\nwrong inverter");
  });

  it("splits multi-line notes into separate (deduped) lines", () => {
    const m = actionItemNotesByDoc([
      { dealId: "9", docLabel: "Photos per Policy", notes: "blurry\nmissing meter\nblurry" },
    ]);
    expect(m.get("9::Photos per Policy")).toBe("blurry\nmissing meter");
  });

  it("applies the waiver alias so it lands under the canonical doc name", () => {
    const m = actionItemNotesByDoc([
      { dealId: "2", docLabel: "Conditional Waiver/Release on Final Payment", notes: "amount wrong" },
    ]);
    expect(m.get("2::Conditional Waiver — Final Payment")).toBe("amount wrong");
    expect(m.get("2::Conditional Waiver/Release on Final Payment")).toBeUndefined();
  });

  it("ignores empty / whitespace-only notes", () => {
    const m = actionItemNotesByDoc([
      { dealId: "3", docLabel: "Utility Bill", notes: "" },
      { dealId: "3", docLabel: "Utility Bill", notes: "   " },
      { dealId: "3", docLabel: "Utility Bill", notes: null },
    ]);
    expect(m.get("3::Utility Bill")).toBeUndefined();
  });

  it("keeps different deals separate", () => {
    const m = actionItemNotesByDoc([
      { dealId: "1", docLabel: "Design Plan", notes: "a" },
      { dealId: "2", docLabel: "Design Plan", notes: "b" },
    ]);
    expect(m.get("1::Design Plan")).toBe("a");
    expect(m.get("2::Design Plan")).toBe("b");
  });

  it("is ORDER-INDEPENDENT — same items in any input order → identical output", () => {
    // The He (PROJ-8449) case: two near-duplicate INCOR-INCENTIVE-AMT items, one
    // whose note has an embedded newline. Input query order isn't guaranteed, so
    // the composed value must not depend on it — otherwise it churns every sync
    // and re-fires the "Rejected by PE" notifier workflow.
    const items = [
      { dealId: "1", docLabel: "Customer Agreement (PPA/ESA)", notes: "Page 5 — [H046] checkbox not selected" },
      { dealId: "1", docLabel: "Customer Agreement (PPA/ESA)", notes: 'Only the Powerwall 3 - Xcel Rebate is approved' },
      { dealId: "1", docLabel: "Customer Agreement (PPA/ESA)", notes: 'Only the Powerwall 3\n- Xcel Rebate is approved' },
    ];
    const forward = actionItemNotesByDoc(items).get("1::Customer Agreement (PPA/ESA)");
    const reversed = actionItemNotesByDoc([...items].reverse()).get("1::Customer Agreement (PPA/ESA)");
    const shuffled = actionItemNotesByDoc([items[1], items[2], items[0]]).get("1::Customer Agreement (PPA/ESA)");
    expect(reversed).toBe(forward);
    expect(shuffled).toBe(forward);
  });
});
