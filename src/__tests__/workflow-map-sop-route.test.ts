jest.mock("@/lib/db", () => ({
  prisma: { sopSection: { findMany: jest.fn() } },
}));

import { prisma } from "@/lib/db";
import { GET } from "@/app/api/workflow-map/sop/[stageId]/route";
import { STAGE_TO_SOP } from "@/lib/flow-map/sop-map";

function makeParams(stageId: string) {
  return { params: Promise.resolve({ stageId }) };
}

beforeEach(() => {
  (prisma!.sopSection.findMany as jest.Mock).mockReset();
});

test("returns sections in STAGE_TO_SOP order for a Project stage", async () => {
  // 20461937 -> ["wf-design", "wf-da"]. Return rows out of order to prove ordering.
  (prisma!.sopSection.findMany as jest.Mock).mockResolvedValue([
    { id: "wf-da", content: "<p>DA</p>" },
    { id: "wf-design", content: "<p>Design</p>" },
  ]);

  const res = await GET(new Request("http://t/"), makeParams("20461937"));
  const body = await res.json();

  expect(body.projectOnly).toBe(true);
  expect(body.sections.map((s: { id: string }) => s.id)).toEqual([
    "wf-design",
    "wf-da",
  ]);
  expect(body.sections[0].content).toBe("<p>Design</p>");
});

test("returns empty list + projectOnly:false for a non-Project stage", async () => {
  const res = await GET(new Request("http://t/"), makeParams("not-a-stage"));
  const body = await res.json();

  expect(body.sections).toEqual([]);
  expect(body.projectOnly).toBe(false);
  expect(prisma!.sopSection.findMany).not.toHaveBeenCalled();
});

test("STAGE_TO_SOP fixture is intact (guards the ordering test)", () => {
  expect(STAGE_TO_SOP["20461937"]).toEqual(["wf-design", "wf-da"]);
});
