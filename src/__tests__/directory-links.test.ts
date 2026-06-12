import {
  normalizeEmail,
  planLinkFills,
  nameMatchCandidates,
  type ExternalIdentity,
  type LinkableUser,
} from "@/lib/directory-links";

describe("directory-links", () => {
  describe("normalizeEmail", () => {
    it("trims whitespace", () => {
      expect(normalizeEmail("  drew@photonbrothers.com  ")).toBe(
        "drew@photonbrothers.com",
      );
    });

    it("lowercases", () => {
      expect(normalizeEmail("Drew@PhotonBrothers.COM")).toBe(
        "drew@photonbrothers.com",
      );
    });

    it("returns null for null", () => {
      expect(normalizeEmail(null)).toBeNull();
    });

    it("returns null for undefined", () => {
      expect(normalizeEmail(undefined)).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(normalizeEmail("")).toBeNull();
    });

    it("returns null for whitespace-only string", () => {
      expect(normalizeEmail("   ")).toBeNull();
    });
  });

  describe("planLinkFills", () => {
    const user = (
      id: string,
      email: string,
      existingLink: string | null = null,
    ): LinkableUser => ({ id, email, existingLink, name: null });

    const external = (
      id: string,
      email: string | null,
      label = `Label ${id}`,
    ): ExternalIdentity => ({ id, email, label });

    it("fills users with null link on email match", () => {
      const plan = planLinkFills(
        [user("u1", "drew@photonbrothers.com")],
        [external("hs-1", "Drew@photonbrothers.com", "Drew Perry")],
      );
      expect(plan.fills).toEqual([
        { userId: "u1", externalId: "hs-1", label: "Drew Perry" },
      ]);
      expect(plan.alreadyLinked).toBe(0);
      expect(plan.unmatched).toEqual([]);
    });

    it("counts already-linked users without changing them (never-overwrite)", () => {
      const plan = planLinkFills(
        [user("u1", "drew@photonbrothers.com", "hs-existing")],
        [external("hs-other", "drew@photonbrothers.com")],
      );
      expect(plan.alreadyLinked).toBe(1);
      expect(plan.fills).toEqual([]);
      expect(plan.unmatched).toEqual([]);
    });

    it("ignores externals with null email", () => {
      const plan = planLinkFills(
        [user("u1", "drew@photonbrothers.com")],
        [external("hs-1", null)],
      );
      expect(plan.fills).toEqual([]);
      expect(plan.unmatched).toEqual([
        { email: "drew@photonbrothers.com", reason: "no-external-match" },
      ]);
    });

    it("reports duplicate-external-email when two externals share an email", () => {
      const plan = planLinkFills(
        [user("u1", "drew@photonbrothers.com")],
        [
          external("hs-1", "drew@photonbrothers.com"),
          external("hs-2", "DREW@photonbrothers.com"),
        ],
      );
      expect(plan.fills).toEqual([]);
      expect(plan.unmatched).toEqual([
        {
          email: "drew@photonbrothers.com",
          reason: "duplicate-external-email",
        },
      ]);
    });

    it("reports no-external-match when user email has no external", () => {
      const plan = planLinkFills(
        [user("u1", "nobody@photonbrothers.com")],
        [external("hs-1", "drew@photonbrothers.com")],
      );
      expect(plan.fills).toEqual([]);
      expect(plan.unmatched).toEqual([
        { email: "nobody@photonbrothers.com", reason: "no-external-match" },
      ]);
    });
  });

  describe("nameMatchCandidates", () => {
    const crew = (
      id: string,
      name: string,
      email: string | null = null,
      userId: string | null = null,
    ) => ({ id, name, email, userId });

    const appUser = (id: string, name: string | null, email: string) => ({
      id,
      name,
      email,
    });

    it("produces a candidate for crew with null email and null userId matching one user by name", () => {
      const candidates = nameMatchCandidates(
        [crew("c1", "Drew Perry")],
        [appUser("u1", "Drew Perry", "drew@photonbrothers.com")],
      );
      expect(candidates).toEqual([
        {
          crewMemberId: "c1",
          crewName: "Drew Perry",
          userId: "u1",
          userName: "Drew Perry",
        },
      ]);
    });

    it("skips crew that has an email", () => {
      const candidates = nameMatchCandidates(
        [crew("c1", "Drew Perry", "drew@photonbrothers.com")],
        [appUser("u1", "Drew Perry", "drew@photonbrothers.com")],
      );
      expect(candidates).toEqual([]);
    });

    it("skips crew already linked to a user", () => {
      const candidates = nameMatchCandidates(
        [crew("c1", "Drew Perry", null, "u-linked")],
        [appUser("u1", "Drew Perry", "drew@photonbrothers.com")],
      );
      expect(candidates).toEqual([]);
    });

    it("matches names case- and whitespace-insensitively", () => {
      const candidates = nameMatchCandidates(
        [crew("c1", "  drew   PERRY ")],
        [appUser("u1", "Drew Perry", "drew@photonbrothers.com")],
      );
      expect(candidates).toEqual([
        {
          crewMemberId: "c1",
          crewName: "  drew   PERRY ",
          userId: "u1",
          userName: "Drew Perry",
        },
      ]);
    });

    it("produces nothing when the crew name matches zero users", () => {
      const candidates = nameMatchCandidates(
        [crew("c1", "Drew Perry")],
        [appUser("u1", "Joe Lynch", "joe@photonbrothers.com")],
      );
      expect(candidates).toEqual([]);
    });

    it("produces nothing when the crew name matches 2+ users (ambiguous)", () => {
      const candidates = nameMatchCandidates(
        [crew("c1", "Drew Perry")],
        [
          appUser("u1", "Drew Perry", "drew@photonbrothers.com"),
          appUser("u2", "Drew Perry", "drew.perry@photonbrothers.com"),
        ],
      );
      expect(candidates).toEqual([]);
    });
  });
});
