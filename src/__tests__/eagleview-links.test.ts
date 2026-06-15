import { eagleViewLinks } from "@/lib/eagleview-links";

describe("eagleViewLinks", () => {
  it("builds TrueDesign + order-page URLs from a real RID", () => {
    expect(eagleViewLinks("71412250")).toEqual({
      trueDesign: "https://apps.eagleview.com/truedesign/71412250",
      orderPage: "https://apps.eagleview.com/myev/orders/report/71412250",
    });
  });

  it("returns null for null, undefined, empty, or pending reportIds", () => {
    expect(eagleViewLinks(null)).toBeNull();
    expect(eagleViewLinks(undefined)).toBeNull();
    expect(eagleViewLinks("")).toBeNull();
    expect(eagleViewLinks("pending:abc")).toBeNull();
  });
});
