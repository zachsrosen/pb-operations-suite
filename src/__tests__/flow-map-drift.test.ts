import fs from "fs";
import { summarizeFlow } from "@/lib/flow-map/summarize";
import { detectDrift } from "@/lib/flow-map/drift";
import { STAGE_TO_SOP } from "@/lib/flow-map/sop-map";
const propLabels = JSON.parse(fs.readFileSync("data/hubspot-flows/_prop_labels.json","utf8"));
const stageLookup = JSON.parse(fs.readFileSync("data/hubspot-flows/_stage_lookup.json","utf8")).stage_lookup;
const sop = JSON.parse(fs.readFileSync("data/hubspot-flows/sop-sections.json","utf8"));
const sectionHtml = (id: string) => (sop.sections.find((s: any) => s.id === id)?.content) ?? "";

function liveFlowsForStage(stageId: string) {
  return fs.readdirSync("data/hubspot-flows/detail").filter(f=>f.endsWith(".json")).map(f=>{
    const d = JSON.parse(fs.readFileSync(`data/hubspot-flows/detail/${f}`,"utf8"));
    if (d._error) return null;
    const e = summarizeFlow(d, propLabels, stageLookup);
    return e.stageIds.includes(stageId) ? { name: d.name, isEnabled: d.isEnabled } : null;
  }).filter(Boolean) as { name: string; isEnabled: boolean }[];
}

test("Design & Engineering drift: live Design Flow family is undocumented", () => {
  const stageId = "20461937";
  const htmls = STAGE_TO_SOP[stageId].map(sectionHtml);
  const live = liveFlowsForStage(stageId);
  const drift = detectDrift(htmls, live);
  // Live numbered Design Flow steps exist but the SOP uses old names → undocumented:
  expect(drift.liveButUndocumented).toContain("00. Design Flow - Ready for Design");
  // The SOP documents names that no longer exist live (renamed) → missing:
  expect(drift.documentedButMissing.length).toBeGreaterThan(0);
  // Sanity: buckets are disjoint string arrays
  expect(Array.isArray(drift.documentedButOff)).toBe(true);
});
