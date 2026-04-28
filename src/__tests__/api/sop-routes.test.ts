/**
 * Tests for SOP API route access control
 *
 * Verifies that /api/sop/tabs and /api/sop/sections/[id]
 * enforce role-based filtering via getCurrentUser() + sop-access.
 */

const mockGetCurrentUser = jest.fn();
jest.mock("@/lib/auth-utils", () => ({
  getCurrentUser: () => mockGetCurrentUser(),
}));

const mockFindMany = jest.fn();
const mockFindUnique = jest.fn();
jest.mock("@/lib/db", () => ({
  prisma: {
    sopTab: { findMany: (...args: unknown[]) => mockFindMany(...args) },
    sopSection: { findUnique: (...args: unknown[]) => mockFindUnique(...args) },
  },
}));

import { GET as getTabs } from "@/app/api/sop/tabs/route";
import { GET as getSection } from "@/app/api/sop/sections/[id]/route";

/* ── Sample data ───────────────────────────────────────────────── */

const sampleTabs = [
  {
    id: "hubspot",
    label: "HubSpot Guide",
    sortOrder: 1,
    sections: [
      { id: "hs-deals", tabId: "hubspot", sidebarGroup: "Deals", title: "Deal Overview", dotColor: "blue", sortOrder: 1, updatedAt: new Date(), updatedBy: null },
    ],
  },
  {
    id: "ref",
    label: "Reference",
    sortOrder: 2,
    sections: [
      { id: "ref-glossary", tabId: "ref", sidebarGroup: "General", title: "Glossary", dotColor: "green", sortOrder: 1, updatedAt: new Date(), updatedBy: null },
      { id: "ref-user-roles", tabId: "ref", sidebarGroup: "Admin", title: "User Roles", dotColor: "red", sortOrder: 2, updatedAt: new Date(), updatedBy: null },
      { id: "ref-system", tabId: "ref", sidebarGroup: "Admin", title: "System Architecture", dotColor: "red", sortOrder: 3, updatedAt: new Date(), updatedBy: null },
    ],
  },
  {
    id: "pm",
    label: "PM Guide",
    sortOrder: 3,
    sections: [
      { id: "pm-workflow", tabId: "pm", sidebarGroup: "Workflows", title: "PM Workflow", dotColor: "blue", sortOrder: 1, updatedAt: new Date(), updatedBy: null },
    ],
  },
  {
    id: "role-de",
    label: "Tech Ops",
    sortOrder: 4,
    sections: [
      { id: "de-checklist", tabId: "role-de", sidebarGroup: "Checklists", title: "D&E Checklist", dotColor: "green", sortOrder: 1, updatedAt: new Date(), updatedBy: null },
    ],
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockFindMany.mockResolvedValue(sampleTabs);
});

/* ── /api/sop/tabs ─────────────────────────────────────────────── */

describe("GET /api/sop/tabs", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    const res = await getTabs();
    expect(res.status).toBe(401);
  });

  it("returns all tabs for ADMIN", async () => {
    mockGetCurrentUser.mockResolvedValue({ email: "admin@pb.com", name: "Admin User", roles: ["ADMIN"] });
    const res = await getTabs();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.tabs).toHaveLength(4);
    // Admin sees admin-only sections
    const refTab = body.tabs.find((t: { id: string }) => t.id === "ref");
    expect(refTab.sections).toHaveLength(3);
  });

  it("post-hub-flip: VIEWER sees foundation + previously-gated tabs (pm, role-de) but NOT drafts", async () => {
    mockGetCurrentUser.mockResolvedValue({ email: "viewer@pb.com", name: "Bob Smith", roles: ["VIEWER"] });
    mockFindMany.mockResolvedValueOnce([
      ...sampleTabs,
      {
        id: "drafts",
        label: "Drafts",
        sortOrder: 99,
        sections: [
          { id: "draft-readme", tabId: "drafts", sidebarGroup: "About", title: "Drafts", dotColor: "amber", sortOrder: 0, updatedAt: new Date(), updatedBy: null },
        ],
      },
    ]);
    const res = await getTabs();
    const body = await res.json();
    expect(res.status).toBe(200);
    const tabIds = body.tabs.map((t: { id: string }) => t.id);
    expect(tabIds).toContain("hubspot");
    expect(tabIds).toContain("ref");
    // Hub flip: pm and role-de are now public
    expect(tabIds).toContain("pm");
    expect(tabIds).toContain("role-de");
    // Drafts stays admin-only
    expect(tabIds).not.toContain("drafts");
  });

  it("strips admin-only sections from ref tab for non-admin", async () => {
    mockGetCurrentUser.mockResolvedValue({ email: "viewer@pb.com", name: "Bob Smith", roles: ["VIEWER"] });
    const res = await getTabs();
    const body = await res.json();
    const refTab = body.tabs.find((t: { id: string }) => t.id === "ref");
    const sectionIds = refTab.sections.map((s: { id: string }) => s.id);
    expect(sectionIds).toContain("ref-glossary");
    expect(sectionIds).not.toContain("ref-user-roles");
    expect(sectionIds).not.toContain("ref-system");
  });

  it("post-hub-flip: PM Guide is public — anyone can see it (was name-gated)", async () => {
    // Previously this was gated to first-name in PM_NAMES. Now it's open.
    for (const user of [
      { email: "alexis@pb.com", name: "Alexis Jones", roles: ["PROJECT_MANAGER"] },
      { email: "bob@pb.com", name: "Bob Jones", roles: ["PROJECT_MANAGER"] },
      { email: "ops@pb.com", name: "Sara Ops", roles: ["OPERATIONS"] },
      { email: "newhire@pb.com", name: "New Hire", roles: ["VIEWER"] },
    ]) {
      mockGetCurrentUser.mockResolvedValue(user);
      const res = await getTabs();
      const body = await res.json();
      const tabIds = body.tabs.map((t: { id: string }) => t.id);
      expect(tabIds).toContain("pm");
    }
  });

  it("post-hub-flip: role-de (D&E SOP) is public", async () => {
    for (const role of ["TECH_OPS", "DESIGN", "SALES", "VIEWER"]) {
      mockGetCurrentUser.mockResolvedValue({ email: `${role}@pb.com`, name: "Test User", role });
      const res = await getTabs();
      const body = await res.json();
      const tabIds = body.tabs.map((t: { id: string }) => t.id);
      expect(tabIds).toContain("role-de");
    }
  });
});

