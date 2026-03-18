jest.mock("@/lib/zoho-inventory", () => ({
  zohoInventory: {
    fetchCustomerPage: jest.fn(),
    createContact: jest.fn(),
    createSalesOrder: jest.fn(),
  },
}));

jest.mock("@sentry/nextjs", () => ({
  captureException: jest.fn(),
}));

jest.mock("@/lib/db", () => ({
  prisma: {
    internalProduct: { findMany: jest.fn() },
    serviceSoRequest: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

jest.mock("@/lib/hubspot", () => ({
  hubspotClient: {
    crm: {
      associations: { batchApi: { read: jest.fn() } },
      companies: { batchApi: { read: jest.fn() } },
      contacts: { batchApi: { read: jest.fn() } },
    },
  },
}));

import { resolveZohoCustomer, createServiceSo, type CreateServiceSoInput } from "@/lib/service-so-create";
import { zohoInventory } from "@/lib/zoho-inventory";
import { prisma } from "@/lib/db";
import { hubspotClient } from "@/lib/hubspot";

const mockFetchPage = zohoInventory.fetchCustomerPage as jest.Mock;
const mockCreateContact = zohoInventory.createContact as jest.Mock;

const mockProductFind = (prisma as any).internalProduct.findMany as jest.Mock;
const mockSoCreate = (prisma as any).serviceSoRequest.create as jest.Mock;
const mockSoFindUnique = (prisma as any).serviceSoRequest.findUnique as jest.Mock;
const mockSoUpdate = (prisma as any).serviceSoRequest.update as jest.Mock;
const mockSoDelete = (prisma as any).serviceSoRequest.delete as jest.Mock;
const mockAssocRead = (hubspotClient as any).crm.associations.batchApi.read as jest.Mock;
const mockCompanyRead = (hubspotClient as any).crm.companies.batchApi.read as jest.Mock;
const mockContactRead = (hubspotClient as any).crm.contacts.batchApi.read as jest.Mock;

const mockCreateSo = zohoInventory.createSalesOrder as jest.Mock;

describe("resolveZohoCustomer", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns customer_id when exact name match found on page 1", async () => {
    mockFetchPage.mockResolvedValueOnce({
      contacts: [
        { contact_id: "zc-1", contact_name: "Acme Corp" },
        { contact_id: "zc-2", contact_name: "Beta Inc" },
      ],
      hasMore: false,
    });

    const result = await resolveZohoCustomer("Acme Corp", "info@acme.com");
    expect(result).toBe("zc-1");
    expect(mockFetchPage).toHaveBeenCalledTimes(1);
  });

  it("paginates up to 5 pages to find a match", async () => {
    for (let i = 0; i < 4; i++) {
      mockFetchPage.mockResolvedValueOnce({ contacts: [{ contact_id: `zc-${i}`, contact_name: `Other ${i}` }], hasMore: true });
    }
    mockFetchPage.mockResolvedValueOnce({
      contacts: [{ contact_id: "zc-found", contact_name: "Target Co" }],
      hasMore: false,
    });

    const result = await resolveZohoCustomer("Target Co");
    expect(result).toBe("zc-found");
    expect(mockFetchPage).toHaveBeenCalledTimes(5);
  });

  it("creates customer when no match found within 5 pages", async () => {
    for (let i = 0; i < 5; i++) {
      mockFetchPage.mockResolvedValueOnce({ contacts: [{ contact_id: `zc-${i}`, contact_name: `Other ${i}` }], hasMore: true });
    }
    mockCreateContact.mockResolvedValueOnce({ contact_id: "zc-new" });

    const result = await resolveZohoCustomer("NewCo", "admin@newco.com");
    expect(result).toBe("zc-new");
    expect(mockCreateContact).toHaveBeenCalledWith({
      contact_name: "NewCo",
      email: "admin@newco.com",
      contact_type: "customer",
    });
  });

  it("uses first match and logs warning when multiple matches exist", async () => {
    const consoleSpy = jest.spyOn(console, "warn").mockImplementation();
    mockFetchPage.mockResolvedValueOnce({
      contacts: [
        { contact_id: "zc-a", contact_name: "Dupes Inc" },
        { contact_id: "zc-b", contact_name: "Dupes Inc" },
      ],
      hasMore: false,
    });

    const result = await resolveZohoCustomer("Dupes Inc");
    expect(result).toBe("zc-a");
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Multiple Zoho customers matched")
    );
    consoleSpy.mockRestore();
  });
});

