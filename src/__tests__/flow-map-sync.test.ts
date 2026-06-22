// store.ts transitively imports @/lib/db, whose Prisma client uses import.meta
// and fails to parse under Jest's CJS runtime. Stub it (store itself is mocked).
jest.mock("@/lib/db", () => ({ prisma: null }));
jest.mock("@/lib/flow-map/client");
jest.mock("@/lib/flow-map/store");

import * as client from "@/lib/flow-map/client";
import * as store from "@/lib/flow-map/store";
import { syncFlowMap } from "@/lib/flow-map/sync";

const pipelines = (obj: string) =>
  obj === "deals"
    ? [
        {
          id: "6900017",
          label: "Project",
          stages: [{ id: "20461937", label: "Design & Engineering", displayOrder: 3 }],
        },
      ]
    : [];

const props = () => [
  { name: "design_status", label: "Design Status", options: [{ value: "In Progress", label: "In Progress" }] },
];

beforeEach(() => {
  jest.clearAllMocks();
  (client.getPipelines as jest.Mock).mockImplementation(async (o: string) => pipelines(o));
  (client.getProperties as jest.Mock).mockResolvedValue(props());
});

test("incremental: only changed flows are detail-fetched; snapshot has all", async () => {
  (client.listFlows as jest.Mock).mockResolvedValue([
    { id: "A", name: "A", isEnabled: true, objectTypeId: "0-3", revisionId: "1" },
    { id: "B", name: "B", isEnabled: true, objectTypeId: "0-3", revisionId: "9" },
  ]);
  (store.getDetailCache as jest.Mock).mockResolvedValue({
    A: {
      revisionId: "1",
      entry: {
        id: "A",
        name: "A",
        isEnabled: true,
        objectTypeId: "0-3",
        revisionId: "1",
        stageIds: [],
        trigger: "",
        triggerTechnical: "",
        actions: [],
        actionsTechnical: [],
        sets: [],
        reads: [],
        cloneCount: 1,
        hubspotUrl: "",
        enrollmentType: "LIST_BASED",
      },
    },
  });
  (store.writeDetailCache as jest.Mock).mockResolvedValue(undefined);
  (store.writeSnapshot as jest.Mock).mockResolvedValue(undefined);
  (client.getFlowDetail as jest.Mock).mockResolvedValue({
    id: "B",
    name: "B",
    isEnabled: true,
    objectTypeId: "0-3",
    revisionId: "9",
    enrollmentCriteria: { type: "LIST_BASED", listFilterBranch: {} },
    actions: [],
    startActionId: null,
  });

  const res = await syncFlowMap("tok");

  expect((client.getFlowDetail as jest.Mock).mock.calls.length).toBe(1);
  expect((client.getFlowDetail as jest.Mock).mock.calls[0][0]).toBe("B");
  const written = (store.writeSnapshot as jest.Mock).mock.calls[0][0];
  expect(Object.keys(written.flows).sort()).toEqual(["A", "B"]);
  expect(res.flowCount).toBe(2);
  expect(res.changed).toBe(1);
  expect(typeof res.generatedAt).toBe("string");
});

test("quota guard: detail fetch failure aborts without overwriting snapshot", async () => {
  (client.listFlows as jest.Mock).mockResolvedValue([
    { id: "B", name: "B", isEnabled: true, objectTypeId: "0-3", revisionId: "9" },
  ]);
  (store.getDetailCache as jest.Mock).mockResolvedValue({});
  (store.writeDetailCache as jest.Mock).mockResolvedValue(undefined);
  (store.writeSnapshot as jest.Mock).mockResolvedValue(undefined);
  (client.getFlowDetail as jest.Mock).mockRejectedValue(new Error("429 exhausted"));

  await expect(syncFlowMap("tok")).rejects.toThrow();
  expect((store.writeSnapshot as jest.Mock).mock.calls.length).toBe(0);
});
