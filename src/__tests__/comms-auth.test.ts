import { getActualCommsUser } from "@/lib/comms-auth";

// Mock auth() and getUserByEmail
jest.mock("@/auth", () => ({
  auth: jest.fn(),
}));
jest.mock("@/lib/db", () => ({
  getUserByEmail: jest.fn(),
}));

import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";

const mockAuth = auth as jest.Mock;
const mockGetUser = getUserByEmail as jest.Mock;

describe("getActualCommsUser", () => {
  afterEach(() => jest.resetAllMocks());

  test("returns null if no session", async () => {
    mockAuth.mockResolvedValue(null as any);
    const result = await getActualCommsUser();
    expect(result).toEqual({ user: null, blocked: false });
  });

  test("returns user when not impersonating", async () => {
    mockAuth.mockResolvedValue({
      user: { email: "zach@photonbrothers.com" },
    } as any);
    mockGetUser.mockResolvedValue({
      id: "cuid_123",
      email: "zach@photonbrothers.com",
      name: "Zach",
      role: "ADMIN",
      impersonatingUserId: null,
    } as any);
    const result = await getActualCommsUser();
    expect(result.user?.id).toBe("cuid_123");
    expect(result.blocked).toBe(false);
  });

  test("returns blocked=true when admin is impersonating", async () => {
    mockAuth.mockResolvedValue({
      user: { email: "zach@photonbrothers.com" },
    } as any);
    mockGetUser.mockResolvedValue({
      id: "cuid_123",
      email: "zach@photonbrothers.com",
      name: "Zach",
      role: "ADMIN",
      impersonatingUserId: "cuid_456",
    } as any);
    const result = await getActualCommsUser();
    expect(result.blocked).toBe(true);
    expect(result.user).toBeNull();
  });
});
