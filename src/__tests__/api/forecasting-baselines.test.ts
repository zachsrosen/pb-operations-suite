import { NextRequest } from "next/server";
import { GET } from "@/app/api/forecasting/baselines/route";

jest.mock("@/lib/forecasting", () => ({
  getBaselineTable: jest.fn(),
}));

function makeRequest(): NextRequest {
  return new NextRequest(
    new URL("http://localhost:3000/api/forecasting/baselines"),
  );
}

describe("GET /api/forecasting/baselines", () => {
  const { getBaselineTable } = jest.requireMock("@/lib/forecasting");

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns the baseline table with summary", async () => {
    getBaselineTable.mockResolvedValue({
      data: {
        "Westminster|Boulder County|Xcel": {
          sampleCount: 10,
          pairs: {
            close_to_designComplete: {
              median: 14,
              p25: 10,
              p75: 18,
              sampleCount: 10,
            },
          },
        },
        global: {
          sampleCount: 50,
          pairs: {
            close_to_designComplete: {
              median: 16,
              p25: 12,
              p75: 20,
              sampleCount: 50,
            },
          },
        },
      },
      cached: true,
      stale: false,
      lastUpdated: "2025-01-01T00:00:00Z",
    });

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.baselines).toBeDefined();
    expect(body.baselines.global).toBeDefined();
    expect(body.summary.segmentCount).toBe(2);
    expect(body.summary.totalCompletedProjects).toBe(50);
    expect(body.cached).toBe(true);
  });

  it("returns 500 on error", async () => {
    getBaselineTable.mockRejectedValue(new Error("DB down"));

    const res = await GET(makeRequest());
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toBe("Failed to fetch forecast baselines");
  });
});
