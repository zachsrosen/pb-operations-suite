import { getValidCommsAccessToken } from "@/lib/comms-token";

jest.mock("@/lib/db", () => ({
  prisma: {
    commsGmailToken: {
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
}));
jest.mock("@/lib/comms-crypto", () => ({
  commsEncryptToken: jest.fn((v: string) => `enc_${v}`),
  commsDecryptToken: jest.fn((v: string) => v.replace("enc_", "")),
}));

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

import { prisma } from "@/lib/db";

describe("getValidCommsAccessToken", () => {
  afterEach(() => jest.clearAllMocks());

  test("returns cached token when not expired", async () => {
    (prisma.commsGmailToken.findUnique as jest.Mock).mockResolvedValue({
      gmailAccessToken: "enc_valid-token",
      gmailRefreshToken: "enc_refresh-token",
      gmailTokenExpiry: BigInt(Date.now() + 600_000), // 10 min from now
    });

    const result = await getValidCommsAccessToken("user-123");
    expect(result).toEqual({ accessToken: "valid-token" });
    expect(mockFetch).not.toHaveBeenCalled(); // no refresh needed
  });

  test("refreshes expired token", async () => {
    (prisma.commsGmailToken.findUnique as jest.Mock).mockResolvedValue({
      id: 1,
      gmailAccessToken: "enc_expired-token",
      gmailRefreshToken: "enc_my-refresh-token",
      gmailTokenExpiry: BigInt(Date.now() - 1000), // expired
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "new-access-token",
        expires_in: 3600,
      }),
    });
    (prisma.commsGmailToken.update as jest.Mock).mockResolvedValue({});

    const result = await getValidCommsAccessToken("user-123");
    expect(result).toEqual({ accessToken: "new-access-token" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test("returns disconnected on invalid_grant", async () => {
    (prisma.commsGmailToken.findUnique as jest.Mock).mockResolvedValue({
      id: 1,
      userId: "user-123",
      gmailAccessToken: "enc_expired-token",
      gmailRefreshToken: "enc_dead-refresh",
      gmailTokenExpiry: BigInt(Date.now() - 1000),
    });
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "invalid_grant" }),
    });
    (prisma.commsGmailToken.delete as jest.Mock).mockResolvedValue({});

    const result = await getValidCommsAccessToken("user-123");
    expect(result).toEqual({ disconnected: true });
  });

  test("returns disconnected when no token exists", async () => {
    (prisma.commsGmailToken.findUnique as jest.Mock).mockResolvedValue(null);
    const result = await getValidCommsAccessToken("user-123");
    expect(result).toEqual({ disconnected: true });
  });
});
