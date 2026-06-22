import fs from "fs";
import { summarizeFlow } from "@/lib/flow-map/summarize";
import { buildProgression } from "@/lib/flow-map/progression";
const propLabels = JSON.parse(fs.readFileSync("data/hubspot-flows/_prop_labels.json","utf8"));
const stageLookup = JSON.parse(fs.readFileSync("data/hubspot-flows/_stage_lookup.json","utf8")).stage_lookup;
function allFlows() {
  return fs.readdirSync("data/hubspot-flows/detail").filter(f=>f.endsWith(".json")).map(f=>{
    const d = JSON.parse(fs.readFileSync(`data/hubspot-flows/detail/${f}`,"utf8"));
    if (d._error) return null;
    return { id: d.id, name: d.name, isEnabled: d.isEnabled, ...summarizeFlow(d, propLabels, stageLookup) };
  }).filter(Boolean);
}
test("status hand-off: layout_status 'Sent to Customer' links PandaDoc + follow-up", () => {
  // NOTE: ProgressionLink.value is the RAW enum value ("Sent to Customer");
  // ProgressionLink.label is the display label ("Sent For Approval"). The oracle
  // doc groups by the label — same link, value/label difference is not a bug.
  const links = buildProgression(allFlows() as any, propLabels);
  const link = links.find(l => l.property === "layout_status" && l.value === "Sent to Customer");
  expect(link).toBeTruthy();
  expect(link!.setBy).toContain("PandaDoc DA Sent");
  expect(link!.firesFlows).toContain("03. DA Flow - DA Follow Up Task");
  expect(link!.label).toBe("Sent For Approval");
});
test("excludes non-status props (dealstage, dates, hs_*)", () => {
  const links = buildProgression(allFlows() as any, propLabels);
  expect(links.some(l => l.property === "dealstage")).toBe(false);
  expect(links.some(l => /date$/i.test(l.property))).toBe(false);
  expect(links.some(l => l.property.startsWith("hs_"))).toBe(false);
});
