import { canAccessTab, canAccessSection, ADMIN_ONLY_SECTIONS } from "@/lib/sop-access";

/**
 * Post-2026-04-28 hub flip: most tabs are public. Only "drafts" and
 * unknown tabs are admin-only. Section-level gates are the only role
 * restrictions remaining for sensitive content.
 */

describe("canAccessTab — hub-mode visibility", () => {
  // Foundation tabs — public to all
  it.each(["hubspot", "ops", "ref", "zoho-inventory", "catalog", "suites"])(
    "allows any authenticated user to access foundation tab '%s'",
    (tabId) => {
      expect(canAccessTab(tabId, "VIEWER", "anyone")).toBe(true);
      expect(canAccessTab(tabId, "OPERATIONS", "anyone")).toBe(true);
      expect(canAccessTab(tabId, "PROJECT_MANAGER", "anyone")).toBe(true);
    },
  );

  // Department guides — opened up post-hub-flip
  it.each([
    "service",
    "scheduling",
    "forecast",
    "trackers",
    "tools",
    "queues",
    "accounting-sop",
    "sales-marketing-sop",
    "pm",
    "role-de",
    "role-permit",
    "role-ic",
  ])("allows any authenticated user to access opened-up tab '%s'", (tabId) => {
    expect(canAccessTab(tabId, "VIEWER", "anyone")).toBe(true);
    expect(canAccessTab(tabId, "OPERATIONS", "anyone")).toBe(true);
    expect(canAccessTab(tabId, "SALES", "anyone")).toBe(true);
  });

  // PM Guide — was name-gated pre-hub-flip, now open
  it("opens PM Guide to everyone (name gate removed during hub flip)", () => {
    expect(canAccessTab("pm", "PROJECT_MANAGER", "alexis")).toBe(true);
    expect(canAccessTab("pm", "PROJECT_MANAGER", "bob")).toBe(true);
    expect(canAccessTab("pm", "OPERATIONS", "anyone")).toBe(true);
    expect(canAccessTab("pm", "VIEWER", "anyone")).toBe(true);
    expect(canAccessTab("pm", "SALES", "newhire")).toBe(true);
  });

  // Drafts tab — admin-only (work-in-progress staging area)
  it("blocks non-admins from the drafts tab", () => {
    expect(canAccessTab("drafts", "PROJECT_MANAGER", "anyone")).toBe(false);
    expect(canAccessTab("drafts", "OPERATIONS", "anyone")).toBe(false);
    expect(canAccessTab("drafts", "SALES", "anyone")).toBe(false);
    expect(canAccessTab("drafts", "VIEWER", "anyone")).toBe(false);
    expect(canAccessTab("drafts", null, "anyone")).toBe(false);
  });

  // Admin/Owner/Executive bypass — sees everything including drafts
  it("allows ADMIN to access all tabs including drafts", () => {
    expect(canAccessTab("drafts", "ADMIN", "anyone")).toBe(true);
    expect(canAccessTab("anything", "ADMIN", "anyone")).toBe(true);
  });
  it("allows OWNER to access all tabs including drafts", () => {
    expect(canAccessTab("drafts", "OWNER", "anyone")).toBe(true);
  });
  it("allows EXECUTIVE to access all tabs including drafts", () => {
    expect(canAccessTab("drafts", "EXECUTIVE", "anyone")).toBe(true);
  });

  // Unknown / fully-shelved tabs — denied for non-admins
  it("denies access to unknown tab IDs for non-admins", () => {
    expect(canAccessTab("totally-made-up", "OPERATIONS", "anyone")).toBe(false);
    expect(canAccessTab("nonexistent", "PROJECT_MANAGER", "anyone")).toBe(false);
  });

  // Null role
  it("handles null role — gives access to public tabs but not admin-only", () => {
    expect(canAccessTab("hubspot", null, "anyone")).toBe(true);
    expect(canAccessTab("pm", null, "alexis")).toBe(true);
    expect(canAccessTab("role-de", null, "anyone")).toBe(true);
    expect(canAccessTab("drafts", null, "anyone")).toBe(false);
  });
});

