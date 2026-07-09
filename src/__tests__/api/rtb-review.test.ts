const mockFetchRtbQueue = jest.fn();
jest.mock("@/lib/rtb-review", () => ({ fetchRtbQueue: () => mockFetchRtbQueue() }));
jest.mock("@/lib/api-auth", () => ({
  requireApiAuth: jest.fn().mockResolvedValue({ email: "pm@x" }),
}));

import { GET } from "@/app/api/deals/rtb-review/route";
import { NextRequest } from "next/server";

it("returns the queue as JSON", async () => {
  mockFetchRtbQueue.mockResolvedValue([
    { dealId: "111", dealName: "PROJ-1000", approved: false },
  ]);
  const res = await GET(new NextRequest("http://localhost/api/deals/rtb-review"));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.items).toHaveLength(1);
  expect(body.items[0].dealId).toBe("111");
});
