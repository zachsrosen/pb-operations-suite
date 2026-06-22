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

test("resumable: partial progress is persisted before a mid-backfill failure", async () => {
  // 60 changed flows (cache empty), so the loop crosses the PERSIST_EVERY=50
  // flush boundary. The 55th detail fetch throws — by then the first 50 have
  // already been flushed to the detail cache, so the next run can resume.
  const flowList = Array.from({ length: 60 }, (_, i) => ({
    id: `F${i}`,
    name: `F${i}`,
    isEnabled: true,
    objectTypeId: "0-3",
    revisionId: "1",
  }));
  (client.listFlows as jest.Mock).mockResolvedValue(flowList);
  (store.getDetailCache as jest.Mock).mockResolvedValue({});
  (store.writeDetailCache as jest.Mock).mockResolvedValue(undefined);
  (store.writeSnapshot as jest.Mock).mockResolvedValue(undefined);

  let calls = 0;
  (client.getFlowDetail as jest.Mock).mockImplementation(async (id: string) => {
    calls += 1;
    if (calls > 54) throw new Error("429 exhausted");
    return {
      id,
      name: id,
      isEnabled: true,
      objectTypeId: "0-3",
      revisionId: "1",
      enrollmentCriteria: { type: "LIST_BASED", listFilterBranch: {} },
      actions: [],
      startActionId: null,
    };
  });

  // Capture a snapshot of the cache size at the moment of each flush — the sync
  // mutates one cache object in place, so we can't inspect the reference later.
  const flushSizes: number[] = [];
  (store.writeDetailCache as jest.Mock).mockImplementation(async (c: object) => {
    flushSizes.push(Object.keys(c).length);
  });

  await expect(syncFlowMap("tok")).rejects.toThrow();

  // Progress was persisted incrementally: the cache was flushed at least once
  // BEFORE the failure (after the first PERSIST_EVERY=50 fetches) — not only at
  // the end. The flush carried the 50 already-fetched flows, so the next run
  // reuses them and only fetches the remaining ~10.
  expect(flushSizes.length).toBeGreaterThanOrEqual(1);
  expect(flushSizes[0]).toBe(50);
  // Quota guard still holds: no snapshot on failure.
  expect((store.writeSnapshot as jest.Mock).mock.calls.length).toBe(0);
});

test("resumable: detail cache is flushed before the snapshot on success", async () => {
  // Several changed flows, all succeed. writeDetailCache must be invoked before
  // writeSnapshot (progress persisted incrementally, snapshot strictly last).
  const order: string[] = [];
  (client.listFlows as jest.Mock).mockResolvedValue([
    { id: "A", name: "A", isEnabled: true, objectTypeId: "0-3", revisionId: "1" },
    { id: "B", name: "B", isEnabled: true, objectTypeId: "0-3", revisionId: "1" },
  ]);
  (store.getDetailCache as jest.Mock).mockResolvedValue({});
  (store.writeDetailCache as jest.Mock).mockImplementation(async () => {
    order.push("detail");
  });
  (store.writeSnapshot as jest.Mock).mockImplementation(async () => {
    order.push("snapshot");
  });
  (client.getFlowDetail as jest.Mock).mockResolvedValue({
    id: "A",
    name: "A",
    isEnabled: true,
    objectTypeId: "0-3",
    revisionId: "1",
    enrollmentCriteria: { type: "LIST_BASED", listFilterBranch: {} },
    actions: [],
    startActionId: null,
  });

  await syncFlowMap("tok");

  expect(order[0]).toBe("detail");
  expect(order[order.length - 1]).toBe("snapshot");
  expect(order.indexOf("detail")).toBeLessThan(order.indexOf("snapshot"));
});
