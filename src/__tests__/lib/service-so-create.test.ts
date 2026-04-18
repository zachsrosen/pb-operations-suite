jest.mock("@/lib/zoho-inventory", () => ({
  zohoInventory: {
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
      deals: { batchApi: { read: jest.fn() } },
    },
  },
}));

jest.mock("@/lib/bom-customer-resolve", () => ({
  resolveCustomer: jest.fn(),
}));

import { createServiceSo, type CreateServiceSoInput } from "@/lib/service-so-create";
import { zohoInventory } from "@/lib/zoho-inventory";
import { prisma } from "@/lib/db";
import { hubspotClient } from "@/lib/hubspot";
import { resolveCustomer } from "@/lib/bom-customer-resolve";

const mockProductFind = (prisma as any).internalProduct.findMany as jest.Mock;
const mockSoCreate = (prisma as any).serviceSoRequest.create as jest.Mock;
const mockSoFindUnique = (prisma as any).serviceSoRequest.findUnique as jest.Mock;
const mockSoUpdate = (prisma as any).serviceSoRequest.update as jest.Mock;
const mockSoDelete = (prisma as any).serviceSoRequest.delete as jest.Mock;
const mockAssocRead = (hubspotClient as any).crm.associations.batchApi.read as jest.Mock;
const mockDealRead = (hubspotClient as any).crm.deals.batchApi.read as jest.Mock;
const mockCreateSo = zohoInventory.createSalesOrder as jest.Mock;
const mockResolveCustomer = resolveCustomer as jest.Mock;

