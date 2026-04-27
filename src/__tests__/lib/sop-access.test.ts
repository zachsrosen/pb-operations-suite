import { canAccessTab, canAccessSection, ADMIN_ONLY_SECTIONS } from "@/lib/sop-access";

describe("canAccessTab", () => {
  // Public tabs — accessible to everyone
  it.each(["hubspot", "ops", "ref"])("allows any role to access public tab '%s'", (tabId) => {
    expect(canAccessTab(tabId, "VIEWER", "john")).toBe(true);
    expect(canAccessTab(tabId, "OPERATIONS", "jane")).toBe(true);
    expect(canAccessTab(tabId, "TECH_OPS", "mike")).toBe(true);
    expect(canAccessTab(tabId, "PROJECT_MANAGER", "sara")).toBe(true);
  });

  // Admin/Owner bypass
  it("allows ADMIN to access all tabs including shelved ones", () => {
    expect(canAccessTab("pm", "ADMIN", "nobody")).toBe(true);
    expect(canAccessTab("role-de", "ADMIN", "nobody")).toBe(true);
    expect(canAccessTab("other", "ADMIN", "nobody")).toBe(true);
    expect(canAccessTab("role-ops", "ADMIN", "nobody")).toBe(true);
  });

  it("allows OWNER to access all tabs including shelved ones", () => {
    expect(canAccessTab("pm", "OWNER", "nobody")).toBe(true);
    expect(canAccessTab("role-de", "OWNER", "nobody")).toBe(true);
    expect(canAccessTab("other", "OWNER", "nobody")).toBe(true);
    expect(canAccessTab("role-ops", "OWNER", "nobody")).toBe(true);
  });

  // PM Guide — name-gated
  it("allows named PMs to access the PM tab", () => {
    expect(canAccessTab("pm", "PROJECT_MANAGER", "alexis")).toBe(true);
    expect(canAccessTab("pm", "PROJECT_MANAGER", "kaitlyn")).toBe(true);
    expect(canAccessTab("pm", "PROJECT_MANAGER", "kat")).toBe(true);
    expect(canAccessTab("pm", "PROJECT_MANAGER", "natasha")).toBe(true);
  });

  it("blocks non-named users from the PM tab", () => {
    expect(canAccessTab("pm", "PROJECT_MANAGER", "bob")).toBe(false);
    expect(canAccessTab("pm", "OPERATIONS", "alexis")).toBe(true); // name match regardless of role
  });

  // Tech Ops tab
  it("allows TECH_OPS role to access role-de tab", () => {
    expect(canAccessTab("role-de", "TECH_OPS", "anyone")).toBe(true);
  });

  it("blocks non-TECH_OPS from role-de tab", () => {
    expect(canAccessTab("role-de", "OPERATIONS", "anyone")).toBe(false);
    expect(canAccessTab("role-de", "PROJECT_MANAGER", "anyone")).toBe(false);
    expect(canAccessTab("role-de", "VIEWER", "anyone")).toBe(false);
  });

  // Unknown / shelved tabs
  it("denies access to unknown tab IDs for non-admins", () => {
    expect(canAccessTab("other", "OPERATIONS", "anyone")).toBe(false);
    expect(canAccessTab("role-ops", "VIEWER", "anyone")).toBe(false);
    expect(canAccessTab("nonexistent", "PROJECT_MANAGER", "anyone")).toBe(false);
  });

  // Null role
  it("handles null role gracefully", () => {
    expect(canAccessTab("hubspot", null, "anyone")).toBe(true);
    expect(canAccessTab("pm", null, "alexis")).toBe(true); // name match still works
    expect(canAccessTab("role-de", null, "anyone")).toBe(false);
    expect(canAccessTab("other", null, "anyone")).toBe(false);
  });
});

