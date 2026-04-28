import { getStageEnteredAt } from "@/lib/pm-tracker/stage-entry";

describe("pm-tracker/rescue", () => {
  describe("getStageEnteredAt", () => {
    const stageId = "abc123";

    it("returns Date when raw property is set", () => {
      const ts = "2026-04-01T00:00:00Z";
      const result = getStageEnteredAt({ [`hs_date_entered_${stageId}`]: ts }, stageId);
      expect(result).toBeInstanceOf(Date);
      expect(result?.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    });

    it("returns null when raw is missing", () => {
      expect(getStageEnteredAt({}, stageId)).toBeNull();
      expect(getStageEnteredAt(null, stageId)).toBeNull();
      expect(getStageEnteredAt(undefined, stageId)).toBeNull();
    });

    it("returns null for unparseable date", () => {
      expect(
        getStageEnteredAt({ [`hs_date_entered_${stageId}`]: "not-a-date" }, stageId),
      ).toBeNull();
    });

    it("returns null when the wrong stage ID is queried", () => {
      const ts = "2026-04-01T00:00:00Z";
      const props = { hs_date_entered_xyz: ts };
      expect(getStageEnteredAt(props, "abc123")).toBeNull();
    });

    it("handles non-object input gracefully", () => {
      expect(getStageEnteredAt("string", stageId)).toBeNull();
      expect(getStageEnteredAt(42, stageId)).toBeNull();
      expect(getStageEnteredAt([], stageId)).toBeNull();
    });
  });
});
