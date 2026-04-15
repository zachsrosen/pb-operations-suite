jest.mock("@/lib/db", () => ({ prisma: {} }));
jest.mock("@/lib/hubspot", () => ({ fetchLineItemsForDeals: jest.fn() }));

import { dedupeContactLinksByProperty } from "@/lib/property-detail";

type Link = {
  propertyId: string;
  label: string;
  associatedAt: Date;
  property: { id: string };
};

function link(propertyId: string, label: string, whenIso: string): Link {
  return {
    propertyId,
    label,
    associatedAt: new Date(whenIso),
    property: { id: propertyId },
  };
}

describe("dedupeContactLinksByProperty (F4)", () => {
  it("returns a single link per propertyId", () => {
    const links = [
      link("p1", "Current Owner", "2026-01-01T00:00:00Z"),
      link("p1", "Authorized Contact", "2026-02-01T00:00:00Z"),
      link("p2", "Tenant", "2026-03-01T00:00:00Z"),
    ];
    const result = dedupeContactLinksByProperty(links);
    expect(result).toHaveLength(2);
    expect(result.map((l) => l.propertyId).sort()).toEqual(["p1", "p2"]);
  });

  it("prefers Current Owner over Property Manager, Tenant, Authorized Contact, Previous Owner", () => {
    const links = [
      link("p1", "Previous Owner", "2026-03-01T00:00:00Z"),
      link("p1", "Authorized Contact", "2026-02-01T00:00:00Z"),
      link("p1", "Tenant", "2026-04-01T00:00:00Z"),
      link("p1", "Property Manager", "2026-05-01T00:00:00Z"),
      link("p1", "Current Owner", "2026-01-01T00:00:00Z"),
    ];
    const [only] = dedupeContactLinksByProperty(links);
    expect(only.label).toBe("Current Owner");
  });

  it("prefers Property Manager over Tenant, Authorized Contact, Previous Owner (no Current Owner)", () => {
    const links = [
      link("p1", "Previous Owner", "2026-05-01T00:00:00Z"),
      link("p1", "Authorized Contact", "2026-04-01T00:00:00Z"),
      link("p1", "Tenant", "2026-03-01T00:00:00Z"),
      link("p1", "Property Manager", "2026-01-01T00:00:00Z"),
    ];
    const [only] = dedupeContactLinksByProperty(links);
    expect(only.label).toBe("Property Manager");
  });

  it("prefers Tenant over Authorized Contact and Previous Owner", () => {
    const links = [
      link("p1", "Previous Owner", "2026-05-01T00:00:00Z"),
      link("p1", "Authorized Contact", "2026-04-01T00:00:00Z"),
      link("p1", "Tenant", "2026-01-01T00:00:00Z"),
    ];
    const [only] = dedupeContactLinksByProperty(links);
    expect(only.label).toBe("Tenant");
  });

  it("prefers Authorized Contact over Previous Owner", () => {
    const links = [
      link("p1", "Previous Owner", "2026-05-01T00:00:00Z"),
      link("p1", "Authorized Contact", "2026-01-01T00:00:00Z"),
    ];
    const [only] = dedupeContactLinksByProperty(links);
    expect(only.label).toBe("Authorized Contact");
  });

  it("within the same label, keeps the most-recently-associated row", () => {
    const older = link("p1", "Current Owner", "2020-01-01T00:00:00Z");
    const newer = link("p1", "Current Owner", "2026-06-01T00:00:00Z");
    // Input order should not matter.
    const result1 = dedupeContactLinksByProperty([older, newer]);
    const result2 = dedupeContactLinksByProperty([newer, older]);
    expect(result1[0].associatedAt.toISOString()).toBe(newer.associatedAt.toISOString());
    expect(result2[0].associatedAt.toISOString()).toBe(newer.associatedAt.toISOString());
  });

  it("unknown/legacy label strings are treated as the lowest precedence", () => {
    const links = [
      link("p1", "Some Legacy Label", "2026-06-01T00:00:00Z"),
      link("p1", "Previous Owner", "2026-01-01T00:00:00Z"),
    ];
    const [only] = dedupeContactLinksByProperty(links);
    // Previous Owner outranks unknown labels — the unknown one is only
    // picked when nothing recognized is present.
    expect(only.label).toBe("Previous Owner");
  });

  it("preserves the chosen row's own associatedAt and property reference", () => {
    const links = [
      link("p1", "Current Owner", "2026-03-15T12:34:56Z"),
      link("p1", "Authorized Contact", "2026-05-01T00:00:00Z"),
    ];
    const [only] = dedupeContactLinksByProperty(links);
    expect(only.associatedAt.toISOString()).toBe("2026-03-15T12:34:56.000Z");
    expect(only.property.id).toBe("p1");
  });

  it("returns an empty array on empty input", () => {
    expect(dedupeContactLinksByProperty([])).toEqual([]);
  });
});
