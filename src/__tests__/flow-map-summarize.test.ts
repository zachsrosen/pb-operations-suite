import fs from "fs";
import { summarizeFlow, unhandledOperators } from "@/lib/flow-map/summarize";
const labels = JSON.parse(fs.readFileSync("data/hubspot-flows/_prop_labels.json", "utf8"));
const stageLookup = JSON.parse(fs.readFileSync("data/hubspot-flows/_stage_lookup.json", "utf8")).stage_lookup;
const load = (id: string) => JSON.parse(fs.readFileSync(`data/hubspot-flows/detail/${id}.json`, "utf8"));

test("DA Sent: task-completion trigger + conditional execution order", () => {
  const e = summarizeFlow(load("451599947"), labels, stageLookup);
  expect(e.trigger).toContain("the task “Send DA to Customer");
  expect(e.trigger).toContain("Design & Engineering");
  expect(e.actions[0]).toMatch(/^Set Is DA/i);
  expect(e.actions.join(" ")).toContain("otherwise set Design Approval Status");
});

test("PandaDoc DA Sent: event-based, sets layout_status", () => {
  const e = summarizeFlow(load("1704991789"), labels, stageLookup);
  expect(e.enrollmentType).toBe("EVENT_BASED");
  expect(e.sets.some((s: any) => s.property === "layout_status")).toBe(true);
});

test("status/name mapping: '04. Design Flow' maps to Design & Engineering + creates the stamping task", () => {
  // 451609218 enrolls via dealstage IS_NONE_OF [closed] (no positive inclusion),
  // so the old inclusion-only mapping would NOT place it in any stage. The name
  // (/design flow/i) + design_status/layout_status touch must now map it to 20461937.
  const e = summarizeFlow(load("451609218"), labels, stageLookup);
  expect(e.stageIds).toContain("20461937"); // Design & Engineering
  expect(e.createsTasks).toContain("Complete Final Design Review For Stamping - ZRS");
});

test("status/name mapping: a Permit Flow maps to Permitting & Interconnection", () => {
  // 452253474 = "01a. Permit Flow - Ready for Permitting" — name (/permit(ting)? flow/i)
  // and/or permitting_status touch must map it to 20461938.
  const e = summarizeFlow(load("452253474"), labels, stageLookup);
  expect(e.stageIds).toContain("20461938"); // Permitting & Interconnection
});

test("coverage: every fixture parses with a non-empty trigger and zero unhandled operators", () => {
  unhandledOperators.clear();
  const ids = fs.readdirSync("data/hubspot-flows/detail").filter(f => f.endsWith(".json")).map(f => f.replace(".json",""));
  for (const id of ids) {
    const d = load(id); if (d._error) continue;
    const e = summarizeFlow(d, labels, stageLookup);
    expect(e.trigger.trim().length).toBeGreaterThan(0);
  }
  expect([...unhandledOperators]).toEqual([]);
});
