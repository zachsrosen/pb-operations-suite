// Mock @/lib/db before any imports
jest.mock("@/lib/db", () => ({
  getCachedZuperJobsByDealIds: jest.fn().mockResolvedValue([]),
  prisma: {
    zuperJobCache: { findMany: jest.fn().mockResolvedValue([]) },
    propertyContactLink: { findMany: jest.fn().mockResolvedValue([]) },
  },
}));

jest.mock("@/lib/property-detail", () => {
  const actual = jest.requireActual("@/lib/property-detail");
  return {
    ...actual,
    computeEquipmentSummary: jest.fn().mockResolvedValue({
      modules: { count: 0, totalWattage: 0 },
      inverters: { count: 0 },
      batteries: { count: 0, totalKwh: 0 },
      evChargers: { count: 0 },
    }),
  };
});

jest.mock("@/lib/hubspot", () => ({
  hubspotClient: {
    crm: {
      contacts: {
        searchApi: { doSearch: jest.fn() },
        batchApi: { read: jest.fn() },
      },
      companies: {
        searchApi: { doSearch: jest.fn() },
        batchApi: { read: jest.fn() },
      },
      associations: {
        batchApi: { read: jest.fn() },
      },
      deals: { batchApi: { read: jest.fn() } },
      tickets: { batchApi: { read: jest.fn() } },
    },
  },
}));

