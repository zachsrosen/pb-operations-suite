import { addressHash, normalizeAddressForHash } from "@/lib/address-hash";

describe("address-hash", () => {
  it("produces identical hash for equivalent inputs ignoring case and whitespace", () => {
    const a = addressHash({ street: "1234 Main St", unit: "#2", city: "Boulder", state: "CO", zip: "80301" });
    const b = addressHash({ street: "1234 MAIN ST ", unit: " #2", city: "boulder", state: "co", zip: "80301" });
    expect(a).toBe(b);
  });
  it("differs when zip differs", () => {
    const a = addressHash({ street: "1 A", unit: null, city: "X", state: "CA", zip: "90001" });
    const b = addressHash({ street: "1 A", unit: null, city: "X", state: "CA", zip: "90002" });
    expect(a).not.toBe(b);
  });
  it("differs when unit differs", () => {
    const a = addressHash({ street: "1 A", unit: "1", city: "X", state: "CA", zip: "90001" });
    const b = addressHash({ street: "1 A", unit: "2", city: "X", state: "CA", zip: "90001" });
    expect(a).not.toBe(b);
  });
  it("is 64 hex chars (SHA-256)", () => {
    expect(addressHash({ street: "1 A", unit: null, city: "X", state: "CA", zip: "90001" })).toMatch(/^[0-9a-f]{64}$/);
  });
  it("normalizeAddressForHash trims and lowercases components", () => {
    expect(normalizeAddressForHash({ street: " 1 A ", unit: null, city: "X", state: "ca", zip: "90001" }))
      .toBe("1 a||x|ca|90001");
  });
});
