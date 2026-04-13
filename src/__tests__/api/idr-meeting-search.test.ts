jest.mock("@/lib/api-auth", () => ({
  requireApiAuth: jest.fn().mockResolvedValue({ email: "test@photonbrothers.com", role: "ADMIN", name: "Test" }),
}));
jest.mock("@/lib/idr-meeting", () => ({
  isIdrAllowedRole: jest.fn().mockReturnValue(true),
  searchMeetingItems: jest.fn().mockResolvedValue({ items: [{ id: "1", dealId: "d1" }], total: 1, hasMore: false }),
}));

import { GET } from "@/app/api/idr-meeting/search/route";
import { searchMeetingItems } from "@/lib/idr-meeting";

const mockSearch = searchMeetingItems as jest.MockedFunction<typeof searchMeetingItems>;

describe("GET /api/idr-meeting/search", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns results for date-only request (no q param)", async () => {
    const req = new Request("http://localhost/api/idr-meeting/search?from=2026-03-01&to=2026-03-31");
    const res = await GET(req as any);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockSearch).toHaveBeenCalledWith(expect.objectContaining({ query: "", dateFrom: "2026-03-01", dateTo: "2026-03-31" }));
    expect(body.items).toHaveLength(1);
  });

  it("returns empty for no q and no date params", async () => {
    const req = new Request("http://localhost/api/idr-meeting/search");
    const res = await GET(req as any);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.items).toEqual([]);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it("returns results for text query", async () => {
    const req = new Request("http://localhost/api/idr-meeting/search?q=smith");
    const res = await GET(req as any);

    expect(res.status).toBe(200);
    expect(mockSearch).toHaveBeenCalledWith(expect.objectContaining({ query: "smith" }));
  });
});
