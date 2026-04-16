/**
 * Tests that hubspot-engagements.fetchAssociatedObjects surfaces 4xx
 * errors (e.g. 403 MISSING_SCOPES) to Sentry instead of silently
 * swallowing them and returning []. Transient 429 / 5xx errors
 * continue to be swallowed.
 *
 * Context: Production bug 2026-04-16 — the Suite's HubSpot token lost
 * its email scopes. Our catch-all handler hid the 403, so emails
 * silently disappeared from the Communications section for weeks.
 */

jest.mock("@hubspot/api-client", () => ({
  Client: jest.fn().mockImplementation(() => ({
    crm: {
      associations: { batchApi: { read: jest.fn() } },
      objects: { batchApi: { read: jest.fn() } },
    },
  })),
}));

jest.mock("@hubspot/api-client/lib/codegen/crm/objects/notes/models/AssociationSpec", () => ({
  AssociationSpecAssociationCategoryEnum: { HubspotDefined: "HUBSPOT_DEFINED" },
}));

jest.mock("@sentry/nextjs", () => ({
  captureException: jest.fn(),
}));

// Bypass the real in-memory TTL cache — just invoke the fetcher directly.
jest.mock("@/lib/cache", () => ({
  appCache: {
    getOrFetch: async (_key: string, fetcher: () => Promise<unknown>) => ({
      data: await fetcher(),
      cached: false,
      stale: false,
      lastUpdated: new Date().toISOString(),
    }),
  },
  CACHE_KEYS: {
    DEAL_ENGAGEMENTS_ALL: (id: string) => `deal-engagements:${id}:all`,
    DEAL_ENGAGEMENTS_RECENT: (id: string) => `deal-engagements:${id}:recent`,
    DEAL_TASKS_ALL: (id: string) => `deal-tasks:${id}:all`,
    DEAL_TASKS_RECENT: (id: string) => `deal-tasks:${id}:recent`,
  },
}));

import { hubspotClient } from "@/lib/hubspot";
import * as Sentry from "@sentry/nextjs";
import { getDealEngagements } from "@/lib/hubspot-engagements";

const mockAssocRead = hubspotClient.crm.associations.batchApi.read as jest.Mock;
const mockObjectsRead = hubspotClient.crm.objects.batchApi.read as jest.Mock;
const mockCapture = Sentry.captureException as jest.Mock;

/** Build a HubSpot-SDK-shaped error (the SDK throws Errors with `code`). */
function hubspotError(status: number, bodyMessage: string): Error {
  const err = new Error(`HTTP-Code: ${status}\nMessage: ${bodyMessage}`);
  (err as Error & { code?: number }).code = status;
  return err;
}

describe("hubspot-engagements scope-drop alerting", () => {
  beforeEach(() => {
    mockAssocRead.mockReset();
    mockObjectsRead.mockReset();
    mockCapture.mockReset();
  });

  it("sends a 403 MISSING_SCOPES error to Sentry with module + status tags", async () => {
    // All engagement types see a single associated engagement.
    mockAssocRead.mockResolvedValue({ results: [{ to: [{ id: "eng-1" }] }] });

    // Only the "emails" object read fails — simulates the real prod bug.
    // The 403 may fire twice (deal→emails AND contact→emails) since
    // getDealEngagements walks both; both are legitimate Sentry alerts.
    mockObjectsRead.mockImplementation((toType: string) => {
      if (toType === "emails") {
        return Promise.reject(hubspotError(403, "MISSING_SCOPES: requires sales-email-read"));
      }
      return Promise.resolve({ results: [{ id: "eng-1", properties: {} }] });
    });

    const result = await getDealEngagements("deal-hs-123", false);

    // Function doesn't crash — emails silently become [].
    expect(Array.isArray(result)).toBe(true);

    // The 403 IS sent to Sentry with useful context. Called at least once —
    // real-world scope drop on emails fires once per association walk.
    expect(mockCapture).toHaveBeenCalled();
    expect(mockCapture).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({
          module: "hubspot-engagements",
          status: 403,
          toObjectType: "emails",
        }),
      }),
    );
  });

  // Per-test timeout bump: 429 retry delays (1.1s + 2.2s ≈ 3.3s per sequence)
  // happen twice (deals→emails and contacts→emails walks) so we need ~7s
  // real time. Default jest timeout is 5s.
  it("does NOT send transient 429 (rate limit) errors to Sentry", async () => {
    mockAssocRead.mockResolvedValue({ results: [{ to: [{ id: "eng-1" }] }] });
    mockObjectsRead.mockImplementation((toType: string) => {
      if (toType === "emails") {
        return Promise.reject(hubspotError(429, "rate limited"));
      }
      return Promise.resolve({ results: [{ id: "eng-1", properties: {} }] });
    });

    await getDealEngagements("deal-hs-123", false);

    expect(mockCapture).not.toHaveBeenCalled();
  }, 15_000);

  it("does NOT send transient 5xx errors to Sentry", async () => {
    mockAssocRead.mockResolvedValue({ results: [{ to: [{ id: "eng-1" }] }] });
    mockObjectsRead.mockImplementation((toType: string) => {
      if (toType === "emails") {
        return Promise.reject(hubspotError(503, "service unavailable"));
      }
      return Promise.resolve({ results: [{ id: "eng-1", properties: {} }] });
    });

    await getDealEngagements("deal-hs-123", false);

    expect(mockCapture).not.toHaveBeenCalled();
  });
});
