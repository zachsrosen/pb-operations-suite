/**
 * Integration tests for Solar Surveyor project CRUD + auth + CSRF + revisions
 *
 * Tests:
 *  1. Auth — 401 when unauthenticated
 *  2. CSRF — 403 when missing/invalid CSRF token on POST/PUT/DELETE
 *  3. POST /api/solar/projects — create project
 *  4. GET /api/solar/projects — list projects (role-scoped)
 *  5. GET /api/solar/projects/[id] — load project
 *  6. PUT /api/solar/projects/[id] — update + version conflict (409)
 *  7. PUT with forceOverwrite — auto-revision with FORCED_OVERWRITE note
 *  8. PUT with createRevision — revision creation
 *  9. DELETE /api/solar/projects/[id] — soft archive
 * 10. Beacon — body CSRF + Origin validation
 * 11. Beacon — upserts SolarPendingState per user
 * 12. Write access — non-admin cannot PUT TEAM-visibility project
 * 13. Archive access — shared EDIT user cannot archive
 * 14. Payload size guard — 413 on >5MB
 */

// ── Auth mock ──────────────────────────────────────────────

const ADMIN_USER = { id: "admin1", email: "admin@photonbrothers.com", name: "Admin", role: "ADMIN" };
const REGULAR_USER = { id: "user1", email: "user@photonbrothers.com", name: "User", role: "SALES" };
const OTHER_USER = { id: "user2", email: "other@photonbrothers.com", name: "Other", role: "SALES" };

let mockAuthUser: typeof ADMIN_USER | typeof REGULAR_USER | typeof OTHER_USER | null = ADMIN_USER;

jest.mock("@/lib/api-auth", () => ({
  requireApiAuth: jest.fn(async () => {
    if (!mockAuthUser) {
      const { NextResponse } = await import("next/server");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return { email: mockAuthUser.email, name: mockAuthUser.name };
  }),
}));

// ── Prisma mock ────────────────────────────────────────────

const mockUserFindUnique = jest.fn();
const mockProjectCreate = jest.fn();
const mockProjectFindMany = jest.fn();
const mockProjectCount = jest.fn();
const mockProjectFindUnique = jest.fn();
const mockProjectUpdate = jest.fn();
const mockRevisionCreate = jest.fn();
const mockRevisionUpsert = jest.fn();
const mockRevisionFindMany = jest.fn();
const mockShareFindUnique = jest.fn();
const mockPendingUpsert = jest.fn();
const mockPendingFindMany = jest.fn();

jest.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
    },
    solarProject: {
      create: (...args: unknown[]) => mockProjectCreate(...args),
      findMany: (...args: unknown[]) => mockProjectFindMany(...args),
      count: (...args: unknown[]) => mockProjectCount(...args),
      findUnique: (...args: unknown[]) => mockProjectFindUnique(...args),
      update: (...args: unknown[]) => mockProjectUpdate(...args),
    },
    solarProjectRevision: {
      create: (...args: unknown[]) => mockRevisionCreate(...args),
      upsert: (...args: unknown[]) => mockRevisionUpsert(...args),
      findMany: (...args: unknown[]) => mockRevisionFindMany(...args),
    },
    solarProjectShare: {
      findUnique: (...args: unknown[]) => mockShareFindUnique(...args),
    },
    solarPendingState: {
      upsert: (...args: unknown[]) => mockPendingUpsert(...args),
      findMany: (...args: unknown[]) => mockPendingFindMany(...args),
    },
  },
}));

// Solar CORS no longer needed — same-origin

// ── Imports ────────────────────────────────────────────────

import { NextRequest } from "next/server";
import { POST as createProject, GET as listProjects } from "@/app/api/solar/projects/route";
import { GET as getProject, PUT as updateProject, DELETE as archiveProject } from "@/app/api/solar/projects/[id]/route";
import { POST as beacon } from "@/app/api/solar/projects/[id]/beacon/route";
import { GET as listRevisions } from "@/app/api/solar/projects/[id]/revisions/route";
import { GET as getSession } from "@/app/api/solar/session/route";

// ── Helpers ────────────────────────────────────────────────

