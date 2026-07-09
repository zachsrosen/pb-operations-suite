const mockUpdateDealProperty = jest.fn();
jest.mock("@/lib/hubspot", () => ({
  updateDealProperty: (...a: unknown[]) => mockUpdateDealProperty(...a),
}));
jest.mock("@/lib/api-auth", () => ({
  requireApiAuth: jest.fn().mockResolvedValue({ email: "pm@x" }),
}));

import { POST } from "@/app/api/deals/rtb-review/[dealId]/approve/route";
import { NextRequest } from "next/server";

beforeEach(() => mockUpdateDealProperty.mockReset());

it("approves a deal by setting pm_rtb_approved true", async () => {
  mockUpdateDealProperty.mockResolvedValue(true);
  const res = await POST(new NextRequest("http://localhost/x", { method: "POST" }), {
    params: Promise.resolve({ dealId: "111" }),
  });
  expect(res.status).toBe(200);
  expect(mockUpdateDealProperty).toHaveBeenCalledWith("111", { pm_rtb_approved: "true" });
});

it("returns 502 when the HubSpot write fails", async () => {
  mockUpdateDealProperty.mockResolvedValue(false);
  const res = await POST(new NextRequest("http://localhost/x", { method: "POST" }), {
    params: Promise.resolve({ dealId: "111" }),
  });
  expect(res.status).toBe(502);
});
