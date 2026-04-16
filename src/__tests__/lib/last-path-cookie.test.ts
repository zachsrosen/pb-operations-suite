import {
  LAST_PATH_COOKIE_NAME,
  getCookieOptions,
  isRememberablePath,
  isValidStoredPath,
} from "@/lib/last-path-cookie";

describe("last-path-cookie", () => {
  describe("LAST_PATH_COOKIE_NAME", () => {
    it("is pb_last_path", () => {
      expect(LAST_PATH_COOKIE_NAME).toBe("pb_last_path");
    });
  });

  describe("getCookieOptions", () => {
    it("returns httpOnly, lax, rooted at /, 30-day maxAge", () => {
      const opts = getCookieOptions(false);
      expect(opts.httpOnly).toBe(true);
      expect(opts.sameSite).toBe("lax");
      expect(opts.path).toBe("/");
      expect(opts.maxAge).toBe(30 * 24 * 60 * 60);
    });

    it("sets secure=true in production", () => {
      expect(getCookieOptions(true).secure).toBe(true);
    });

    it("sets secure=false outside production", () => {
      expect(getCookieOptions(false).secure).toBe(false);
    });
  });

  describe("isRememberablePath", () => {
    it.each([
      ["/dashboards/service-tickets", true],
      ["/dashboards/executive", true],
      ["/suites/operations", true],
      ["/sop/ops", true],
      ["/sop", false], // root redirects
      ["/login", false],
      ["/maintenance", false],
      ["/admin/users", false],
      ["/api/deals", false],
      ["/portal/survey/abc", false],
      ["/", false],
      ["", false],
    ])("%s -> %s", (path, expected) => {
      expect(isRememberablePath(path)).toBe(expected);
    });
  });

  describe("isValidStoredPath", () => {
    it("accepts a valid rememberable path", () => {
      expect(isValidStoredPath("/dashboards/service-tickets")).toBe(true);
    });

    it("rejects undefined / empty", () => {
      expect(isValidStoredPath(undefined)).toBe(false);
      expect(isValidStoredPath("")).toBe(false);
    });

    it("rejects paths not starting with /", () => {
      expect(isValidStoredPath("dashboards/foo")).toBe(false);
      expect(isValidStoredPath("https://evil.com/dashboards")).toBe(false);
    });

    it("rejects protocol-relative paths", () => {
      expect(isValidStoredPath("//evil.com/dashboards")).toBe(false);
    });

    it("rejects paths with backslash", () => {
      expect(isValidStoredPath("/dashboards\\foo")).toBe(false);
    });

    it("rejects paths with newline or null byte", () => {
      expect(isValidStoredPath("/dashboards/foo\n")).toBe(false);
      expect(isValidStoredPath("/dashboards/foo\0")).toBe(false);
    });

    it("rejects paths longer than 512 chars", () => {
      const longPath = "/dashboards/" + "x".repeat(600);
      expect(isValidStoredPath(longPath)).toBe(false);
    });

    it("rejects non-rememberable paths even if otherwise valid", () => {
      expect(isValidStoredPath("/admin/users")).toBe(false);
      expect(isValidStoredPath("/api/deals")).toBe(false);
    });
  });
});