describe("canAccessSection", () => {
  // Admin bypass
  it("allows ADMIN to access admin-only sections", () => {
    expect(canAccessSection("ref-user-roles", "ref", "ADMIN", "anyone")).toBe(true);
    expect(canAccessSection("ref-system", "ref", "ADMIN", "anyone")).toBe(true);
  });

  it("allows OWNER to access admin-only sections", () => {
    expect(canAccessSection("ref-user-roles", "ref", "OWNER", "anyone")).toBe(true);
    expect(canAccessSection("ref-system", "ref", "OWNER", "anyone")).toBe(true);
  });

  // Non-admin blocked from admin-only sections
  it("blocks non-admins from admin-only sections", () => {
    expect(canAccessSection("ref-user-roles", "ref", "OPERATIONS", "anyone")).toBe(false);
    expect(canAccessSection("ref-system", "ref", "VIEWER", "anyone")).toBe(false);
    expect(canAccessSection("ref-user-roles", "ref", "TECH_OPS", "anyone")).toBe(false);
  });

  // Regular sections in accessible tabs
  it("allows access to regular sections in public tabs", () => {
    expect(canAccessSection("hubspot-deals", "hubspot", "VIEWER", "anyone")).toBe(true);
    expect(canAccessSection("ops-pipeline", "ops", "OPERATIONS", "anyone")).toBe(true);
  });

  // Section in restricted tab
  it("blocks access when parent tab is restricted", () => {
    expect(canAccessSection("pm-section", "pm", "OPERATIONS", "bob")).toBe(false);
    expect(canAccessSection("de-section", "role-de", "VIEWER", "anyone")).toBe(false);
  });

  // Section in restricted tab but user has access
  it("allows access to sections in restricted tabs when user has tab access", () => {
    expect(canAccessSection("pm-section", "pm", "PROJECT_MANAGER", "alexis")).toBe(true);
    expect(canAccessSection("de-section", "role-de", "TECH_OPS", "anyone")).toBe(true);
  });
});

describe("ADMIN_ONLY_SECTIONS", () => {
  it("contains the legacy admin-only section IDs", () => {
    expect(ADMIN_ONLY_SECTIONS).toContain("ref-user-roles");
    expect(ADMIN_ONLY_SECTIONS).toContain("ref-system");
  });

  it("includes admin-only sections derived from SECTION_ROLE_GATES with empty allowlists", () => {
    expect(ADMIN_ONLY_SECTIONS).toContain("tools-workflow-builder");
    expect(ADMIN_ONLY_SECTIONS).toContain("suites-executive");
    expect(ADMIN_ONLY_SECTIONS).toContain("suites-admin");
  });
});

describe("multi-role access", () => {
  it("grants tab access when ANY role in the array matches", () => {
    expect(canAccessTab("service", ["SALES", "SERVICE"], "anyone")).toBe(true);
    expect(canAccessTab("service", ["SALES"], "anyone")).toBe(false);
    expect(canAccessTab("forecast", ["INTELLIGENCE", "VIEWER"], "anyone")).toBe(true);
  });

  it("denies role-gated tabs to users without any matching role", () => {
    expect(canAccessTab("service", ["SALES"], "anyone")).toBe(false);
    expect(canAccessTab("forecast", ["SALES"], "anyone")).toBe(false);
    expect(canAccessTab("queues", ["SERVICE"], "anyone")).toBe(false);
  });

  it("admin role in any position grants access", () => {
    expect(canAccessTab("service", ["VIEWER", "ADMIN"], "anyone")).toBe(true);
    expect(canAccessTab("forecast", ["OWNER"], "anyone")).toBe(true);
  });
});

describe("section-level role gates", () => {
  it("blocks tools-workflow-builder for non-admins even with tools tab access", () => {
    expect(canAccessSection("tools-workflow-builder", "tools", ["TECH_OPS"], "anyone")).toBe(false);
    expect(canAccessSection("tools-workflow-builder", "tools", ["ADMIN"], "anyone")).toBe(true);
  });

  it("gates pricing calculator to sales/accounting/PM", () => {
    expect(canAccessSection("tools-pricing-calculator", "tools", ["SALES"], "anyone")).toBe(true);
    expect(canAccessSection("tools-pricing-calculator", "tools", ["TECH_OPS"], "anyone")).toBe(false);
  });

  it("gates customer history to service/ops/PM (PII access)", () => {
    expect(canAccessSection("service-customer-history", "service", ["SERVICE"], "anyone")).toBe(true);
    expect(canAccessSection("service-customer-history", "service", ["SALES"], "anyone")).toBe(false);
  });

  it("gates D&E queues to design/techops/PM only", () => {
    expect(canAccessSection("queues-plan-review", "queues", ["DESIGN"], "anyone")).toBe(true);
    expect(canAccessSection("queues-plan-review", "queues", ["PERMIT"], "anyone")).toBe(false);
  });
});
