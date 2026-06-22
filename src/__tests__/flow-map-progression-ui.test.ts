import { deriveProgression } from "@/components/workflow-map/ProgressionLinks";
import type { ProgressionLink } from "@/lib/flow-map/types";

const links: ProgressionLink[] = [
  {
    kind: "status",
    property: "layout_status",
    value: "Sent to Customer",
    label: "Sent For Approval",
    setBy: ["PandaDoc DA Sent", "02. DA Flow - DA Sent for Approval"],
    firesFlows: ["03. DA Flow - DA Follow Up Task"],
  },
];

test("triggers: setter flow lists its downstream", () => {
  const r = deriveProgression("PandaDoc DA Sent", links);
  expect(r.triggers[0].label).toBe("Sent For Approval");
  expect(r.triggers[0].names).toContain("03. DA Flow - DA Follow Up Task");
  expect(r.triggers[0].names).not.toContain("PandaDoc DA Sent");
});

test("fedBy: reader flow lists its upstream setters", () => {
  const r = deriveProgression("03. DA Flow - DA Follow Up Task", links);
  expect(r.fedBy[0].names).toEqual(
    expect.arrayContaining([
      "PandaDoc DA Sent",
      "02. DA Flow - DA Sent for Approval",
    ]),
  );
});

test("self is excluded and empty groups are dropped", () => {
  // A flow that both sets and is fired by the same link only appears in the
  // group with at least one *other* flow name. Here, a setter that is also the
  // sole downstream produces no triggers group.
  const selfOnly: ProgressionLink[] = [
    {
      kind: "status",
      property: "p",
      value: "v",
      label: "L",
      setBy: ["A"],
      firesFlows: ["A"],
    },
  ];
  const r = deriveProgression("A", selfOnly);
  expect(r.triggers).toHaveLength(0);
  expect(r.fedBy).toHaveLength(0);
});

test("unrelated base name yields no groups", () => {
  const r = deriveProgression("Nonexistent Flow", links);
  expect(r.triggers).toHaveLength(0);
  expect(r.fedBy).toHaveLength(0);
});