describe("createServiceSo", () => {
  const baseInput: CreateServiceSoInput = {
    dealId: "deal-1",
    requestToken: "tok-abc",
    items: [{ productId: "prod-1", quantity: 2 }],
    createdBy: "user@example.com",
  };

  // Mock helper: set up deal batch read (server-side deal name/address resolution)
  const mockDealBatchRead = (overrides: Partial<Record<string, string>> = {}) => {
    mockDealRead.mockResolvedValueOnce({
      results: [{
        id: "deal-1",
        properties: {
          dealname: "PROJ-1234 | Smith, John | 123 Main St",
          address_line_1: "123 Main St",
          city: "Denver",
          state: "CO",
          postal_code: "80202",
          ...overrides,
        },
      }],
    });
  };

  // Mock helper: set up deal → contact association
  const mockDealContactAssoc = (contactId: string = "cont-1") => {
    mockAssocRead.mockResolvedValueOnce({
      results: [{ _from: { id: "deal-1" }, to: [{ id: contactId }] }],
    });
  };

  // Mock helper: set up successful customer resolution (same as BOM pipeline)
  const mockCustomerResolution = (customerId: string = "zc-acme") => {
    mockResolveCustomer.mockResolvedValueOnce({
      customerId,
      customerName: "Smith, John",
      matchMethod: "deal_name_full",
      searchAttempts: [],
    });
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
    mockSoFindUnique.mockResolvedValueOnce({
      id: "req-old",
      status: "FAILED",
      requestToken: "tok-abc",
    });
    mockSoDelete.mockResolvedValueOnce({});
    mockSoCreate.mockResolvedValueOnce({ id: "req-new" });
    mockProductFind.mockResolvedValueOnce([{
      id: "prod-1", name: "Widget", sku: "W-1", description: null,
      sellPrice: 50, category: "SERVICE", isActive: true, zohoItemId: "zi-1",
    }]);
    mockDealBatchRead();
    mockDealContactAssoc();
    mockCustomerResolution();
    mockSoUpdate.mockResolvedValue({});
    mockCreateSo.mockResolvedValueOnce({ salesorder_id: "zso-new", salesorder_number: "SO-099" });

    const result = await createServiceSo(baseInput);
    expect(result.zohoSoId).toBe("zso-new");
    expect(mockSoDelete).toHaveBeenCalled();
  });

  it("rejects when product is not SERVICE category (no DRAFT created)", async () => {
    mockSoFindUnique.mockResolvedValueOnce(null);
    mockProductFind.mockResolvedValueOnce([{
      id: "prod-1", name: "Solar Panel", category: "MODULE", isActive: true,
      sku: null, description: null, sellPrice: 500, zohoItemId: null,
    }]);

    await expect(createServiceSo(baseInput)).rejects.toThrow(/not valid SERVICE products/);
    expect(mockSoCreate).not.toHaveBeenCalled();
  });

  it("rejects when Zoho customer cannot be resolved", async () => {
    mockSoFindUnique.mockResolvedValueOnce(null);
    mockProductFind.mockResolvedValueOnce([{
      id: "prod-1", name: "Widget", category: "SERVICE", isActive: true,
      sku: null, description: null, sellPrice: 50, zohoItemId: null,
    }]);
    mockSoCreate.mockResolvedValueOnce({ id: "req-4" });
    mockDealBatchRead();
    mockDealContactAssoc();
    // Customer resolution fails (no match)
    mockResolveCustomer.mockResolvedValueOnce({
      customerId: null,
      customerName: null,
      matchMethod: "none",
      searchAttempts: ["deal_name_full → 0 matches"],
    });

    await expect(createServiceSo(baseInput)).rejects.toThrow(/Could not resolve Zoho customer/);
  });

  it("uses shared resolveCustomer with deal name and primary contact ID", async () => {
    mockSoFindUnique.mockResolvedValueOnce(null);
    mockProductFind.mockResolvedValueOnce([{
      id: "prod-1", name: "Widget", category: "SERVICE", isActive: true,
      sku: null, description: null, sellPrice: 50, zohoItemId: "zi-1",
    }]);
    mockSoCreate.mockResolvedValueOnce({ id: "req-5" });
    mockDealBatchRead();
    mockDealContactAssoc("cont-99");
    mockCustomerResolution("zc-smith");
    mockSoUpdate.mockResolvedValue({});
    mockCreateSo.mockResolvedValueOnce({ salesorder_id: "zso-5", salesorder_number: "SO-005" });

    await createServiceSo(baseInput);

    // Verify resolveCustomer was called with deal name and primary contact ID
    expect(mockResolveCustomer).toHaveBeenCalledWith({
      dealName: "PROJ-1234 | Smith, John | 123 Main St",
      primaryContactId: "cont-99",
      dealAddress: "123 Main St, Denver, CO, 80202",
    });
  });

  describe("SO number + reference number", () => {
    const setupHappyPath = () => {
      mockSoFindUnique.mockResolvedValueOnce(null);
      mockProductFind.mockResolvedValueOnce([{
        id: "prod-1", name: "Widget", category: "SERVICE", isActive: true,
        sku: null, description: null, sellPrice: 50, zohoItemId: "zi-1", brand: "B", model: "M",
      }]);
      mockSoCreate.mockResolvedValueOnce({ id: "req-ref" });
      mockDealContactAssoc();
      mockCustomerResolution();
      mockSoUpdate.mockResolvedValue({});
      mockCreateSo.mockResolvedValueOnce({ salesorder_id: "zso-ref", salesorder_number: "ignored" });
    };

    it("project-pipeline deal: SO-{projNumber} + first-two-segment ref", async () => {
      setupHappyPath();
      mockDealBatchRead({ dealname: "PROJ-1234 | Smith, John | 123 Main St" });

      await createServiceSo(baseInput);

      const call = mockCreateSo.mock.calls[0][0];
      expect(call.salesorder_number).toBe("SO-1234");
      expect(call.reference_number).toBe("PROJ-1234 | Smith, John");
    });

    it("SVC-prefixed service deal: SO-{projNumber} + prefix preserved in ref", async () => {
      setupHappyPath();
      mockDealBatchRead({ dealname: "SVC | PROJ-8964 | McElheron | 456 Oak Ave" });

      await createServiceSo(baseInput);

      const call = mockCreateSo.mock.calls[0][0];
      expect(call.salesorder_number).toBe("SO-8964");
      expect(call.reference_number).toBe("SVC | PROJ-8964 | McElheron");
    });

    it("dealname without PROJ-XXXX: falls back to project_number HubSpot property", async () => {
      setupHappyPath();
      mockDealBatchRead({
        dealname: "SVC | McElheron | 456 Oak Ave",
        project_number: "8964",
      });

      await createServiceSo(baseInput);

      const call = mockCreateSo.mock.calls[0][0];
      expect(call.salesorder_number).toBe("SO-8964");
    });

    it("strips leading PROJ- prefix on project_number property", async () => {
      setupHappyPath();
      mockDealBatchRead({
        dealname: "SVC | McElheron | 456 Oak Ave",
        project_number: "PROJ-8964",
      });

      await createServiceSo(baseInput);

      const call = mockCreateSo.mock.calls[0][0];
      expect(call.salesorder_number).toBe("SO-8964");
    });

    it("hard-fails when neither dealname nor project_number carries a project number", async () => {
      mockSoFindUnique.mockResolvedValueOnce(null);
      mockProductFind.mockResolvedValueOnce([{
        id: "prod-1", name: "Widget", category: "SERVICE", isActive: true,
        sku: null, description: null, sellPrice: 50, zohoItemId: "zi-1", brand: "B", model: "M",
      }]);
      mockSoCreate.mockResolvedValueOnce({ id: "req-fail" });
      mockDealBatchRead({ dealname: "Service Call - McElheron", project_number: "" });
      mockDealContactAssoc();
      mockCustomerResolution();
      mockSoUpdate.mockResolvedValue({});

      await expect(createServiceSo(baseInput)).rejects.toThrow(/no PROJ-XXXX in dealname/);
      expect(mockCreateSo).not.toHaveBeenCalled();
    });
  });
});