/* ── /api/sop/sections/[id] ────────────────────────────────────── */

describe("GET /api/sop/sections/[id]", () => {
  const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });

  it("returns 401 when not authenticated", async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    const res = await getSection(new Request("http://localhost"), makeParams("hs-deals"));
    expect(res.status).toBe(401);
  });

  it("returns 404 for non-existent section", async () => {
    mockGetCurrentUser.mockResolvedValue({ email: "admin@pb.com", name: "Admin", roles: ["ADMIN"] });
    mockFindUnique.mockResolvedValue(null);
    const res = await getSection(new Request("http://localhost"), makeParams("missing"));
    expect(res.status).toBe(404);
  });

  it("returns section for authorized user", async () => {
    mockGetCurrentUser.mockResolvedValue({ email: "viewer@pb.com", name: "Bob Smith", roles: ["VIEWER"] });
    mockFindUnique.mockResolvedValue({
      id: "hs-deals", tabId: "hubspot", sidebarGroup: "Deals", title: "Deal Overview",
      dotColor: "blue", sortOrder: 1, content: "<p>Content</p>", version: 1,
      updatedAt: new Date(), updatedBy: null,
    });
    const res = await getSection(new Request("http://localhost"), makeParams("hs-deals"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.section.id).toBe("hs-deals");
  });

  it("post-hub-flip: PM Guide section is now accessible to non-PMs (public tab)", async () => {
    mockGetCurrentUser.mockResolvedValue({ email: "viewer@pb.com", name: "Bob Smith", roles: ["VIEWER"] });
    mockFindUnique.mockResolvedValue({
      id: "pm-workflow", tabId: "pm", sidebarGroup: "Workflows", title: "PM Workflow",
      dotColor: "blue", sortOrder: 1, content: "<p>PM content</p>", version: 1,
      updatedAt: new Date(), updatedBy: null,
    });
    const res = await getSection(new Request("http://localhost"), makeParams("pm-workflow"));
    expect(res.status).toBe(200);
  });

  it("returns 403 for section in admin-only tab (drafts)", async () => {
    mockGetCurrentUser.mockResolvedValue({ email: "viewer@pb.com", name: "Bob Smith", roles: ["VIEWER"] });
    mockFindUnique.mockResolvedValue({
      id: "draft-pm-overview", tabId: "drafts", sidebarGroup: "PM Guide (Rewrite)", title: "What PMs Do",
      dotColor: "orange", sortOrder: 20, content: "<p>Draft</p>", version: 1,
      updatedAt: new Date(), updatedBy: null,
    });
    const res = await getSection(new Request("http://localhost"), makeParams("draft-pm-overview"));
    expect(res.status).toBe(403);
  });

  it("returns 403 for admin-only section when non-admin", async () => {
    mockGetCurrentUser.mockResolvedValue({ email: "viewer@pb.com", name: "Bob Smith", roles: ["VIEWER"] });
    mockFindUnique.mockResolvedValue({
      id: "ref-user-roles", tabId: "ref", sidebarGroup: "Admin", title: "User Roles",
      dotColor: "red", sortOrder: 2, content: "<p>Roles</p>", version: 1,
      updatedAt: new Date(), updatedBy: null,
    });
    const res = await getSection(new Request("http://localhost"), makeParams("ref-user-roles"));
    expect(res.status).toBe(403);
  });

  it("allows ADMIN to access admin-only section", async () => {
    mockGetCurrentUser.mockResolvedValue({ email: "admin@pb.com", name: "Admin User", roles: ["ADMIN"] });
    mockFindUnique.mockResolvedValue({
      id: "ref-user-roles", tabId: "ref", sidebarGroup: "Admin", title: "User Roles",
      dotColor: "red", sortOrder: 2, content: "<p>Roles</p>", version: 1,
      updatedAt: new Date(), updatedBy: null,
    });
    const res = await getSection(new Request("http://localhost"), makeParams("ref-user-roles"));
    expect(res.status).toBe(200);
  });
});
