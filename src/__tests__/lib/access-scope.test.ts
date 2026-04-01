import { ROLE_SCOPE_TYPE, getScopeTypeForRole } from "@/lib/access-scope";

describe("access-scope", () => {
  it("maps roles to the correct default scope types", () => {
    expect(ROLE_SCOPE_TYPE.ADMIN).toBe("global");
    expect(ROLE_SCOPE_TYPE.EXECUTIVE).toBe("global");
    expect(ROLE_SCOPE_TYPE.OPERATIONS_MANAGER).toBe("global");
    expect(ROLE_SCOPE_TYPE.PROJECT_MANAGER).toBe("global");
    expect(ROLE_SCOPE_TYPE.SALES_MANAGER).toBe("global");
    expect(ROLE_SCOPE_TYPE.TECH_OPS).toBe("global");
    expect(ROLE_SCOPE_TYPE.OPERATIONS).toBe("location");
    expect(ROLE_SCOPE_TYPE.VIEWER).toBe("location");
    expect(ROLE_SCOPE_TYPE.SALES).toBe("owner");
  });

  it("maps legacy roles through their normalized role", () => {
    expect(getScopeTypeForRole("MANAGER")).toBe("global");
    expect(getScopeTypeForRole("DESIGNER")).toBe("global");
    expect(getScopeTypeForRole("PERMITTING")).toBe("global");
    expect(getScopeTypeForRole("OWNER")).toBe("global");
  });
});
