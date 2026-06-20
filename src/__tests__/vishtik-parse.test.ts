// src/__tests__/vishtik-parse.test.ts
import { parseProjNumber, detailUrl } from "@/lib/vishtik";
import { CookieJar } from "@/lib/vishtik";
import { fetchAllProjects, type VishtikTransport } from "@/lib/vishtik";

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

function fakeTransport(pages: Record<number, { data: { id: string; customer_name: string; status: string }[]; total_page: number; current_page: number; total_row: number }>): VishtikTransport {
  return {
    async login() {/* no-op */},
    async getProjectPage({ cntr }) {
      return pages[cntr] ?? { data: [], total_page: 1, current_page: cntr, total_row: 0 };
    },
  };
}

describe("fetchAllProjects", () => {
  it("collects projects across normal cntr pages and de-dupes by id", async () => {
    const t = fakeTransport({
      1: { data: [{ id: "1", customer_name: "PROJ-1 | A", status: "4" }], total_page: 2, current_page: 1, total_row: 2 },
      2: { data: [{ id: "2", customer_name: "PROJ-2 | B", status: "16" }], total_page: 2, current_page: 2, total_row: 2 },
    });
    const { projects, complete } = await fetchAllProjects(t);
    expect(complete).toBe(true);
    expect(projects.map((p) => p.vishtikId).sort()).toEqual(["1", "2"]);
    expect(projects.find((p) => p.vishtikId === "1")?.projNumber).toBe("PROJ-1");
  });

  it("marks complete:false when fetched rows fall well short of total_row", async () => {
    const t = fakeTransport({
      1: { data: [{ id: "1", customer_name: "PROJ-1 | A", status: "4" }], total_page: 1, current_page: 1, total_row: 1000 },
    });
    const { complete } = await fetchAllProjects(t);
    expect(complete).toBe(false);
  });
});
