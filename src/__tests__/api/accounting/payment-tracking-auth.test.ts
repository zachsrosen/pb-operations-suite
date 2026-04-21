jest.mock("@/lib/auth-utils", () => ({
  getCurrentUser: jest.fn(),
}));
jest.mock("@/lib/hubspot", () => ({
  searchWithRetry: jest.fn().mockResolvedValue({ results: [], paging: undefined }),
}));
jest.mock("@/lib/deals-pipeline", () => ({
  getStageMaps: jest.fn().mockResolvedValue({}),
}));
jest.mock("@/lib/payment-tracking-cache", () => ({
  initPaymentTrackingCascade: jest.fn(),
}));
jest.mock("@/lib/cache", () => {
  const actual = jest.requireActual("@/lib/cache");
  return {
    ...actual,
    appCache: {
      get: jest.fn().mockReturnValue(undefined),
      set: jest.fn(),
      invalidate: jest.fn(),
      subscribe: jest.fn(),
    },
  };
});

import { GET } from "@/app/api/accounting/payment-tracking/route";
import { getCurrentUser } from "@/lib/auth-utils";

describe("/api/accounting/payment-tracking GET — auth", () => {
  beforeEach(() => jest.clearAllMocks());

  it("401 when no session", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("403 for VIEWER", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue({ email: "v@p.com", roles: ["VIEWER"] });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("200 for ACCOUNTING", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue({ email: "a@p.com", roles: ["ACCOUNTING"] });
    const res = await GET();
    expect(res.status).toBe(200);
  });

  it("200 for ADMIN", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue({ email: "admin@p.com", roles: ["ADMIN"] });
    const res = await GET();
    expect(res.status).toBe(200);
  });

  it("200 for EXECUTIVE", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue({ email: "e@p.com", roles: ["EXECUTIVE"] });
    const res = await GET();
    expect(res.status).toBe(200);
  });
});
