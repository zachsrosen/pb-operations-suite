jest.mock("@/lib/bottlenecks", () => ({ computeBottleneckSnapshot: jest.fn() }));
jest.mock("@/lib/sentry-request", () => ({ tagSentryRequest: jest.fn() }));

import { NextRequest } from "next/server";
import { GET } from "@/app/api/bottlenecks/summary/route";
import { computeBottleneckSnapshot } from "@/lib/bottlenecks";

function makeRequest(): NextRequest {
  return new NextRequest(new URL("http://localhost:3000/api/bottlenecks/summary"));
}

describe("GET /api/bottlenecks/summary", () => {
  it("returns the snapshot with lastUpdated", async () => {
    (computeBottleneckSnapshot as jest.Mock).mockResolvedValue({
      computedAt: "2026-07-07T14:00:00.000Z",
      stages: [],
    });
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.lastUpdated).toBe("2026-07-07T14:00:00.000Z");
    expect(body.stages).toEqual([]);
  });

  it("returns 500 with the error message on failure", async () => {
    (computeBottleneckSnapshot as jest.Mock).mockRejectedValue(new Error("boom"));
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error).toBe("boom");
  });
});
