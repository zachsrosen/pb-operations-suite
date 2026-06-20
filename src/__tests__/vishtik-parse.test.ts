// src/__tests__/vishtik-parse.test.ts
import { parseProjNumber, detailUrl } from "@/lib/vishtik";
import { CookieJar } from "@/lib/vishtik";

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