function makeRequest(
  url: string,
  options: {
    method?: string;
    body?: unknown;
    csrf?: string | false;
    origin?: string;
    contentLength?: number;
  } = {}
): NextRequest {
  const { method = "GET", body, csrf, origin, contentLength } = options;
  const headers: Record<string, string> = {};

  if (csrf !== false && csrf !== undefined) {
    headers["x-csrf-token"] = csrf;
    headers["cookie"] = `csrf_token=${csrf}`;
  } else if (csrf === false) {
    // Explicitly no CSRF
  } else {
    // Default valid CSRF for mutations
    headers["x-csrf-token"] = "valid-token";
    headers["cookie"] = "csrf_token=valid-token";
  }

  if (origin) {
    headers["origin"] = origin;
  }

  if (body) {
    headers["content-type"] = "application/json";
    const bodyStr = JSON.stringify(body);
    headers["content-length"] = contentLength?.toString() || bodyStr.length.toString();
  } else if (contentLength) {
    headers["content-length"] = contentLength.toString();
  }

  const init: RequestInit = { method, headers };
  if (body) {
    init.body = JSON.stringify(body);
  }

  return new NextRequest(`http://localhost${url}`, init);
}

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

function setupUserMock(user: typeof ADMIN_USER) {
  mockAuthUser = user;
  mockUserFindUnique.mockResolvedValue(user);
}

