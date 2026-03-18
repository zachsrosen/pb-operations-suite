jest.mock("@/lib/zoho-inventory", () => ({
  zohoInventory: {
    fetchCustomerPage: jest.fn(),
    createContact: jest.fn(),
  },
}));

jest.mock("@sentry/nextjs", () => ({
  captureException: jest.fn(),
}));

import { resolveZohoCustomer } from "@/lib/service-so-create";
import { zohoInventory } from "@/lib/zoho-inventory";

const mockFetchPage = zohoInventory.fetchCustomerPage as jest.Mock;
const mockCreateContact = zohoInventory.createContact as jest.Mock;

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
