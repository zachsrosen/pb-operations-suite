/**
 * Tesla PowerHub token persistence tests.
 *
 * Every serverless cold start used to request a fresh token; Tesla throttles
 * token issuance (403s stalled the alerts cron twice on 2026-07-10). Tokens
 * are now shared across instances via a SystemConfig row: memory (L1) →
 * SystemConfig (L2) → network, with DB failures degrading to network-only.
 */
jest.mock("@/lib/db", () => ({
  prisma: {
    systemConfig: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  },
}));

import { createPowerHubClient } from "@/lib/tesla-powerhub";
import { prisma } from "@/lib/db";

const mockFindUnique = prisma.systemConfig.findUnique as jest.Mock;
const mockUpsert = prisma.systemConfig.upsert as jest.Mock;

const mockFetch = jest.fn();
global.fetch = mockFetch;

const TEST_ENV = {
  POWERHUB_ENABLED: "true",
  TESLA_POWERHUB_CLIENT_ID: "test-client-id",
  TESLA_POWERHUB_CLIENT_SECRET: "test-client-secret",
  TESLA_POWERHUB_PROXY_URL: "https://pb-powerhub-proxy.fly.dev",
};

function fakeJwt(sub: string, expSeconds?: number): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64");
  const payload = Buffer.from(
    JSON.stringify({ sub, exp: expSeconds ?? Math.floor(Date.now() / 1000) + 600 })
  ).toString("base64");
  return `${header}.${payload}.fake-signature`;
}

function tokenResponse(sub: string) {
  return new Response(
    JSON.stringify({
      meta: { request_id: "test-req-id" },
      data: { access_token: fakeJwt(sub), token_type: "Bearer" },
      links: null,
    }),
    { status: 200 }
  );
}

function dataResponse(data: unknown) {
  return new Response(JSON.stringify({ data }), { status: 200 });
}

function tokenEndpointCalls(): number {
  return mockFetch.mock.calls.filter((c: [string]) => String(c[0]).includes("/auth/token"))
    .length;
}

beforeEach(() => {
  jest.resetAllMocks();
  Object.entries(TEST_ENV).forEach(([k, v]) => {
    process.env[k] = v;
  });
  mockUpsert.mockResolvedValue({});
});

describe("PowerHub token persistence", () => {
  it("uses a valid token from SystemConfig without hitting the token endpoint", async () => {
    const storedJwt = fakeJwt("stored-token");
    mockFindUnique.mockResolvedValue({
      key: "powerhub_access_token",
      value: JSON.stringify({ jwt: storedJwt, expiresAt: Date.now() + 500_000 }),
    });
    mockFetch.mockResolvedValueOnce(dataResponse([{ group_id: "g1" }]));

    const client = createPowerHubClient();
    await client.getGroups();

    expect(tokenEndpointCalls()).toBe(0);
    const dataCall = mockFetch.mock.calls[0];
    expect(dataCall[1].headers.Authorization).toBe(`Bearer ${storedJwt}`);
  });

  it("requests a new token and persists it when the stored one is expired", async () => {
    mockFindUnique.mockResolvedValue({
      key: "powerhub_access_token",
      value: JSON.stringify({ jwt: fakeJwt("old"), expiresAt: Date.now() - 1000 }),
    });
    mockFetch
      .mockResolvedValueOnce(tokenResponse("fresh-token"))
      .mockResolvedValueOnce(dataResponse([{ group_id: "g1" }]));

    const client = createPowerHubClient();
    await client.getGroups();

    expect(tokenEndpointCalls()).toBe(1);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "powerhub_access_token" },
      })
    );
    const upsertArg = mockUpsert.mock.calls[0][0];
    const persisted = JSON.parse(upsertArg.create.value);
    expect(persisted.jwt).toContain(".");
    expect(persisted.expiresAt).toBeGreaterThan(Date.now());
  });

  it("re-auths via the network when a persisted token is rejected with 401", async () => {
    // A stored token that looks valid but Tesla has revoked. The DB keeps
    // returning it — the client must actively bypass it after a 401, not
    // hope the row disappears.
    const revoked = {
      key: "powerhub_access_token",
      value: JSON.stringify({ jwt: fakeJwt("revoked"), expiresAt: Date.now() + 500_000 }),
    };
    mockFindUnique.mockResolvedValue(revoked);

    mockFetch
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 })) // data call w/ revoked token
      .mockResolvedValueOnce(tokenResponse("fresh-after-401")) // re-auth
      .mockResolvedValueOnce(dataResponse([{ group_id: "g1" }])); // retried data call

    const client = createPowerHubClient();
    const groups = await client.getGroups();

    expect(groups).toEqual([{ group_id: "g1" }]);
    expect(tokenEndpointCalls()).toBe(1);
  });

  it("degrades to network-only when the DB is unavailable", async () => {
    mockFindUnique.mockRejectedValue(new Error("db down"));
    mockUpsert.mockRejectedValue(new Error("db down"));
    mockFetch
      .mockResolvedValueOnce(tokenResponse("net-token"))
      .mockResolvedValueOnce(dataResponse([{ group_id: "g1" }]));

    const client = createPowerHubClient();
    const groups = await client.getGroups();

    expect(groups).toEqual([{ group_id: "g1" }]);
    expect(tokenEndpointCalls()).toBe(1);
  });
});