// ── Tests ──────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  setupUserMock(ADMIN_USER);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. Auth — 401 when unauthenticated
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("Auth", () => {
  it("returns 401 when not authenticated (POST)", async () => {
    mockAuthUser = null;
    const req = makeRequest("/api/solar/projects", {
      method: "POST",
      body: { name: "Test" },
    });
    const res = await createProject(req);
    expect(res.status).toBe(401);
  });

  it("returns 401 when not authenticated (GET list)", async () => {
    mockAuthUser = null;
    mockUserFindUnique.mockResolvedValue(null);
    const req = makeRequest("/api/solar/projects");
    const res = await listProjects(req);
    expect(res.status).toBe(401);
  });

  it("returns 401 when not authenticated (GET project)", async () => {
    mockAuthUser = null;
    mockUserFindUnique.mockResolvedValue(null);
    const req = makeRequest("/api/solar/projects/proj1");
    const res = await getProject(req, makeContext("proj1"));
    expect(res.status).toBe(401);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. CSRF — 403 when missing/invalid
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("CSRF validation", () => {
  it("returns 403 when CSRF header is missing on POST", async () => {
    const req = makeRequest("/api/solar/projects", {
      method: "POST",
      body: { name: "Test" },
      csrf: false,
    });
    const res = await createProject(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("CSRF");
  });

  it("returns 403 when CSRF header doesn't match cookie on PUT", async () => {
    mockProjectFindUnique.mockResolvedValue({
      id: "proj1",
      createdById: ADMIN_USER.id,
      version: 1,
      updatedAt: new Date(),
    });

    const req = new NextRequest("http://localhost/api/solar/projects/proj1", {
      method: "PUT",
      headers: {
        "x-csrf-token": "wrong-token",
        "cookie": "csrf_token=correct-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ version: 1, name: "Updated" }),
    });

    const res = await updateProject(req, makeContext("proj1"));
    expect(res.status).toBe(403);
  });

  it("returns 403 when CSRF header is missing on DELETE", async () => {
    const req = makeRequest("/api/solar/projects/proj1", {
      method: "DELETE",
      csrf: false,
    });
    const res = await archiveProject(req, makeContext("proj1"));
    expect(res.status).toBe(403);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. POST — Create project
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("POST /api/solar/projects", () => {
  it("creates a project with valid data", async () => {
    const newProject = {
      id: "proj-new",
      name: "Test Project",
      address: "123 Main St",
      lat: 39.739,
      lng: -104.985,
      status: "DRAFT",
      version: 1,
      createdById: ADMIN_USER.id,
    };
    mockProjectCreate.mockResolvedValue(newProject);

    const req = makeRequest("/api/solar/projects", {
      method: "POST",
      body: { name: "Test Project", address: "123 Main St", lat: 39.739, lng: -104.985 },
    });

    const res = await createProject(req);
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.data.name).toBe("Test Project");
    expect(mockProjectCreate).toHaveBeenCalledTimes(1);
  });

  it("returns 400 for missing name", async () => {
    const req = makeRequest("/api/solar/projects", {
      method: "POST",
      body: { address: "123 Main St" },
    });

    const res = await createProject(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Validation");
  });

  it("returns 413 for oversized payload", async () => {
    const req = makeRequest("/api/solar/projects", {
      method: "POST",
      body: { name: "Test" },
      contentLength: 6 * 1024 * 1024, // 6MB
    });

    const res = await createProject(req);
    expect(res.status).toBe(413);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. GET — List projects (role-scoped)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("GET /api/solar/projects", () => {
  it("admin sees all projects (no user-scoping)", async () => {
    mockProjectFindMany.mockResolvedValue([
      { id: "p1", name: "Project 1", createdById: "other-user" },
    ]);
    mockProjectCount.mockResolvedValue(1);

    const req = makeRequest("/api/solar/projects");
    const res = await listProjects(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.pagination.total).toBe(1);

    // Admin should NOT have user-scoping OR clause
    const findManyCall = mockProjectFindMany.mock.calls[0][0];
    expect(findManyCall.where.OR).toBeUndefined();
  });

  it("non-admin gets role-scoped results (own + TEAM + shared)", async () => {
    setupUserMock(REGULAR_USER);
    mockProjectFindMany.mockResolvedValue([]);
    mockProjectCount.mockResolvedValue(0);

    const req = makeRequest("/api/solar/projects");
    const res = await listProjects(req);
    expect(res.status).toBe(200);

    // Non-admin should have OR clause for scoping
    const findManyCall = mockProjectFindMany.mock.calls[0][0];
    expect(findManyCall.where.OR).toBeDefined();
    expect(findManyCall.where.OR).toHaveLength(3);
  });

  it("excludes ARCHIVED projects by default", async () => {
    mockProjectFindMany.mockResolvedValue([]);
    mockProjectCount.mockResolvedValue(0);

    const req = makeRequest("/api/solar/projects");
    await listProjects(req);

    const findManyCall = mockProjectFindMany.mock.calls[0][0];
    expect(findManyCall.where.status).toEqual({ not: "ARCHIVED" });
  });

  it("includes ARCHIVED when status=ARCHIVED filter is set", async () => {
    mockProjectFindMany.mockResolvedValue([]);
    mockProjectCount.mockResolvedValue(0);

    const req = makeRequest("/api/solar/projects?status=ARCHIVED");
    await listProjects(req);

    const findManyCall = mockProjectFindMany.mock.calls[0][0];
    expect(findManyCall.where.status).toBe("ARCHIVED");
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 5. GET — Load project + access control
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("GET /api/solar/projects/[id]", () => {
  it("loads a project for admin user", async () => {
    // canReadProject checks
    mockProjectFindUnique
      .mockResolvedValueOnce({ createdById: "other-user", visibility: "TEAM" }) // access check
      .mockResolvedValueOnce({
        id: "proj1",
        name: "Test Project",
        version: 1,
        createdBy: { name: "Other", email: "other@test.com" },
      }); // actual load

    const req = makeRequest("/api/solar/projects/proj1");
    const res = await getProject(req, makeContext("proj1"));
    expect(res.status).toBe(200);
  });

  it("returns 403 for PRIVATE project owned by someone else (non-admin)", async () => {
    setupUserMock(REGULAR_USER);
    mockProjectFindUnique.mockResolvedValueOnce({
      createdById: "other-user",
      visibility: "PRIVATE",
    });
    mockShareFindUnique.mockResolvedValue(null); // no share

    const req = makeRequest("/api/solar/projects/proj1");
    const res = await getProject(req, makeContext("proj1"));
    expect(res.status).toBe(403);
  });

  it("allows READ share on PRIVATE project", async () => {
    setupUserMock(REGULAR_USER);
    mockProjectFindUnique
      .mockResolvedValueOnce({ createdById: "other-user", visibility: "PRIVATE" }) // access check
      .mockResolvedValueOnce({ id: "proj1", name: "Shared", createdBy: { name: "X", email: "x@y.com" } }); // actual load
    mockShareFindUnique.mockResolvedValue({ permission: "READ" });

    const req = makeRequest("/api/solar/projects/proj1");
    const res = await getProject(req, makeContext("proj1"));
    expect(res.status).toBe(200);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 6. PUT — Update + version conflict (409)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("PUT /api/solar/projects/[id]", () => {
  it("updates a project when version matches", async () => {
    // canWriteProject access check
    mockProjectFindUnique
      .mockResolvedValueOnce({ createdById: ADMIN_USER.id }) // write access
      .mockResolvedValueOnce({ // version check
        version: 1,
        updatedAt: new Date(),
        updatedBy: null,
        createdBy: { name: "Admin", email: ADMIN_USER.email },
      });

    mockProjectUpdate.mockResolvedValue({
      id: "proj1",
      name: "Updated",
      version: 2,
    });

    const req = makeRequest("/api/solar/projects/proj1", {
      method: "PUT",
      body: { version: 1, name: "Updated" },
    });

    const res = await updateProject(req, makeContext("proj1"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.version).toBe(2);
  });

  it("returns 409 on version conflict", async () => {
    mockProjectFindUnique
      .mockResolvedValueOnce({ createdById: ADMIN_USER.id }) // write access
      .mockResolvedValueOnce({ // version check — server is ahead
        version: 3,
        updatedAt: new Date("2025-01-15"),
        updatedBy: { name: "Other User", email: "other@test.com" },
        createdBy: { name: "Admin", email: ADMIN_USER.email },
      });

    const req = makeRequest("/api/solar/projects/proj1", {
      method: "PUT",
      body: { version: 1, name: "Stale Update" },
    });

    const res = await updateProject(req, makeContext("proj1"));
    expect(res.status).toBe(409);

    const body = await res.json();
    expect(body.error).toContain("Version conflict");
    expect(body.serverVersion).toBe(3);
    expect(body.serverUpdatedBy).toBe("Other User");
    expect(body.conflictSummary).toContain("version 3");
  });

  it("creates revision when createRevision=true", async () => {
    mockProjectFindUnique
      .mockResolvedValueOnce({ createdById: ADMIN_USER.id }) // write access
      .mockResolvedValueOnce({ // version check
        version: 2,
        updatedAt: new Date(),
        updatedBy: null,
        createdBy: { name: "Admin", email: ADMIN_USER.email },
      });

    const updatedProject = {
      id: "proj1",
      name: "Saved",
      version: 3,
      equipmentConfig: { inverter: "Tesla" },
    };
    mockProjectUpdate.mockResolvedValue(updatedProject);
    mockRevisionCreate.mockResolvedValue({ id: "rev1", version: 3 });

    const req = makeRequest("/api/solar/projects/proj1", {
      method: "PUT",
      body: { version: 2, name: "Saved", createRevision: true, revisionNote: "Manual save" },
    });

    const res = await updateProject(req, makeContext("proj1"));
    expect(res.status).toBe(200);

    // Verify revision was created
    expect(mockRevisionCreate).toHaveBeenCalledTimes(1);
    const revArgs = mockRevisionCreate.mock.calls[0][0];
    expect(revArgs.data.version).toBe(3);
    expect(revArgs.data.note).toBe("Manual save");
    expect(revArgs.data.projectId).toBe("proj1");
  });

  it("does NOT create revision when createRevision=false (autosave)", async () => {
    mockProjectFindUnique
      .mockResolvedValueOnce({ createdById: ADMIN_USER.id })
      .mockResolvedValueOnce({
        version: 2,
        updatedAt: new Date(),
        updatedBy: null,
        createdBy: { name: "Admin", email: ADMIN_USER.email },
      });

    mockProjectUpdate.mockResolvedValue({ id: "proj1", version: 3 });

    const req = makeRequest("/api/solar/projects/proj1", {
      method: "PUT",
      body: { version: 2, name: "Autosave" },
    });

    const res = await updateProject(req, makeContext("proj1"));
    expect(res.status).toBe(200);
    expect(mockRevisionCreate).not.toHaveBeenCalled();
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 7. PUT with forceOverwrite — auto-revision before clobber
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("PUT with forceOverwrite", () => {
  it("creates FORCED_OVERWRITE revision before applying update", async () => {
    mockProjectFindUnique
      .mockResolvedValueOnce({ createdById: ADMIN_USER.id }) // write access
      .mockResolvedValueOnce({ // version check — conflict exists
        version: 5,
        updatedAt: new Date("2025-01-10"),
        updatedBy: { name: "Colleague", email: "coll@test.com" },
        createdBy: { name: "Admin", email: ADMIN_USER.email },
      })
      .mockResolvedValueOnce({ // full project for snapshot
        id: "proj1",
        name: "Before Overwrite",
        version: 5,
        equipmentConfig: { old: true },
        stringsConfig: null,
        siteConditions: null,
        batteryConfig: null,
        lossProfile: null,
        address: null,
        lat: null,
        lng: null,
        status: "ACTIVE",
        visibility: "TEAM",
        geoJsonUrl: null,
        radianceDxfUrl: null,
        shadeDataUrl: null,
        homeConsumptionConfig: null,
      });

    mockRevisionUpsert.mockResolvedValue({ id: "forced-rev", version: 5 });
    mockProjectUpdate.mockResolvedValue({ id: "proj1", name: "Forced Update", version: 6 });

    const req = makeRequest("/api/solar/projects/proj1", {
      method: "PUT",
      body: { version: 2, name: "Forced Update", forceOverwrite: true },
    });

    const res = await updateProject(req, makeContext("proj1"));
    expect(res.status).toBe(200);

    // Verify forced overwrite revision was upserted
    expect(mockRevisionUpsert).toHaveBeenCalledTimes(1);
    const upsertArgs = mockRevisionUpsert.mock.calls[0][0];
    expect(upsertArgs.create.note).toContain("FORCED_OVERWRITE");
    expect(upsertArgs.create.note).toContain(ADMIN_USER.name);
    expect(upsertArgs.create.version).toBe(5); // snapshots the server's version

    // Verify response includes replaced metadata
    const body = await res.json();
    expect(body.replaced).toBeDefined();
    expect(body.replaced.version).toBe(5);
    expect(body.replaced.updatedBy).toBe("Colleague");
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 8. DELETE — Archive project
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("DELETE /api/solar/projects/[id]", () => {
  it("archives a project (soft delete)", async () => {
    mockProjectFindUnique.mockResolvedValueOnce({ createdById: ADMIN_USER.id }); // archive access
    mockProjectUpdate.mockResolvedValue({ id: "proj1", status: "ARCHIVED" });

    const req = makeRequest("/api/solar/projects/proj1", { method: "DELETE" });
    const res = await archiveProject(req, makeContext("proj1"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.status).toBe("ARCHIVED");
  });

  it("returns 403 when shared EDIT user tries to archive", async () => {
    setupUserMock(REGULAR_USER);
    mockProjectFindUnique.mockResolvedValueOnce({ createdById: "other-user" }); // not creator

    const req = makeRequest("/api/solar/projects/proj1", { method: "DELETE" });
    const res = await archiveProject(req, makeContext("proj1"));
    expect(res.status).toBe(403);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 9. Write access — TEAM visibility non-admin
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("Write access control", () => {
  it("non-admin cannot PUT a TEAM-visibility project they don't own", async () => {
    setupUserMock(REGULAR_USER);
    // canWriteProject: not creator, TEAM visibility → denied before share check
    mockProjectFindUnique.mockResolvedValueOnce({ createdById: "other-user", visibility: "TEAM" });
    mockShareFindUnique.mockResolvedValue(null);

    const req = makeRequest("/api/solar/projects/proj1", {
      method: "PUT",
      body: { version: 1, name: "Should Fail" },
    });

    const res = await updateProject(req, makeContext("proj1"));
    expect(res.status).toBe(403);
  });

  it("user with READ share cannot write (PRIVATE project)", async () => {
    setupUserMock(REGULAR_USER);
    mockProjectFindUnique.mockResolvedValueOnce({ createdById: "other-user", visibility: "PRIVATE" });
    mockShareFindUnique.mockResolvedValue({ permission: "READ" });

    const req = makeRequest("/api/solar/projects/proj1", {
      method: "PUT",
      body: { version: 1, name: "Should Fail" },
    });

    const res = await updateProject(req, makeContext("proj1"));
    expect(res.status).toBe(403);
  });

  it("user with EDIT share on TEAM project is DENIED write", async () => {
    setupUserMock(REGULAR_USER);
    // TEAM visibility: EDIT shares do NOT grant write — only creator or elevated roles
    mockProjectFindUnique.mockResolvedValueOnce({ createdById: "other-user", visibility: "TEAM" });
    // Share should not even be checked, but mock it to verify it's bypassed
    mockShareFindUnique.mockResolvedValue({ permission: "EDIT" });

    const req = makeRequest("/api/solar/projects/proj1", {
      method: "PUT",
      body: { version: 1, name: "Should Fail" },
    });

    const res = await updateProject(req, makeContext("proj1"));
    expect(res.status).toBe(403);
    // Verify share was NOT queried (early return on TEAM visibility)
    expect(mockShareFindUnique).not.toHaveBeenCalled();
  });

  it("user with EDIT share can write (PRIVATE project)", async () => {
    setupUserMock(REGULAR_USER);
    mockProjectFindUnique
      .mockResolvedValueOnce({ createdById: "other-user", visibility: "PRIVATE" }) // canWriteProject
      .mockResolvedValueOnce({ // version check
        version: 1,
        updatedAt: new Date(),
        updatedBy: null,
        createdBy: { name: "Owner", email: "owner@test.com" },
      });
    mockShareFindUnique.mockResolvedValue({ permission: "EDIT" });
    mockProjectUpdate.mockResolvedValue({ id: "proj1", name: "Shared Edit", version: 2 });

    const req = makeRequest("/api/solar/projects/proj1", {
      method: "PUT",
      body: { version: 1, name: "Shared Edit" },
    });

    const res = await updateProject(req, makeContext("proj1"));
    expect(res.status).toBe(200);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 10. Beacon — CSRF + Origin validation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("POST /api/solar/projects/[id]/beacon", () => {
  it("returns 403 when Origin does not match app origin", async () => {
    const req = new NextRequest("http://localhost/api/solar/projects/proj1/beacon", {
      method: "POST",
      headers: {
        origin: "https://evil-site.com",
        cookie: "csrf_token=valid",
        "content-type": "application/json",
      },
      body: JSON.stringify({ csrfToken: "valid", version: 1, dirtyFlag: true }),
    });

    const res = await beacon(req, makeContext("proj1"));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("Origin");
  });

  it("returns 403 when Origin header is missing", async () => {
    const req = new NextRequest("http://localhost/api/solar/projects/proj1/beacon", {
      method: "POST",
      headers: {
        cookie: "csrf_token=valid",
        "content-type": "application/json",
      },
      body: JSON.stringify({ csrfToken: "valid", version: 1, dirtyFlag: true }),
    });

    const res = await beacon(req, makeContext("proj1"));
    expect(res.status).toBe(403);
  });

  it("returns 403 when body CSRF doesn't match cookie", async () => {
    const req = new NextRequest("http://localhost/api/solar/projects/proj1/beacon", {
      method: "POST",
      headers: {
        origin: "http://localhost",
        cookie: "csrf_token=correct-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ csrfToken: "wrong-token", version: 1, dirtyFlag: true }),
    });

    const res = await beacon(req, makeContext("proj1"));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("CSRF");
  });

  it("upserts SolarPendingState on valid beacon", async () => {
    mockProjectFindUnique.mockResolvedValueOnce({ createdById: ADMIN_USER.id }); // write access
    mockPendingUpsert.mockResolvedValue({});

    const req = new NextRequest("http://localhost/api/solar/projects/proj1/beacon", {
      method: "POST",
      headers: {
        origin: "http://localhost",
        cookie: "csrf_token=valid-beacon-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ csrfToken: "valid-beacon-token", version: 3, dirtyFlag: true }),
    });

    const res = await beacon(req, makeContext("proj1"));
    expect(res.status).toBe(200);

    expect(mockPendingUpsert).toHaveBeenCalledTimes(1);
    const upsertArgs = mockPendingUpsert.mock.calls[0][0];
    expect(upsertArgs.where.projectId_userId).toEqual({
      projectId: "proj1",
      userId: ADMIN_USER.id,
    });
    expect(upsertArgs.update.version).toBe(3);
    expect(upsertArgs.create.version).toBe(3);
  });

  it("returns 413 for oversized beacon payload", async () => {
    const req = new NextRequest("http://localhost/api/solar/projects/proj1/beacon", {
      method: "POST",
      headers: {
        origin: "http://localhost",
        "content-length": "2048",
        cookie: "csrf_token=valid",
        "content-type": "application/json",
      },
      body: JSON.stringify({ csrfToken: "valid", version: 1, dirtyFlag: true }),
    });

    const res = await beacon(req, makeContext("proj1"));
    expect(res.status).toBe(413);
  });

  it("two users beaconing same project create separate pending rows", async () => {
    // First user
    mockProjectFindUnique.mockResolvedValue({ createdById: ADMIN_USER.id });
    mockPendingUpsert.mockResolvedValue({});

    const req1 = new NextRequest("http://localhost/api/solar/projects/proj1/beacon", {
      method: "POST",
      headers: {
        origin: "http://localhost",
        cookie: "csrf_token=token1",
        "content-type": "application/json",
      },
      body: JSON.stringify({ csrfToken: "token1", version: 3, dirtyFlag: true }),
    });

    await beacon(req1, makeContext("proj1"));
    const firstCall = mockPendingUpsert.mock.calls[0][0];
    expect(firstCall.where.projectId_userId.userId).toBe(ADMIN_USER.id);

    // Second user
    jest.clearAllMocks();
    setupUserMock(REGULAR_USER);
    mockProjectFindUnique.mockResolvedValue({ createdById: ADMIN_USER.id });
    mockShareFindUnique.mockResolvedValue({ permission: "EDIT" });
    mockPendingUpsert.mockResolvedValue({});

    const req2 = new NextRequest("http://localhost/api/solar/projects/proj1/beacon", {
      method: "POST",
      headers: {
        origin: "http://localhost",
        cookie: "csrf_token=token2",
        "content-type": "application/json",
      },
      body: JSON.stringify({ csrfToken: "token2", version: 4, dirtyFlag: true }),
    });

    await beacon(req2, makeContext("proj1"));
    const secondCall = mockPendingUpsert.mock.calls[0][0];
    expect(secondCall.where.projectId_userId.userId).toBe(REGULAR_USER.id);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 11. Revisions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("GET /api/solar/projects/[id]/revisions", () => {
  it("lists revisions for a project the user can read", async () => {
    mockProjectFindUnique.mockResolvedValueOnce({ createdById: ADMIN_USER.id, visibility: "TEAM" });
    mockRevisionFindMany.mockResolvedValue([
      { id: "rev1", version: 1, note: "Initial", createdAt: new Date(), createdBy: { name: "Admin", email: ADMIN_USER.email } },
      { id: "rev2", version: 2, note: "Analysis run", createdAt: new Date(), createdBy: { name: "Admin", email: ADMIN_USER.email } },
    ]);

    const req = makeRequest("/api/solar/projects/proj1/revisions");
    const res = await listRevisions(req, makeContext("proj1"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toHaveLength(2);
    expect(body.data[0].version).toBe(1);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 12. Session endpoint
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("GET /api/solar/session", () => {
  it("returns user info + pending states + CSRF cookie", async () => {
    mockPendingFindMany.mockResolvedValue([
      {
        id: "pending1",
        projectId: "proj1",
        project: { name: "My Project" },
        version: 5,
        createdAt: new Date(),
      },
    ]);

    const req = makeRequest("/api/solar/session");
    const res = await getSession(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.email).toBe(ADMIN_USER.email);
    expect(body.data.csrfToken).toBeDefined();
    expect(body.data.pendingStates).toHaveLength(1);
    expect(body.data.pendingStates[0].projectName).toBe("My Project");

    // Check Set-Cookie header
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toContain("csrf_token=");
    expect(setCookie).toContain("SameSite=Lax");
    if (process.env.NODE_ENV === "production") {
      expect(setCookie).toContain("Secure");
    }
  });
});
