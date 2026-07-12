// src/__tests__/vishtik-parse.test.ts
import { parseProjNumber, detailUrl } from "@/lib/vishtik";
import { CookieJar } from "@/lib/vishtik";
import { fetchAllProjects, getProjectParams, type VishtikTransport } from "@/lib/vishtik";

describe("parseProjNumber", () => {
  it("extracts PROJ token from standard name", () => {
    expect(parseProjNumber("PROJ-9689 | Xu, Sarah")).toBe("PROJ-9689");
  });
  it("extracts PROJ token with D&R prefix", () => {
    expect(parseProjNumber("D&R | PROJ-8455 | Pine, Tim")).toBe("PROJ-8455");
  });
  it("returns null when no PROJ token", () => {
    expect(parseProjNumber("D&R | Mongait, Peter")).toBeNull();
  });
});

describe("detailUrl", () => {
  it("builds the Vishtik detail URL", () => {
    expect(detailUrl("6947")).toBe(
      "https://project.vishtik.com/Project/Project/Project-Details?id=6947",
    );
  });
});

describe("CookieJar", () => {
  it("stores cookies from set-cookie and serializes a Cookie header", () => {
    const jar = new CookieJar();
    jar.absorb(["ci_session=abc; Path=/; HttpOnly", "ci_csrf_token=tok123; Path=/"]);
    expect(jar.header()).toContain("ci_session=abc");
    expect(jar.header()).toContain("ci_csrf_token=tok123");
  });
  it("exposes the csrf token value by cookie name", () => {
    const jar = new CookieJar();
    jar.absorb(["ci_csrf_token=tok123; Path=/"]);
    expect(jar.value("ci_csrf_token")).toBe("tok123");
  });
  it("later cookies overwrite earlier ones of the same name", () => {
    const jar = new CookieJar();
    jar.absorb(["ci_session=old; Path=/"]);
    jar.absorb(["ci_session=new; Path=/"]);
    expect(jar.value("ci_session")).toBe("new");
  });
});

/** Fake server: a fixed row list served by offset/limit, like live Vishtik. */
function fakeTransport(
  rows: { id: string; customer_name: string; status: string }[],
  overrides?: { serveOffset?: (offset: number) => number },
): VishtikTransport & { calls: { offset: number; limit: number }[] } {
  const calls: { offset: number; limit: number }[] = [];
  return {
    calls,
    async login() {/* no-op */},
    async getProjectPage({ offset, limit }) {
      calls.push({ offset, limit });
      const effective = overrides?.serveOffset ? overrides.serveOffset(offset) : offset;
      return {
        data: rows.slice(effective, effective + limit),
        total_page: Math.ceil(rows.length / limit),
        current_page: Math.floor(effective / limit) + 1,
        total_row: rows.length,
      };
    },
  };
}

function makeRows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: String(i + 1),
    customer_name: `PROJ-${i + 1} | Customer ${i + 1}`,
    status: "4",
  }));
}

describe("fetchAllProjects", () => {
  it("collects the full list across offset pages, including rows past the old ~2280 tile cap", async () => {
    const rows = makeRows(2500);
    const t = fakeTransport(rows);
    const { projects, complete } = await fetchAllProjects(t);
    expect(complete).toBe(true);
    expect(projects).toHaveLength(2500);
    expect(projects.find((p) => p.vishtikId === "1")?.projNumber).toBe("PROJ-1");
    expect(projects.find((p) => p.vishtikId === "2500")).toBeDefined();
    // Pages advance by offset, not by a page counter.
    expect(t.calls[0]).toEqual({ offset: 0, limit: 100 });
    expect(t.calls[1]).toEqual({ offset: 100, limit: 100 });
  });

  it("marks complete:false when fetched rows fall well short of total_row", async () => {
    const rows = makeRows(1000);
    // Server ignores the offset and always serves the head page.
    const t = fakeTransport(rows, { serveOffset: () => 0 });
    const { complete } = await fetchAllProjects(t);
    expect(complete).toBe(false);
  });

  it("stops fetching (rather than looping) when the server ignores the offset", async () => {
    const rows = makeRows(1000);
    const t = fakeTransport(rows, { serveOffset: () => 0 });
    await fetchAllProjects(t);
    expect(t.calls.length).toBe(2); // first page + one stuck page, then bail
  });

  it("handles an empty project list", async () => {
    const t = fakeTransport([]);
    const { projects, complete } = await fetchAllProjects(t);
    expect(projects).toHaveLength(0);
    expect(complete).toBe(true);
  });
});

describe("getProjectParams", () => {
  it("maps offset to recorddata and limit to showtotal (the original sync bug reversed this)", () => {
    const p = getProjectParams(400, 200);
    expect(p.recorddata).toBe("400");
    expect(p.showtotal).toBe("200");
  });
});
