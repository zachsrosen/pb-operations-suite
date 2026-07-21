// next-auth v5 beta is ESM-only; Jest cannot parse it. Mock before importing
// anything that transitively imports next-auth/react.
jest.mock("next-auth/react", () => ({
  useSession: () => ({ data: null }),
  signOut: jest.fn(),
  SessionProvider: ({ children }: { children: unknown }) => children,
}));

import { partitionLegacyCards, type SuitePageCard } from "@/components/SuitePageShell";

const card = (href: string, section = "Tools"): SuitePageCard => ({
  href,
  title: href,
  description: "",
  tag: "T",
  section,
});

describe("partitionLegacyCards", () => {
  it("splits cards by legacy-set membership, preserving order and section", () => {
    const cards = [card("/a", "S1"), card("/b", "S1"), card("/c", "S2")];
    const { fresh, legacy } = partitionLegacyCards(cards, new Set(["/b"]));
    expect(fresh.map((c) => c.href)).toEqual(["/a", "/c"]);
    expect(legacy.map((c) => c.href)).toEqual(["/b"]);
    expect(legacy[0].section).toBe("S1"); // original section kept for accent color
  });

  it("returns empty legacy list for empty set", () => {
    const { fresh, legacy } = partitionLegacyCards([card("/a")], new Set());
    expect(fresh).toHaveLength(1);
    expect(legacy).toHaveLength(0);
  });
});
