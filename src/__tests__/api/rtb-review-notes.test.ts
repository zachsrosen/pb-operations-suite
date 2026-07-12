const mockUpdateDealProperty = jest.fn();
jest.mock("@/lib/hubspot", () => ({
  updateDealProperty: (...a: unknown[]) => mockUpdateDealProperty(...a),
}));
jest.mock("@/lib/api-auth", () => ({
  requireApiAuth: jest.fn().mockResolvedValue({ email: "pm@x" }),
}));

import { POST } from "@/app/api/deals/rtb-review/[dealId]/notes/route";
import { NextRequest } from "next/server";

function req(body: unknown) {
  return new NextRequest("http://localhost/x", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => mockUpdateDealProperty.mockReset());

it("writes the RTB blocked notes to the deal", async () => {
  mockUpdateDealProperty.mockResolvedValue(true);
  const res = await POST(req({ notes: "Waiting on meter release" }), {
    params: Promise.resolve({ dealId: "111" }),
  });
  expect(res.status).toBe(200);
  expect(mockUpdateDealProperty).toHaveBeenCalledWith("111", {
    rtb_blocked_reason: "Waiting on meter release",
  });
});

it("clears the notes when an empty string is sent", async () => {
  mockUpdateDealProperty.mockResolvedValue(true);
  const res = await POST(req({ notes: "" }), {
    params: Promise.resolve({ dealId: "111" }),
  });
  expect(res.status).toBe(200);
  expect(mockUpdateDealProperty).toHaveBeenCalledWith("111", {
    rtb_blocked_reason: "",
  });
});

it("rejects a non-string notes payload", async () => {
  const res = await POST(req({ notes: 42 }), {
    params: Promise.resolve({ dealId: "111" }),
  });
  expect(res.status).toBe(400);
  expect(mockUpdateDealProperty).not.toHaveBeenCalled();
});

it("returns 502 when the HubSpot write fails", async () => {
  mockUpdateDealProperty.mockResolvedValue(false);
  const res = await POST(req({ notes: "x" }), {
    params: Promise.resolve({ dealId: "111" }),
  });
  expect(res.status).toBe(502);
});
