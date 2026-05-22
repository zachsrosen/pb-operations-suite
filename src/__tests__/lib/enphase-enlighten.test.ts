jest.mock("@/lib/db", () => ({
  prisma: {
    systemConfig: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  },
}));

import { computeEnphasePortalUrl } from "@/lib/enphase-enlighten";

describe("computeEnphasePortalUrl", () => {
  let savedTemplate: string | undefined;
  beforeEach(() => {
    savedTemplate = process.env.ENPHASE_PORTAL_URL_TEMPLATE;
  });
  afterEach(() => {
    if (savedTemplate === undefined) {
      delete process.env.ENPHASE_PORTAL_URL_TEMPLATE;
    } else {
      process.env.ENPHASE_PORTAL_URL_TEMPLATE = savedTemplate;
    }
  });

  it("uses the default Enlighten URL when env var is unset", () => {
    delete process.env.ENPHASE_PORTAL_URL_TEMPLATE;
    expect(computeEnphasePortalUrl(12345)).toBe(
      "https://enlighten.enphaseenergy.com/systems/12345"
    );
  });

  it("uses the configured template when env var is set", () => {
    process.env.ENPHASE_PORTAL_URL_TEMPLATE = "https://custom.com/sys/{systemId}/view";
    expect(computeEnphasePortalUrl(99999)).toBe("https://custom.com/sys/99999/view");
  });

  it("returns null for 0 systemId", () => {
    expect(computeEnphasePortalUrl(0)).toBeNull();
  });
});
