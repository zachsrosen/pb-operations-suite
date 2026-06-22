import { listFlows } from "@/lib/flow-map/client";

test("listFlows paginates via paging.next.after", async () => {
  const pages = [
    { results: [{ id: "1" }], paging: { next: { after: "A" } } },
    { results: [{ id: "2" }] },
  ];
  let i = 0;
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => pages[i++] })) as any;
  const flows = await listFlows("tok");
  expect(flows.map((f: any) => f.id)).toEqual(["1", "2"]);
});

test("retries on 429 then succeeds", async () => {
  let n = 0;
  global.fetch = jest.fn(async () => {
    n++;
    if (n === 1) return { ok: false, status: 429, json: async () => ({}), headers: { get: () => null } } as any;
    return { ok: true, status: 200, json: async () => ({ results: [{ id: "x" }] }) } as any;
  }) as any;
  const flows = await listFlows("tok");
  expect(flows.map((f: any) => f.id)).toEqual(["x"]);
  expect(n).toBe(2);
});
