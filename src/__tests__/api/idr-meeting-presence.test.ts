jest.mock("@/lib/api-auth", () => ({
  requireApiAuth: jest.fn().mockResolvedValue({ email: "test@photonbrothers.com", role: "ADMIN", name: "Test" }),
}));
jest.mock("@/lib/idr-meeting", () => ({
  isIdrAllowedRole: jest.fn().mockReturnValue(true),
}));

import { NextRequest } from "next/server";
import { POST, GET } from "@/app/api/idr-meeting/presence/route";

// Use NextRequest so the GET handler can read req.nextUrl.searchParams
function makeReq(url: string, opts?: { method?: string; body?: unknown }): NextRequest {
  return new NextRequest(new URL(url), {
    method: opts?.method ?? "GET",
    headers: { "Content-Type": "application/json" },
    ...(opts?.body ? { body: JSON.stringify(opts.body) } : {}),
  });
}

describe("presence search-mode exclusion", () => {
  it("search-mode user does not appear in prep presence list", async () => {
    // Register a search-mode user
    await POST(makeReq("http://localhost/api/idr-meeting/presence", {
      method: "POST",
      body: { sessionId: null, selectedItemId: null, mode: "search" },
    }));

    // Query prep presence (no sessionId param)
    const res = await GET(makeReq("http://localhost/api/idr-meeting/presence"));
    const body = await res.json();

    expect(body.users).toEqual([]);
  });

  it("prep-mode user still appears in prep presence list", async () => {
    await POST(makeReq("http://localhost/api/idr-meeting/presence", {
      method: "POST",
      body: { sessionId: null, selectedItemId: null },
    }));

    const res = await GET(makeReq("http://localhost/api/idr-meeting/presence"));
    const body = await res.json();

    expect(body.users).toHaveLength(1);
    expect(body.users[0].email).toBe("test@photonbrothers.com");
  });
});
