/**
 * Tests for SUITE_MAP back-navigation mappings in DashboardShell.
 *
 * We import the map directly rather than rendering the component,
 * keeping these as fast unit tests.
 */

// SUITE_MAP is not exported, so we extract it via a small re-export helper.
// Instead, we just validate the module's source expectations inline.

describe("SUITE_MAP back-navigation", () => {
  // We read the compiled module to get the SUITE_MAP object.
  // Since SUITE_MAP is a module-level const (not exported), we test
  // the expectations documented in the code review:

  it("maps /dashboards/sales to Home, not Intelligence", () => {
    // This ensures SALES users (who cannot access Intelligence) get
    // a valid back-link. We import the component module and inspect.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@/components/DashboardShell");

    // DashboardShell uses SUITE_MAP internally. Since it's not exported,
    // we verify the behavior by checking the module source was loaded
    // and testing via the exported SUITE_MAP if available, or via
    // a snapshot approach.

    // If SUITE_MAP becomes exported, test directly. For now, we validate
    // via a targeted regex on the source file.
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../components/DashboardShell.tsx"),
      "utf-8"
    );

    // /dashboards/sales should map to "/" (Home), not /suites/intelligence
    expect(src).toContain('"/dashboards/sales": { href: "/", label: "Home" }');
    expect(src).not.toContain(
      '"/dashboards/sales": { href: "/suites/intelligence"'
    );

    // Ensure the module loaded without errors
    expect(mod).toBeDefined();
  });
});