describe("createServiceSo", () => {
  const baseInput: CreateServiceSoInput = {
    dealId: "deal-1",
    dealName: "Test Service Deal",
    dealAddress: "123 Main St, Denver, CO 80202",
    requestToken: "tok-abc",
    items: [{ productId: "prod-1", quantity: 2 }],
    createdBy: "user@example.com",
  };

  beforeEach(() => jest.clearAllMocks());

  it("returns existing result on idempotency hit (SUBMITTED)", async () => {
    mockSoFindUnique.mockResolvedValueOnce({
      id: "req-1",
      zohoSoId: "zso-1",
      zohoSoNumber: "SO-001",
      zohoCustomerId: "zc-1",
      lineItems: [{ productId: "prod-1", name: "Widget", sku: "W-1", description: null, quantity: 2, unitPrice: 50 }],
      totalAmount: 100,
      status: "SUBMITTED",
    });

    const result = await createServiceSo(baseInput);
    expect(result.alreadyExisted).toBe(true);
    expect(result.zohoSoId).toBe("zso-1");
    expect(mockCreateSo).not.toHaveBeenCalled();
  });

  it("allows retry on FAILED idempotency hit", async () => {
    // First findUnique returns FAILED record
    mockSoFindUnique.mockResolvedValueOnce({
      id: "req-old",
      status: "FAILED",
      requestToken: "tok-abc",
    });
    // Delete the failed record
    mockSoDelete.mockResolvedValueOnce({});
    // Create new DRAFT
    mockSoCreate.mockResolvedValueOnce({ id: "req-new" });
    // Products
    mockProductFind.mockResolvedValueOnce([{
      id: "prod-1", name: "Widget", sku: "W-1", description: null,
      sellPrice: 50, category: "SERVICE", isActive: true, zohoItemId: "zi-1",
    }]);
    // HubSpot company
    mockAssocRead.mockResolvedValueOnce({
      results: [{ _from: { id: "deal-1" }, to: [{ id: "comp-1" }] }],
    });
    mockCompanyRead.mockResolvedValueOnce({
      results: [{ id: "comp-1", properties: { name: "Acme", domain: "acme.com" } }],
    });
    // Contact email
    mockAssocRead.mockResolvedValueOnce({
      results: [{ _from: { id: "deal-1" }, to: [{ id: "cont-1" }] }],
    });
    mockContactRead.mockResolvedValueOnce({
      results: [{ id: "cont-1", properties: { email: "info@acme.com" } }],
    });
    // Zoho customer
    (zohoInventory.fetchCustomerPage as jest.Mock).mockResolvedValueOnce({
      contacts: [{ contact_id: "zc-acme", contact_name: "Acme" }],
      hasMore: false,
    });
    // Update with resolved data
    mockSoUpdate.mockResolvedValue({});
    // Zoho SO
    mockCreateSo.mockResolvedValueOnce({ salesorder_id: "zso-new", salesorder_number: "SO-099" });

    const result = await createServiceSo(baseInput);
    expect(result.zohoSoId).toBe("zso-new");
    expect(mockSoDelete).toHaveBeenCalled();
  });

  it("rejects when product is not SERVICE category", async () => {
    mockSoFindUnique.mockResolvedValueOnce(null);
    mockSoCreate.mockResolvedValueOnce({ id: "req-3" });
    mockProductFind.mockResolvedValueOnce([{
      id: "prod-1", name: "Solar Panel", category: "MODULE", isActive: true,
      sku: null, description: null, sellPrice: 500, zohoItemId: null,
    }]);

    await expect(createServiceSo(baseInput)).rejects.toThrow(/not valid SERVICE products/);
  });

  it("rejects when deal has no company association", async () => {
    mockSoFindUnique.mockResolvedValueOnce(null);
    mockSoCreate.mockResolvedValueOnce({ id: "req-4" });
    mockProductFind.mockResolvedValueOnce([{
      id: "prod-1", name: "Widget", category: "SERVICE", isActive: true,
      sku: null, description: null, sellPrice: 50, zohoItemId: null,
    }]);
    mockAssocRead.mockResolvedValueOnce({ results: [] });

    await expect(createServiceSo(baseInput)).rejects.toThrow(/must have an associated company/);
  });
});