describe("canAccessSection — section-level gates still enforced", () => {
  // Admin bypass
  it("allows ADMIN to access admin-only sections", () => {
    expect(canAccessSection("ref-user-roles", "ref", "ADMIN", "anyone")).toBe(true);
    expect(canAccessSection("ref-system", "ref", "ADMIN", "anyone")).toBe(true);
    expect(canAccessSection("tools-workflow-builder", "tools", "ADMIN", "anyone")).toBe(true);
    expect(canAccessSection("suites-executive", "suites", "ADMIN", "anyone")).toBe(true);
    expect(canAccessSection("suites-admin", "suites", "ADMIN", "anyone")).toBe(true);
  });

  // Non-admin blocked from admin-only sections (even when parent tab is public)
  it("blocks non-admins from admin-only sections in public tabs", () => {
    expect(canAccessSection("ref-user-roles", "ref", "OPERATIONS", "anyone")).toBe(false);
    expect(canAccessSection("ref-system", "ref", "VIEWER", "anyone")).toBe(false);
    expect(canAccessSection("tools-workflow-builder", "tools", "TECH_OPS", "anyone")).toBe(false);
    expect(canAccessSection("suites-executive", "suites", "OPERATIONS", "anyone")).toBe(false);
    expect(canAccessSection("suites-admin", "suites", "OPERATIONS", "anyone")).toBe(false);
  });

  // Pricing — financial COGS, restricted to sales/accounting/PM
  it("gates pricing calculator to sales/accounting/PM (financial data)", () => {
    expect(canAccessSection("tools-pricing-calculator", "tools", "SALES", "anyone")).toBe(true);
    expect(canAccessSection("tools-pricing-calculator", "tools", "ACCOUNTING", "anyone")).toBe(true);
    expect(canAccessSection("tools-pricing-calculator", "tools", "PROJECT_MANAGER", "anyone")).toBe(true);
    expect(canAccessSection("tools-pricing-calculator", "tools", "TECH_OPS", "anyone")).toBe(false);
    expect(canAccessSection("tools-pricing-calculator", "tools", "OPERATIONS", "anyone")).toBe(false);
  });

  // Customer history — PII access workflow
  it("gates customer history to service/ops/PM only (PII workflow)", () => {
    expect(canAccessSection("service-customer-history", "service", "SERVICE", "anyone")).toBe(true);
    expect(canAccessSection("service-customer-history", "service", "OPERATIONS", "anyone")).toBe(true);
    expect(canAccessSection("service-customer-history", "service", "PROJECT_MANAGER", "anyone")).toBe(true);
    expect(canAccessSection("service-customer-history", "service", "SALES", "anyone")).toBe(false);
    expect(canAccessSection("service-customer-history", "service", "VIEWER", "anyone")).toBe(false);
  });

  // Regular sections — open
  it("allows access to regular sections in public tabs", () => {
    expect(canAccessSection("hubspot-deals", "hubspot", "VIEWER", "anyone")).toBe(true);
    expect(canAccessSection("ops-pipeline", "ops", "OPERATIONS", "anyone")).toBe(true);
    expect(canAccessSection("queues-plan-review", "queues", "OPERATIONS", "anyone")).toBe(true);
    expect(canAccessSection("queues-permit-action", "queues", "SALES", "anyone")).toBe(true);
    expect(canAccessSection("tools-permit-hub", "tools", "VIEWER", "anyone")).toBe(true);
  });

  // Sections in drafts tab — admin-only via tab-level gate
  it("blocks non-admins from drafts tab sections", () => {
    expect(canAccessSection("draft-pm-overview", "drafts", "PROJECT_MANAGER", "anyone")).toBe(false);
    expect(canAccessSection("draft-pipeline-overview", "drafts", "OPERATIONS", "anyone")).toBe(false);
    expect(canAccessSection("draft-pm-overview", "drafts", "ADMIN", "anyone")).toBe(true);
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

describe("multi-role access — hub mode", () => {
  it("admins still bypass everything regardless of role array shape", () => {
    expect(canAccessTab("drafts", ["VIEWER", "ADMIN"], "anyone")).toBe(true);
    expect(canAccessTab("anything-shelved", ["OWNER"], "anyone")).toBe(true);
  });

  it("non-admin role array still denies drafts", () => {
    expect(canAccessTab("drafts", ["OPERATIONS", "SALES"], "anyone")).toBe(false);
    expect(canAccessTab("drafts", ["VIEWER", "OPERATIONS"], "anyone")).toBe(false);
  });

  it("section-level gates honor multi-role union", () => {
    // Pricing gate accepts SALES; user has SALES + VIEWER → allowed
    expect(
      canAccessSection("tools-pricing-calculator", "tools", ["VIEWER", "SALES"], "anyone"),
    ).toBe(true);
    // No matching role → denied
    expect(
      canAccessSection("tools-pricing-calculator", "tools", ["VIEWER", "TECH_OPS"], "anyone"),
    ).toBe(false);
  });
});
