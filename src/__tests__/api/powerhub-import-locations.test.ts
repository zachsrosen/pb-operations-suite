/**
 * import-locations must run the full cross-system push when it links or
 * unlinks a site — resolvePrimarySite alone leaves tesla_portal_url off the
 * linked HubSpot deals (the 2026-07-10/11 relink batch shipped ~87 properties
 * whose deals stayed unstamped until a manual backfill).
 */
const mockResolvePrimarySite = jest.fn();
const mockPushToHubSpotForProperty = jest.fn();

jest.mock("@/auth", () => ({ auth: jest.fn() }));
jest.mock("@/lib/db", () => ({
  prisma: {
    hubSpotPropertyCache: { findMany: jest.fn() },
    powerhubSite: { findMany: jest.fn(), update: jest.fn() },
  },
  getUserByEmail: jest.fn(),
}));
jest.mock("@/lib/powerhub-crosslink", () => ({
  resolvePrimarySite: (...a: unknown[]) => mockResolvePrimarySite(...a),
  pushToHubSpotForProperty: (...a: unknown[]) => mockPushToHubSpotForProperty(...a),
}));

import { prisma } from "@/lib/db";
import { POST } from "@/app/api/powerhub/import-locations/route";

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

const SITE_ID = "11111111-1111-1111-1111-111111111111";
const PROPERTY_ID = "prop_cache_1";

function mkReq(body: unknown, query = ""): Request {
  return new Request(`http://localhost/api/powerhub/import-locations${query}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      // Machine-token mode — middleware sets this after verifying the Bearer token
      "x-api-token-authenticated": "1",
    },
  });
}

let savedEnabled: string | undefined;

beforeEach(() => {
  jest.clearAllMocks();
  savedEnabled = process.env.POWERHUB_ENABLED;
  process.env.POWERHUB_ENABLED = "true";
  mockResolvePrimarySite.mockResolvedValue(null);
  mockPushToHubSpotForProperty.mockResolvedValue(undefined);
  (mockPrisma.powerhubSite.update as jest.Mock).mockResolvedValue({});
});

afterEach(() => {
  if (savedEnabled === undefined) delete process.env.POWERHUB_ENABLED;
  else process.env.POWERHUB_ENABLED = savedEnabled;
});

describe("POST /api/powerhub/import-locations cross-system push", () => {
  it("pushes to HubSpot for a property the site gets geo-linked to", async () => {
    // One candidate property at the exact incoming coords → HIGH-confidence link
    (mockPrisma.hubSpotPropertyCache.findMany as jest.Mock).mockResolvedValue([
      { id: PROPERTY_ID, latitude: 39.7, longitude: -104.9 },
    ]);
    (mockPrisma.powerhubSite.findMany as jest.Mock).mockResolvedValue([
      { siteId: SITE_ID, propertyId: null, linkMethod: "UNLINKED" },
    ]);

    const res = await POST(
      mkReq({ sites: [{ siteId: SITE_ID, latitude: 39.7, longitude: -104.9 }] }),
    );
    const json = await res.json();

    expect(json.linksWritten).toBe(1);
    expect(mockResolvePrimarySite).toHaveBeenCalledWith(PROPERTY_ID);
    expect(mockPushToHubSpotForProperty).toHaveBeenCalledWith(PROPERTY_ID);
  });

  it("pushes for the old property when a stale link is cleared", async () => {
    // No candidate properties anywhere near → site gets unlinked from PROPERTY_ID
    (mockPrisma.hubSpotPropertyCache.findMany as jest.Mock).mockResolvedValue([]);
    (mockPrisma.powerhubSite.findMany as jest.Mock).mockResolvedValue([
      { siteId: SITE_ID, propertyId: PROPERTY_ID, linkMethod: "GEO" },
    ]);

    const res = await POST(
      mkReq({ sites: [{ siteId: SITE_ID, latitude: 39.7, longitude: -104.9 }] }),
    );
    const json = await res.json();

    expect(json.linksCleared).toBe(1);
    expect(mockResolvePrimarySite).toHaveBeenCalledWith(PROPERTY_ID);
    expect(mockPushToHubSpotForProperty).toHaveBeenCalledWith(PROPERTY_ID);
  });

  it("does not resolve or push in dryRun mode", async () => {
    (mockPrisma.hubSpotPropertyCache.findMany as jest.Mock).mockResolvedValue([
      { id: PROPERTY_ID, latitude: 39.7, longitude: -104.9 },
    ]);
    (mockPrisma.powerhubSite.findMany as jest.Mock).mockResolvedValue([
      { siteId: SITE_ID, propertyId: null, linkMethod: "UNLINKED" },
    ]);

    await POST(
      mkReq({ sites: [{ siteId: SITE_ID, latitude: 39.7, longitude: -104.9 }] }, "?dryRun=1"),
    );

    expect(mockResolvePrimarySite).not.toHaveBeenCalled();
    expect(mockPushToHubSpotForProperty).not.toHaveBeenCalled();
  });
});
