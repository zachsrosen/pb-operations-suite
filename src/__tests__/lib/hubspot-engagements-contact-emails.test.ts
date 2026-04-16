/**
 * Tests that getDealEngagements also pulls emails/calls/meetings from
 * each contact associated with the deal, and dedupes so engagements
 * that are on both the deal AND the contact appear once.
 *
 * Context: HubSpot often only associates emails to contacts (Gmail
 * extension, inbox captures, tracking pixels), so the deal view was
 * missing emails that HubSpot's own UI surfaces transitively.
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
import { getDealEngagements } from "@/lib/hubspot-engagements";

const mockAssocRead = hubspotClient.crm.associations.batchApi.read as jest.Mock;
const mockObjectsRead = hubspotClient.crm.objects.batchApi.read as jest.Mock;

/**
 * Wires up the mock HubSpot client:
 * - assoc reads: a lookup on (fromType, toType, fromId) → array of object IDs
 * - object reads: a lookup on (objectType, id) → properties object
 */
interface Fixture {
  /** key: `${fromType}:${fromId}->${toType}` → array of IDs */
  associations: Record<string, string[]>;
  /** key: `${objectType}:${id}` → properties map */
  objects: Record<string, Record<string, string>>;
}

function wireMocks(fixture: Fixture) {
  mockAssocRead.mockImplementation((fromType: string, toType: string, req: { inputs: Array<{ id: string }> }) => {
    const fromId = req.inputs[0]?.id ?? "";
    const key = `${fromType}:${fromId}->${toType}`;
    const ids = fixture.associations[key] ?? [];
    return Promise.resolve({
      results: [{ from: { id: fromId }, to: ids.map((id) => ({ id })) }],
    });
  });

  mockObjectsRead.mockImplementation((objectType: string, req: { inputs: Array<{ id: string }> }) => {
    const results = req.inputs.map((input) => ({
      id: input.id,
      properties: fixture.objects[`${objectType}:${input.id}`] ?? {},
    }));
    return Promise.resolve({ results });
  });
}

describe("getDealEngagements includes contact-associated engagements", () => {
  beforeEach(() => {
    mockAssocRead.mockReset();
    mockObjectsRead.mockReset();
  });

  it("includes emails that are on the contact but not on the deal", async () => {
    wireMocks({
      associations: {
        "deals:D1->emails": [],
        "deals:D1->calls": [],
        "deals:D1->notes": [],
        "deals:D1->meetings": [],
        "deals:D1->tasks": [],
        "deals:D1->contacts": ["C1"],
        "contacts:C1->emails": ["E-CONTACT-ONLY"],
        "contacts:C1->calls": [],
        "contacts:C1->meetings": [],
      },
      objects: {
        "emails:E-CONTACT-ONLY": { hs_timestamp: "2026-04-10T00:00:00Z", hs_email_subject: "Contact-only email" },
      },
    });

    const result = await getDealEngagements("D1", false);

    const emailSubjects = result.filter((e) => e.type === "email").map((e) => e.subject);
    expect(emailSubjects).toContain("Contact-only email");
  });

  it("dedupes an email that appears on both the deal and the contact", async () => {
    wireMocks({
      associations: {
        "deals:D1->emails": ["E-SHARED"],
        "deals:D1->calls": [],
        "deals:D1->notes": [],
        "deals:D1->meetings": [],
        "deals:D1->tasks": [],
        "deals:D1->contacts": ["C1"],
        "contacts:C1->emails": ["E-SHARED"],
        "contacts:C1->calls": [],
        "contacts:C1->meetings": [],
      },
      objects: {
        "emails:E-SHARED": { hs_timestamp: "2026-04-10T00:00:00Z", hs_email_subject: "Shared email" },
      },
    });

    const result = await getDealEngagements("D1", false);
    const sharedEmails = result.filter((e) => e.type === "email" && e.subject === "Shared email");
    expect(sharedEmails).toHaveLength(1);
  });

  it("does NOT pull contact-associated notes (would leak other-deal content)", async () => {
    // A contact may be on several deals; their notes often reference a
    // specific deal context and shouldn't spill into unrelated Communications.
    wireMocks({
      associations: {
        "deals:D1->emails": [],
        "deals:D1->calls": [],
        "deals:D1->notes": [],
        "deals:D1->meetings": [],
        "deals:D1->tasks": [],
        "deals:D1->contacts": ["C1"],
        "contacts:C1->emails": [],
        "contacts:C1->calls": [],
        "contacts:C1->meetings": [],
        // Even if the SDK were asked for contact notes, the result should be ignored.
        "contacts:C1->notes": ["N-CONTACT-ONLY"],
      },
      objects: {
        "notes:N-CONTACT-ONLY": { hs_timestamp: "2026-04-10T00:00:00Z", hs_note_body: "Different-deal note" },
      },
    });

    const result = await getDealEngagements("D1", false);
    expect(result.filter((e) => e.type === "note")).toHaveLength(0);
  });
});
