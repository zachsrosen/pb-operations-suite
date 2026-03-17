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
    mockGetCurrentUser.mockResolvedValue({ email: "admin@pb.com", name: "Admin User", role: "ADMIN" });
    const res = await getTabs();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.tabs).toHaveLength(4);
    // Admin sees admin-only sections
    const refTab = body.tabs.find((t: { id: string }) => t.id === "ref");
    expect(refTab.sections).toHaveLength(3);
  });

  it("filters restricted tabs for VIEWER", async () => {
    mockGetCurrentUser.mockResolvedValue({ email: "viewer@pb.com", name: "Bob Smith", role: "VIEWER" });
    const res = await getTabs();
    const body = await res.json();
    expect(res.status).toBe(200);
    const tabIds = body.tabs.map((t: { id: string }) => t.id);
    expect(tabIds).toContain("hubspot");
    expect(tabIds).toContain("ref");
    expect(tabIds).not.toContain("pm");
    expect(tabIds).not.toContain("role-de");
  });

  it("strips admin-only sections from ref tab for non-admin", async () => {
    mockGetCurrentUser.mockResolvedValue({ email: "viewer@pb.com", name: "Bob Smith", role: "VIEWER" });
    const res = await getTabs();
    const body = await res.json();
    const refTab = body.tabs.find((t: { id: string }) => t.id === "ref");
    const sectionIds = refTab.sections.map((s: { id: string }) => s.id);
    expect(sectionIds).toContain("ref-glossary");
    expect(sectionIds).not.toContain("ref-user-roles");
    expect(sectionIds).not.toContain("ref-system");
  });

  it("allows named PM to see PM tab", async () => {
    mockGetCurrentUser.mockResolvedValue({ email: "alexis@pb.com", name: "Alexis Jones", role: "PROJECT_MANAGER" });
    const res = await getTabs();
    const body = await res.json();
    const tabIds = body.tabs.map((t: { id: string }) => t.id);
    expect(tabIds).toContain("pm");
  });

  it("blocks non-named PM from PM tab", async () => {
    mockGetCurrentUser.mockResolvedValue({ email: "bob@pb.com", name: "Bob Jones", role: "PROJECT_MANAGER" });
    const res = await getTabs();
    const body = await res.json();
    const tabIds = body.tabs.map((t: { id: string }) => t.id);
    expect(tabIds).not.toContain("pm");
  });

  it("allows TECH_OPS to see role-de tab", async () => {
    mockGetCurrentUser.mockResolvedValue({ email: "tech@pb.com", name: "Mike Smith", role: "TECH_OPS" });
    const res = await getTabs();
    const body = await res.json();
    const tabIds = body.tabs.map((t: { id: string }) => t.id);
    expect(tabIds).toContain("role-de");
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
    mockGetCurrentUser.mockResolvedValue({ email: "admin@pb.com", name: "Admin", role: "ADMIN" });
    mockFindUnique.mockResolvedValue(null);
    const res = await getSection(new Request("http://localhost"), makeParams("missing"));
    expect(res.status).toBe(404);
  });

  it("returns section for authorized user", async () => {
    mockGetCurrentUser.mockResolvedValue({ email: "viewer@pb.com", name: "Bob Smith", role: "VIEWER" });
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

  it("returns 403 for section in restricted tab", async () => {
    mockGetCurrentUser.mockResolvedValue({ email: "viewer@pb.com", name: "Bob Smith", role: "VIEWER" });
    mockFindUnique.mockResolvedValue({
      id: "pm-workflow", tabId: "pm", sidebarGroup: "Workflows", title: "PM Workflow",
      dotColor: "blue", sortOrder: 1, content: "<p>PM content</p>", version: 1,
      updatedAt: new Date(), updatedBy: null,
    });
    const res = await getSection(new Request("http://localhost"), makeParams("pm-workflow"));
    expect(res.status).toBe(403);
  });

  it("returns 403 for admin-only section when non-admin", async () => {
    mockGetCurrentUser.mockResolvedValue({ email: "viewer@pb.com", name: "Bob Smith", role: "VIEWER" });
    mockFindUnique.mockResolvedValue({
      id: "ref-user-roles", tabId: "ref", sidebarGroup: "Admin", title: "User Roles",
      dotColor: "red", sortOrder: 2, content: "<p>Roles</p>", version: 1,
      updatedAt: new Date(), updatedBy: null,
    });
    const res = await getSection(new Request("http://localhost"), makeParams("ref-user-roles"));
    expect(res.status).toBe(403);
  });

  it("allows ADMIN to access admin-only section", async () => {
    mockGetCurrentUser.mockResolvedValue({ email: "admin@pb.com", name: "Admin User", role: "ADMIN" });
    mockFindUnique.mockResolvedValue({
      id: "ref-user-roles", tabId: "ref", sidebarGroup: "Admin", title: "User Roles",
      dotColor: "red", sortOrder: 2, content: "<p>Roles</p>", version: 1,
      updatedAt: new Date(), updatedBy: null,
    });
    const res = await getSection(new Request("http://localhost"), makeParams("ref-user-roles"));
    expect(res.status).toBe(200);
  });
});
