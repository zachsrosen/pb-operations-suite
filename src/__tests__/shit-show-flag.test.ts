import { setShitShowFlag, readShitShowFlag, SHIT_SHOW_PROPS } from "@/lib/shit-show/hubspot-flag";

jest.mock("@/lib/hubspot", () => ({
  updateDealProperty: jest.fn(),
  getDealProperties: jest.fn(),
}));

import { updateDealProperty, getDealProperties } from "@/lib/hubspot";

const mockUpdate = updateDealProperty as jest.MockedFunction<typeof updateDealProperty>;
const mockGet = getDealProperties as jest.MockedFunction<typeof getDealProperties>;

describe("shit-show flag", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("setShitShowFlag(dealId, true, reason)", () => {
    it("sets all 3 properties when flag transitions false→true", async () => {
      mockGet.mockResolvedValue({
        pb_shit_show_flagged: "false",
        pb_shit_show_reason: null,
        pb_shit_show_flagged_since: null,
      });
      mockUpdate.mockResolvedValue(true);

      await setShitShowFlag("deal-123", true, "Customer angry");

      expect(mockUpdate).toHaveBeenCalledTimes(1);
      const [dealId, properties] = mockUpdate.mock.calls[0];
      expect(dealId).toBe("deal-123");
      expect(properties.pb_shit_show_flagged).toBe("true");
      expect(properties.pb_shit_show_reason).toBe("Customer angry");
      expect(properties.pb_shit_show_flagged_since).toMatch(/^\d{4}-\d{2}-\d{2}/);
    });

    it("does NOT update flagged_since when already true", async () => {
      mockGet.mockResolvedValue({
        pb_shit_show_flagged: "true",
        pb_shit_show_reason: "old reason",
        pb_shit_show_flagged_since: "2026-04-01",
      });
      mockUpdate.mockResolvedValue(true);

      await setShitShowFlag("deal-123", true, "new reason");

      const [, properties] = mockUpdate.mock.calls[0];
      expect(properties.pb_shit_show_reason).toBe("new reason");
      expect(properties.pb_shit_show_flagged_since).toBeUndefined();
    });
  });

  describe("setShitShowFlag(dealId, false)", () => {
    it("clears all 3 properties on resolve without reading first", async () => {
      mockUpdate.mockResolvedValue(true);

      await setShitShowFlag("deal-123", false);

      const [, properties] = mockUpdate.mock.calls[0];
      expect(properties.pb_shit_show_flagged).toBe("false");
      expect(properties.pb_shit_show_reason).toBe("");
      expect(properties.pb_shit_show_flagged_since).toBe("");
      expect(mockGet).not.toHaveBeenCalled();
    });
  });

  describe("readShitShowFlag(dealId)", () => {
    it("returns parsed shape", async () => {
      mockGet.mockResolvedValue({
        pb_shit_show_flagged: "true",
        pb_shit_show_reason: "Issue",
        pb_shit_show_flagged_since: "2026-04-15",
      });

      const result = await readShitShowFlag("deal-123");

      expect(result).toEqual({
        flagged: true,
        reason: "Issue",
        flaggedSince: new Date("2026-04-15"),
      });
    });

    it("treats missing/false properties as not flagged", async () => {
      mockGet.mockResolvedValue({
        pb_shit_show_flagged: "false",
        pb_shit_show_reason: null,
        pb_shit_show_flagged_since: null,
      });

      const result = await readShitShowFlag("deal-123");

      expect(result).toEqual({
        flagged: false,
        reason: null,
        flaggedSince: null,
      });
    });
  });

  it("exports the property names as constants", () => {
    expect(SHIT_SHOW_PROPS.FLAGGED).toBe("pb_shit_show_flagged");
    expect(SHIT_SHOW_PROPS.REASON).toBe("pb_shit_show_reason");
    expect(SHIT_SHOW_PROPS.FLAGGED_SINCE).toBe("pb_shit_show_flagged_since");
  });
});
