import { isComplianceV2Enabled } from "@/lib/compliance-v2/feature-flag";

describe("isComplianceV2Enabled", () => {
  const origEnv = process.env.COMPLIANCE_V2_ENABLED;
  afterEach(() => {
    if (origEnv === undefined) delete process.env.COMPLIANCE_V2_ENABLED;
    else process.env.COMPLIANCE_V2_ENABLED = origEnv;
  });

  it("returns true when env var is 'true'", () => {
    process.env.COMPLIANCE_V2_ENABLED = "true";
    expect(isComplianceV2Enabled()).toBe(true);
  });
  it("returns true when env var is 'TRUE'", () => {
    process.env.COMPLIANCE_V2_ENABLED = "TRUE";
    expect(isComplianceV2Enabled()).toBe(true);
  });
  it("returns false when env var is 'false'", () => {
    process.env.COMPLIANCE_V2_ENABLED = "false";
    expect(isComplianceV2Enabled()).toBe(false);
  });
  it("returns false when env var is unset", () => {
    delete process.env.COMPLIANCE_V2_ENABLED;
    expect(isComplianceV2Enabled()).toBe(false);
  });
  it("returns false when env var is any other string", () => {
    process.env.COMPLIANCE_V2_ENABLED = "yes";
    expect(isComplianceV2Enabled()).toBe(false);
  });
});
