import { writeCrossLinkIds } from "@/lib/catalog-cross-link";
import * as zoho from "@/lib/zoho-inventory";
import * as zuper from "@/lib/zuper-catalog";

jest.mock("@/lib/zoho-inventory", () => ({
  zohoInventory: { updateItem: jest.fn().mockResolvedValue({ status: "updated" }) },
}));
jest.mock("@/lib/zuper-catalog", () => ({
  buildZuperProductCustomFields: jest.requireActual("@/lib/zuper-catalog").buildZuperProductCustomFields,
  updateZuperPart: jest.fn().mockResolvedValue({ status: "updated" }),
}));
global.fetch = jest.fn(() => Promise.resolve({ ok: true } as Response));
process.env.HUBSPOT_ACCESS_TOKEN = "test_token";

describe("writeCrossLinkIds", () => {
  beforeEach(() => jest.clearAllMocks());

  test("writes cf_* fields to Zoho when other systems present", async () => {
    await writeCrossLinkIds({
      zohoItemId: "z_1",
      zuperItemId: "zu_1",
      hubspotProductId: "hs_1",
      internalProductId: "p_1",
    });
    expect(zoho.zohoInventory.updateItem).toHaveBeenCalledWith("z_1", {
      custom_fields: expect.arrayContaining([
        expect.objectContaining({ api_name: "cf_zuper_product_id", value: "zu_1" }),
        expect.objectContaining({ api_name: "cf_hubspot_product_id", value: "hs_1" }),
        expect.objectContaining({ api_name: "cf_internal_product_id", value: "p_1" }),
      ]),
    });
  });

  test("writes properties to HubSpot Product when other systems present", async () => {
    await writeCrossLinkIds({
      zohoItemId: "z_1", zuperItemId: "zu_1",
      hubspotProductId: "hs_1", internalProductId: "p_1",
    });
    const fetchCall = (global.fetch as jest.Mock).mock.calls.find((c) =>
      c[0].includes("/products/hs_1"),
    );
    expect(fetchCall).toBeDefined();
    const body = JSON.parse(fetchCall[1].body);
    expect(body.properties).toMatchObject({
      zuper_item_id: "zu_1",
      zoho_item_id: "z_1",
      internal_product_id: "p_1",
    });
  });

  test("no-ops when only one system has an ID", async () => {
    const result = await writeCrossLinkIds({
      hubspotProductId: "hs_1",
      // zoho/zuper/internal all missing
    });
    expect(result.warnings).toEqual([]);
    expect(zoho.zohoInventory.updateItem).not.toHaveBeenCalled();
    expect(zuper.updateZuperPart).not.toHaveBeenCalled();
  });

  test("returns warnings when individual system updates fail without throwing", async () => {
    (zoho.zohoInventory.updateItem as jest.Mock).mockResolvedValueOnce({
      status: "failed", message: "503",
    });
    const result = await writeCrossLinkIds({
      zohoItemId: "z_1", hubspotProductId: "hs_1", internalProductId: "p_1",
    });
    expect(result.warnings.some((w) => w.includes("Zoho"))).toBe(true);
  });
});
