import { zohoInventory } from "@/lib/zoho-inventory";

const mockRequestPost = jest.fn();
jest.spyOn(zohoInventory as unknown as { requestPost: unknown }, "requestPost")
  .mockImplementation(mockRequestPost);

describe("createContact", () => {
  beforeEach(() => jest.clearAllMocks());

  it("creates a customer contact and returns contact_id", async () => {
    mockRequestPost.mockResolvedValue({
      code: 0,
      contact: { contact_id: "zc-123", contact_name: "Acme Corp" },
    });

    const result = await zohoInventory.createContact({
      contact_name: "Acme Corp",
      email: "info@acme.com",
      contact_type: "customer",
    });

    expect(result).toEqual({ contact_id: "zc-123" });
    expect(mockRequestPost).toHaveBeenCalledWith("/contacts", {
      contact_name: "Acme Corp",
      email: "info@acme.com",
      contact_type: "customer",
    });
  });

  it("throws when Zoho returns no contact_id", async () => {
    mockRequestPost.mockResolvedValue({ code: 1, message: "Invalid data" });
    await expect(
      zohoInventory.createContact({
        contact_name: "Bad Corp",
        contact_type: "customer",
      })
    ).rejects.toThrow("Zoho did not return a contact ID");
  });
});
