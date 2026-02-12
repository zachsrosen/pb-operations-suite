/**
 * Tests for /api/projects route
 * Validates pagination fix, filtering, sorting, and response shape.
 */

// Mock the hubspot module and cache
interface MockProject {
  isActive: boolean;
  pbLocation: string;
  name: string;
}

jest.mock("@/lib/hubspot", () => ({
  fetchAllProjects: jest.fn(),
  calculateStats: jest.fn().mockReturnValue({
    totalProjects: 2,
    totalValue: 100000,
  }),
  filterProjectsForContext: jest.fn((projects: MockProject[], context: string) => {
    if (context === "executive") return projects.filter((p) => p.isActive);
    return projects;
  }),
}));

jest.mock("@/lib/cache", () => ({
  appCache: {
    getOrFetch: jest.fn(async (_key: string, fetcher: () => Promise<unknown>) => {
      const data = await fetcher();
      return { data, cached: false, stale: false, lastUpdated: new Date().toISOString() };
    }),
  },
  CACHE_KEYS: {
    PROJECTS_ALL: "projects:all",
    PROJECTS_ACTIVE: "projects:active",
    DEALS: (p: string) => `deals:${p}`,
    STATS: "stats",
    PIPELINES: "pipelines",
  },
}));

import { GET } from "@/app/api/projects/route";
import { NextRequest } from "next/server";
import { fetchAllProjects } from "@/lib/hubspot";

const mockFetchAllProjects = fetchAllProjects as jest.MockedFunction<typeof fetchAllProjects>;

function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    id: String(overrides.id || "1"),
    name: "Test Project",
    stage: "Construction",
    isActive: true,
    pbLocation: "Westminster",
    amount: 50000,
    projectNumber: "PB-001",
    address: "123 Main St",
    city: "Boulder",
    ahj: "Boulder County",
    installCrew: "Crew A",
    projectManager: "John",
    priorityScore: 50,
    ...overrides,
  };
}

function makeRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL("http://localhost:3000/api/projects");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new NextRequest(url);
}

describe("GET /api/projects", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchAllProjects.mockResolvedValue([
      makeProject({ id: "1", amount: 50000, pbLocation: "Westminster" }),
      makeProject({ id: "2", amount: 75000, pbLocation: "Centennial", stage: "Inspection" }),
      makeProject({ id: "3", amount: 25000, pbLocation: "Westminster", isActive: false }),
    ]);
  });

  it("returns all projects when no limit is set (the pagination fix)", async () => {
    const req = makeRequest({ context: "all", active: "false" });
    const res = await GET(req);
    const body = await res.json();

    // The key fix: limit=0 should return ALL results, not 1
    expect(body.count).toBe(3);
    expect(body.totalCount).toBe(3);
    expect(body.pagination).toBeNull();
  });

  it("applies pagination when limit > 0", async () => {
    const req = makeRequest({ context: "all", active: "false", limit: "2", page: "1" });
    const res = await GET(req);
    const body = await res.json();

    expect(body.count).toBe(2);
    expect(body.totalCount).toBe(3);
    expect(body.pagination).toBeDefined();
    expect(body.pagination.page).toBe(1);
    expect(body.pagination.limit).toBe(2);
    expect(body.pagination.totalPages).toBe(2);
    expect(body.pagination.hasMore).toBe(true);
  });

  it("returns page 2 correctly", async () => {
    const req = makeRequest({ context: "all", active: "false", limit: "2", page: "2" });
    const res = await GET(req);
    const body = await res.json();

    expect(body.count).toBe(1);
    expect(body.pagination.page).toBe(2);
    expect(body.pagination.hasMore).toBe(false);
  });

  it("filters by location", async () => {
    const req = makeRequest({ context: "all", active: "false", location: "Westminster" });
    const res = await GET(req);
    const body = await res.json();

    expect(body.projects.every((p: MockProject) => p.pbLocation === "Westminster")).toBe(true);
  });

  it("filters by stage", async () => {
    const req = makeRequest({ context: "all", active: "false", stage: "Inspection" });
    const res = await GET(req);
    const body = await res.json();

    expect(body.count).toBe(1);
    expect(body.projects[0].stage).toBe("Inspection");
  });

  it("searches by text", async () => {
    mockFetchAllProjects.mockResolvedValue([
      makeProject({ id: "1", name: "Smith Residence" }),
      makeProject({ id: "2", name: "Johnson Solar" }),
    ]);

    const req = makeRequest({ context: "all", active: "false", search: "smith" });
    const res = await GET(req);
    const body = await res.json();

    expect(body.count).toBe(1);
    expect(body.projects[0].name).toContain("Smith");
  });

  it("includes stats when requested", async () => {
    const req = makeRequest({ context: "all", active: "false", stats: "true" });
    const res = await GET(req);
    const body = await res.json();

    expect(body.stats).toBeDefined();
    expect(body.stats.totalProjects).toBe(2);
  });

  it("returns stale and lastUpdated metadata", async () => {
    const req = makeRequest({ context: "all" });
    const res = await GET(req);
    const body = await res.json();

    expect(body).toHaveProperty("cached");
    expect(body).toHaveProperty("stale");
    expect(body).toHaveProperty("lastUpdated");
  });

  it("returns 500 on fetch error", async () => {
    mockFetchAllProjects.mockRejectedValue(new Error("HubSpot error"));

    const req = makeRequest({ context: "all" });
    const res = await GET(req);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Failed to fetch projects");
  });
});