jest.mock("@sentry/nextjs", () => ({
  captureException: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

import { searchContacts, resolveContactDetail } from "@/lib/customer-resolver";
import { hubspotClient } from "@/lib/hubspot";
import { getCachedZuperJobsByDealIds, prisma } from "@/lib/db";
import { computeEquipmentSummary } from "@/lib/property-detail";

// Typed mock references
const mockContactSearch = hubspotClient.crm.contacts.searchApi.doSearch as jest.Mock;
const mockContactBatchRead = hubspotClient.crm.contacts.batchApi.read as jest.Mock;
const mockCompanySearch = hubspotClient.crm.companies.searchApi.doSearch as jest.Mock;
const mockAssociationRead = hubspotClient.crm.associations.batchApi.read as jest.Mock;
const mockDealBatchRead = hubspotClient.crm.deals.batchApi.read as jest.Mock;
const mockTicketBatchRead = hubspotClient.crm.tickets.batchApi.read as jest.Mock;
const mockCompanyBatchRead = hubspotClient.crm.companies.batchApi.read as jest.Mock;
const mockGetZuperJobs = getCachedZuperJobsByDealIds as jest.Mock;
const mockPrismaFindMany = prisma.zuperJobCache.findMany as jest.Mock;
const mockPropertyContactLinkFindMany = prisma.propertyContactLink.findMany as jest.Mock;
const mockComputeEquipmentSummary = computeEquipmentSummary as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  // Default: empty results
  mockContactSearch.mockResolvedValue({ results: [], paging: null });
  mockCompanySearch.mockResolvedValue({ results: [], paging: null });
  mockContactBatchRead.mockResolvedValue({ results: [] });
  mockAssociationRead.mockResolvedValue({ results: [] });
  mockDealBatchRead.mockResolvedValue({ results: [] });
  mockTicketBatchRead.mockResolvedValue({ results: [] });
  mockGetZuperJobs.mockResolvedValue([]);
  mockPrismaFindMany.mockResolvedValue([]);
  mockPropertyContactLinkFindMany.mockResolvedValue([]);
  mockComputeEquipmentSummary.mockResolvedValue({
    modules: { count: 0, totalWattage: 0 },
    inverters: { count: 0 },
    batteries: { count: 0, totalKwh: 0 },
    evChargers: { count: 0 },
  });
});

// ---------------------------------------------------------------------------
// formatContactAddress (tested indirectly through searchContacts)
// ---------------------------------------------------------------------------

describe("formatContactAddress (via searchContacts)", () => {
  it("formats full address from contact properties", async () => {
    mockContactSearch.mockResolvedValue({
      results: [{
        id: "c1",
        properties: {
          firstname: "John",
          lastname: "Smith",
          email: "john@example.com",
          phone: "555-1234",
          address: "123 Main St",
          city: "Denver",
          state: "CO",
          zip: "80202",
          company: "Acme",
        },
      }],
      paging: null,
    });

    const result = await searchContacts("john");
    expect(result.results[0].address).toBe("123 Main St, Denver, CO, 80202");
  });

  it("returns null when no address properties are set", async () => {
    mockContactSearch.mockResolvedValue({
      results: [{
        id: "c1",
        properties: {
          firstname: "John",
          lastname: "Smith",
          email: null,
          phone: null,
          address: null,
          city: null,
          state: null,
          zip: null,
          company: null,
        },
      }],
      paging: null,
    });

    const result = await searchContacts("john");
    expect(result.results[0].address).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// searchContacts
// ---------------------------------------------------------------------------

describe("searchContacts", () => {
  it("returns contacts from direct contact search", async () => {
    mockContactSearch.mockResolvedValue({
      results: [
        {
          id: "c1",
          properties: {
            firstname: "Alice",
            lastname: "Johnson",
            email: "alice@example.com",
            phone: "555-0001",
            address: "100 Oak Ave",
            city: "Boulder",
            state: "CO",
            zip: "80301",
            company: "Solar Corp",
          },
        },
        {
          id: "c2",
          properties: {
            firstname: "Bob",
            lastname: "Williams",
            email: "bob@example.com",
            phone: "555-0002",
            address: "200 Pine Dr",
            city: "Denver",
            state: "CO",
            zip: "80202",
            company: null,
          },
        },
      ],
      paging: null,
    });

    const result = await searchContacts("alice");
    expect(result.results).toHaveLength(2);
    expect(result.truncated).toBe(false);

    expect(result.results[0]).toEqual({
      contactId: "c1",
      firstName: "Alice",
      lastName: "Johnson",
      email: "alice@example.com",
      phone: "555-0001",
      address: "100 Oak Ave, Boulder, CO, 80301",
      companyName: "Solar Corp",
    });

    expect(result.results[1]).toEqual({
      contactId: "c2",
      firstName: "Bob",
      lastName: "Williams",
      email: "bob@example.com",
      phone: "555-0002",
      address: "200 Pine Dr, Denver, CO, 80202",
      companyName: null,
    });
  });

  it("returns contacts from company search (resolved to contacts, deduped)", async () => {
    // No direct contact hits
    mockContactSearch.mockResolvedValue({ results: [], paging: null });

    // Company search returns a company
    mockCompanySearch.mockResolvedValue({
      results: [{
        id: "comp1",
        properties: { name: "Acme Solar", address: "500 Corp Blvd" },
      }],
      paging: null,
    });

    // Company→contact associations
    mockAssociationRead.mockResolvedValue({
      results: [{
        _from: { id: "comp1" },
        to: [{ id: "c10" }, { id: "c11" }],
      }],
    });

    // Batch-read those contacts
    mockContactBatchRead.mockResolvedValue({
      results: [
        {
          id: "c10",
          properties: {
            firstname: "Charlie",
            lastname: "Brown",
            email: "charlie@acme.com",
            phone: null,
            address: "500 Corp Blvd",
            city: "Denver",
            state: "CO",
            zip: "80202",
            company: "Other Name",
          },
        },
        {
          id: "c11",
          properties: {
            firstname: "Lucy",
            lastname: "Van Pelt",
            email: "lucy@acme.com",
            phone: null,
            address: null,
            city: null,
            state: null,
            zip: null,
            company: null,
          },
        },
      ],
    });

    const result = await searchContacts("acme");
    expect(result.results).toHaveLength(2);

    // Company name from matched company should be used
    expect(result.results[0].companyName).toBe("Acme Solar");
    expect(result.results[1].companyName).toBe("Acme Solar");

    // Contact IDs should be correct
    expect(result.results.map(r => r.contactId).sort()).toEqual(["c10", "c11"]);
  });

  it("deduplicates contacts that appear in both contact and company search", async () => {
    // Contact search finds c1
    mockContactSearch.mockResolvedValue({
      results: [{
        id: "c1",
        properties: {
          firstname: "Dupe",
          lastname: "Person",
          email: "dupe@example.com",
          phone: null,
          address: null,
          city: null,
          state: null,
          zip: null,
          company: "MyCompany",
        },
      }],
      paging: null,
    });

    // Company search also finds company associated with c1
    mockCompanySearch.mockResolvedValue({
      results: [{
        id: "comp1",
        properties: { name: "MyCompany", address: null },
      }],
      paging: null,
    });

    mockAssociationRead.mockResolvedValue({
      results: [{ _from: { id: "comp1" }, to: [{ id: "c1" }] }],
    });

    mockContactBatchRead.mockResolvedValue({
      results: [{
        id: "c1",
        properties: {
          firstname: "Dupe",
          lastname: "Person",
          email: "dupe@example.com",
          phone: null,
          address: null,
          city: null,
          state: null,
          zip: null,
          company: "MyCompany",
        },
      }],
    });

    const result = await searchContacts("dupe");
    // Should only appear once
    expect(result.results).toHaveLength(1);
    expect(result.results[0].contactId).toBe("c1");
  });

  it("sets truncated when paging present", async () => {
    mockContactSearch.mockResolvedValue({
      results: [{
        id: "c1",
        properties: {
          firstname: "A", lastname: "B",
          email: null, phone: null,
          address: null, city: null, state: null, zip: null,
          company: null,
        },
      }],
      paging: { next: { after: "25" } },
    });

    const result = await searchContacts("test");
    expect(result.truncated).toBe(true);
  });

  it("returns empty results for no matches", async () => {
    const result = await searchContacts("nonexistent");
    expect(result.results).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it("handles search API errors gracefully (returns partial results)", async () => {
    // Contact search fails
    mockContactSearch.mockRejectedValue(new Error("API down"));

    // Company search succeeds
    mockCompanySearch.mockResolvedValue({
      results: [{
        id: "comp1",
        properties: { name: "Fallback Corp", address: null },
      }],
      paging: null,
    });

    mockAssociationRead.mockResolvedValue({
      results: [{ _from: { id: "comp1" }, to: [{ id: "c50" }] }],
    });

    mockContactBatchRead.mockResolvedValue({
      results: [{
        id: "c50",
        properties: {
          firstname: "Partial",
          lastname: "Result",
          email: null, phone: null,
          address: null, city: null, state: null, zip: null,
          company: null,
        },
      }],
    });

    const result = await searchContacts("test");
    // Should still return company-sourced contacts
    expect(result.results).toHaveLength(1);
    expect(result.results[0].contactId).toBe("c50");
  });
});

// ---------------------------------------------------------------------------
// resolveContactDetail
// ---------------------------------------------------------------------------

describe("resolveContactDetail", () => {
  it("returns full detail with deals, tickets, and jobs", async () => {
    // Contact properties
    mockContactBatchRead.mockResolvedValue({
      results: [{
        id: "c1",
        properties: {
          firstname: "John",
          lastname: "Smith",
          email: "john@example.com",
          phone: "555-1234",
          address: "123 Main St",
          city: "Denver",
          state: "CO",
          zip: "80202",
          company: "Acme",
        },
      }],
    });

    // Contact→deal associations
    mockAssociationRead
      .mockResolvedValueOnce({
        results: [{
          to: [{ id: "d1" }, { id: "d2" }],
        }],
      })
      // Contact→ticket associations
      .mockResolvedValueOnce({
        results: [{
          to: [{ id: "t1" }],
        }],
      });

    // Deal batch read
    mockDealBatchRead.mockResolvedValue({
      results: [
        {
          id: "d1",
          properties: {
            dealname: "Solar Install",
            dealstage: "closedwon",
            pipeline: "default",
            amount: "25000",
            pb_location: "Denver",
            closedate: "2026-01-15",
            hs_lastmodifieddate: "2026-03-10T10:00:00Z",
          },
        },
        {
          id: "d2",
          properties: {
            dealname: "Battery Addon",
            dealstage: "contractsent",
            pipeline: "default",
            amount: "8000",
            pb_location: null,
            closedate: null,
            hs_lastmodifieddate: "2026-03-15T10:00:00Z",
          },
        },
      ],
    });

    // Ticket batch read
    mockTicketBatchRead.mockResolvedValue({
      results: [{
        id: "t1",
        properties: {
          subject: "Inverter Issue",
          hs_pipeline_stage: "open",
          hs_ticket_priority: "HIGH",
          createdate: "2026-03-01T00:00:00Z",
          hs_lastmodifieddate: "2026-03-12T00:00:00Z",
        },
      }],
    });

    // Zuper jobs — deal-linked
    mockGetZuperJobs.mockResolvedValue([{
      jobUid: "j1",
      jobTitle: "Site Survey",
      jobCategory: "Site Survey",
      jobStatus: "COMPLETED",
      scheduledStart: new Date("2026-01-10T09:00:00Z"),
      lastSyncedAt: new Date("2026-03-10T00:00:00Z"),
    }]);

    const detail = await resolveContactDetail("c1");

    expect(detail.contactId).toBe("c1");
    expect(detail.firstName).toBe("John");
    expect(detail.lastName).toBe("Smith");
    expect(detail.email).toBe("john@example.com");
    expect(detail.address).toBe("123 Main St, Denver, CO, 80202");
    expect(detail.companyName).toBe("Acme");

    // Deals sorted by lastModified DESC
    expect(detail.deals).toHaveLength(2);
    expect(detail.deals[0].id).toBe("d2"); // more recent
    expect(detail.deals[1].id).toBe("d1");
    expect(detail.deals[0].name).toBe("Battery Addon");
    expect(detail.deals[1].amount).toBe("25000");

    // Tickets
    expect(detail.tickets).toHaveLength(1);
    expect(detail.tickets[0].subject).toBe("Inverter Issue");
    expect(detail.tickets[0].priority).toBe("HIGH");

    // Jobs — only deal-linked (heuristic skipped when deal-linked found results)
    expect(detail.jobs).toHaveLength(1);
    expect(detail.jobs[0].uid).toBe("j1");
    expect(mockPrismaFindMany).not.toHaveBeenCalled();
  });

  it("returns empty arrays when no associations exist", async () => {
    mockContactBatchRead.mockResolvedValue({
      results: [{
        id: "c99",
        properties: {
          firstname: "Lonely",
          lastname: "Contact",
          email: null, phone: null,
          address: null, city: null, state: null, zip: null,
          company: null,
        },
      }],
    });

    // No associations
    mockAssociationRead.mockResolvedValue({ results: [] });

    const detail = await resolveContactDetail("c99");

    expect(detail.contactId).toBe("c99");
    expect(detail.firstName).toBe("Lonely");
    expect(detail.deals).toEqual([]);
    expect(detail.tickets).toEqual([]);
    expect(detail.jobs).toEqual([]);
  });

  it("handles association API errors gracefully", async () => {
    mockContactBatchRead.mockResolvedValue({
      results: [{
        id: "c1",
        properties: {
          firstname: "Error",
          lastname: "Test",
          email: null, phone: null,
          address: null, city: null, state: null, zip: null,
          company: null,
        },
      }],
    });

    // Association calls fail
    mockAssociationRead.mockRejectedValue(new Error("Association API down"));

    const detail = await resolveContactDetail("c1");

    // Should still return contact info with empty arrays
    expect(detail.contactId).toBe("c1");
    expect(detail.firstName).toBe("Error");
    expect(detail.deals).toEqual([]);
    expect(detail.tickets).toEqual([]);
    expect(detail.jobs).toEqual([]);
  });

  it("uses name/address heuristic only when no deal-linked jobs exist", async () => {
    mockContactBatchRead.mockResolvedValue({
      results: [{
        id: "c1",
        properties: {
          firstname: "John",
          lastname: "Smith",
          email: null, phone: null,
          address: "123 Main St", city: null, state: null, zip: null,
          company: null,
        },
      }],
    });

    // No deals, no tickets, no company
    mockAssociationRead
      .mockResolvedValueOnce({ results: [] })  // deals
      .mockResolvedValueOnce({ results: [] })  // tickets
      .mockResolvedValueOnce({ results: [] }); // companies

    // No deal-linked jobs (empty dealIds)
    mockGetZuperJobs.mockResolvedValue([]);

    // Heuristic finds a job by name+address
    mockPrismaFindMany.mockResolvedValue([{
      jobUid: "j-heuristic",
      jobTitle: "Heuristic Job",
      jobCategory: "Construction",
      jobStatus: "STARTED",
      scheduledStart: new Date("2026-02-01T09:00:00Z"),
      lastSyncedAt: new Date("2026-03-01T00:00:00Z"),
    }]);

    const detail = await resolveContactDetail("c1");
    expect(detail.jobs).toHaveLength(1);
    expect(detail.jobs[0].uid).toBe("j-heuristic");
    expect(mockPrismaFindMany).toHaveBeenCalled();
  });

  it("resolves company name via association when contact company property is blank", async () => {
    mockContactBatchRead.mockResolvedValue({
      results: [{
        id: "c1",
        properties: {
          firstname: "Jane",
          lastname: "Doe",
          email: null, phone: null,
          address: null, city: null, state: null, zip: null,
          company: null, // blank — triggers association lookup
        },
      }],
    });

    // deals, tickets, then companies association
    mockAssociationRead
      .mockResolvedValueOnce({ results: [] })  // deals
      .mockResolvedValueOnce({ results: [] })  // tickets
      .mockResolvedValueOnce({                 // companies
        results: [{ to: [{ id: "comp1" }] }],
      });

    // Company batch read returns the name
    mockCompanyBatchRead.mockResolvedValue({
      results: [{ id: "comp1", properties: { name: "Photon Brothers" } }],
    });

    const detail = await resolveContactDetail("c1");
    expect(detail.companyName).toBe("Photon Brothers");
  });

  it("uses AND for heuristic when both name and address are present", async () => {
    mockContactBatchRead.mockResolvedValue({
      results: [{
        id: "c1",
        properties: {
          firstname: "John",
          lastname: "Smith",
          email: null, phone: null,
          address: "123 Main St", city: null, state: null, zip: null,
          company: "Acme",
        },
      }],
    });

    // No deals, no tickets
    mockAssociationRead
      .mockResolvedValueOnce({ results: [] })
      .mockResolvedValueOnce({ results: [] });

    // No deal-linked jobs → triggers heuristic
    mockGetZuperJobs.mockResolvedValue([]);
    mockPrismaFindMany.mockResolvedValue([]);

    await resolveContactDetail("c1");

    // Verify the heuristic used AND (both name and address)
    expect(mockPrismaFindMany).toHaveBeenCalledWith({
      where: {
        AND: [
          { projectName: { contains: "John Smith", mode: "insensitive" } },
          { customerAddress: { path: ["street"], string_contains: "123 Main St" } },
        ],
      },
    });
  });

  it("surfaces linked Properties with per-link ownership and open ticket counts", async () => {
    mockContactBatchRead.mockResolvedValue({
      results: [{
        id: "c1",
        properties: {
          firstname: "Multi",
          lastname: "Property",
          email: null, phone: null,
          address: null, city: null, state: null, zip: null,
          company: null,
        },
      }],
    });

    mockAssociationRead.mockResolvedValue({ results: [] });

    // Two property links, most-recent first (orderBy associatedAt desc)
    mockPropertyContactLinkFindMany.mockResolvedValue([
      {
        contactId: "c1",
        propertyId: "prop-current",
        label: "Current Owner",
        associatedAt: new Date("2026-02-01T00:00:00Z"),
        property: {
          id: "prop-current",
          hubspotObjectId: "hs-current",
          fullAddress: "100 Current St, Denver, CO 80202",
          latitude: 39.74,
          longitude: -104.99,
          pbLocation: "Denver",
          ahjName: "Denver",
          utilityName: "Xcel",
          firstInstallDate: new Date("2025-06-01T00:00:00Z"),
          mostRecentInstallDate: new Date("2025-06-01T00:00:00Z"),
          systemSizeKwDc: 8.5,
          hasBattery: true,
          hasEvCharger: false,
          openTicketsCount: 2,
          lastServiceDate: new Date("2026-01-15T00:00:00Z"),
          earliestWarrantyExpiry: new Date("2035-06-01T00:00:00Z"),
          createdAt: new Date("2025-05-01T00:00:00Z"),
          dealLinks: [{ dealId: "d-current" }],
          ticketLinks: [{ ticketId: "t1" }, { ticketId: "t2" }],
          contactLinks: [{ contactId: "c1", label: "Current Owner", associatedAt: new Date("2026-02-01T00:00:00Z") }],
        },
      },
      {
        contactId: "c1",
        propertyId: "prop-previous",
        label: "Previous Owner",
        associatedAt: new Date("2026-01-01T00:00:00Z"),
        property: {
          id: "prop-previous",
          hubspotObjectId: "hs-previous",
          fullAddress: "200 Previous Ave, Boulder, CO 80301",
          latitude: 40.01,
          longitude: -105.27,
          pbLocation: "Boulder",
          ahjName: "Boulder",
          utilityName: "Xcel",
          firstInstallDate: null,
          mostRecentInstallDate: null,
          systemSizeKwDc: null,
          hasBattery: false,
          hasEvCharger: false,
          openTicketsCount: 0,
          lastServiceDate: null,
          earliestWarrantyExpiry: null,
          createdAt: new Date("2024-01-01T00:00:00Z"),
          dealLinks: [],
          ticketLinks: [],
          contactLinks: [{ contactId: "c1", label: "Previous Owner", associatedAt: new Date("2026-01-01T00:00:00Z") }],
        },
      },
    ]);

    mockComputeEquipmentSummary.mockResolvedValue({
      modules: { count: 20, totalWattage: 8000 },
      inverters: { count: 1 },
      batteries: { count: 1, totalKwh: 13.5 },
      evChargers: { count: 0 },
    });

    const detail = await resolveContactDetail("c1");

    expect(detail.properties).toHaveLength(2);

    // Most recent first
    expect(detail.properties[0].ownershipLabel).toBe("Current Owner");
    expect(detail.properties[0].openTicketsCount).toBe(2);
    expect(detail.properties[0].hubspotObjectId).toBe("hs-current");
    expect(detail.properties[0].dealIds).toEqual(["d-current"]);

    expect(detail.properties[1].ownershipLabel).toBe("Previous Owner");
    expect(detail.properties[1].openTicketsCount).toBe(0);
    expect(detail.properties[1].hubspotObjectId).toBe("hs-previous");

    // Called once per property
    expect(mockComputeEquipmentSummary).toHaveBeenCalledTimes(2);

    // Verify the prisma query shape
    expect(mockPropertyContactLinkFindMany).toHaveBeenCalledWith({
      where: { contactId: "c1" },
      include: {
        property: {
          include: {
            dealLinks: true,
            ticketLinks: true,
            contactLinks: true,
          },
        },
      },
      orderBy: { associatedAt: "desc" },
    });
  });

  it("returns properties: [] when the Property lookup fails", async () => {
    mockContactBatchRead.mockResolvedValue({
      results: [{
        id: "c1",
        properties: {
          firstname: "Err",
          lastname: "Test",
          email: null, phone: null,
          address: null, city: null, state: null, zip: null,
          company: null,
        },
      }],
    });
    mockAssociationRead.mockResolvedValue({ results: [] });
    mockPropertyContactLinkFindMany.mockRejectedValue(new Error("DB down"));

    const detail = await resolveContactDetail("c1");
    expect(detail.properties).toEqual([]);
  });
});
