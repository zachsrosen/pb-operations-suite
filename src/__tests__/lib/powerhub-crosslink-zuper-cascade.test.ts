import { cascadeUrlToJobs } from "@/lib/zuper-property-sync";
import { prisma } from "@/lib/db";

jest.mock("@/lib/db", () => ({
  prisma: {
    hubSpotPropertyCache: { findUnique: jest.fn() },
    zuperJobCache: { findMany: jest.fn() },
  },
}));

const fetchMock = jest.fn();
global.fetch = fetchMock as unknown as typeof fetch;

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe("cascadeUrlToJobs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock.mockReset();
    process.env.POWERHUB_CROSSLINK_ENABLED = "true";
    process.env.POWERHUB_ZUPER_CASCADE_ENABLED = "true";
    process.env.ZUPER_API_KEY = "test-key";
    process.env.ZUPER_API_URL = "https://test.zuperpro.com/api";
  });

  it("no-ops when POWERHUB_ZUPER_CASCADE_ENABLED is off", async () => {
    process.env.POWERHUB_ZUPER_CASCADE_ENABLED = "false";
    await cascadeUrlToJobs("prop-1");
    expect(mockPrisma.zuperJobCache.findMany).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("no-ops when property has no teslaPortalUrl", async () => {
    (mockPrisma.hubSpotPropertyCache.findUnique as jest.Mock).mockResolvedValue({
      id: "prop-1", teslaPortalUrl: null, teslaSiteId: null,
      dealLinks: [{ dealId: "d1" }],
    });

    await cascadeUrlToJobs("prop-1");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("updates every linked job's Tesla PowerHub custom field", async () => {
    (mockPrisma.hubSpotPropertyCache.findUnique as jest.Mock).mockResolvedValue({
      id: "prop-1",
      teslaPortalUrl: "https://x",
      teslaSiteId: "tesla-1",
      dealLinks: [{ dealId: "d1" }, { dealId: "d2" }],
    });
    (mockPrisma.zuperJobCache.findMany as jest.Mock).mockResolvedValue([
      { jobUid: "job-1", hubspotDealId: "d1" },
      { jobUid: "job-2", hubspotDealId: "d2" },
    ]);
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { custom_fields: [] } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { custom_fields: [] } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    await cascadeUrlToJobs("prop-1");

    expect(fetchMock).toHaveBeenCalledTimes(4);
    const putCall1 = fetchMock.mock.calls[1];
    expect(putCall1[0]).toContain("/jobs");
    const body1 = JSON.parse(putCall1[1].body);
    expect(body1.job.custom_fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Tesla PowerHub", value: "https://x" }),
        expect.objectContaining({ label: "Tesla Site ID", value: "tesla-1" }),
      ])
    );
  });

  it("preserves existing unrelated custom fields via mergeZuperMetaData", async () => {
    (mockPrisma.hubSpotPropertyCache.findUnique as jest.Mock).mockResolvedValue({
      id: "prop-1",
      teslaPortalUrl: "https://x",
      teslaSiteId: "tesla-1",
      dealLinks: [{ dealId: "d1" }],
    });
    (mockPrisma.zuperJobCache.findMany as jest.Mock).mockResolvedValue([
      { jobUid: "job-1", hubspotDealId: "d1" },
    ]);
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            custom_fields: [
              { label: "Module Wattage", value: "400", type: "NUMBER" },
              { label: "Customer Phone", value: "555-0100", type: "SINGLE_LINE" },
            ],
          },
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    await cascadeUrlToJobs("prop-1");

    const putBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    const labels = putBody.job.custom_fields.map((f: { label: string }) => f.label);
    expect(labels).toEqual(
      expect.arrayContaining(["Module Wattage", "Customer Phone", "Tesla PowerHub", "Tesla Site ID"])
    );
  });

  it("continues if one job update fails", async () => {
    (mockPrisma.hubSpotPropertyCache.findUnique as jest.Mock).mockResolvedValue({
      id: "prop-1",
      teslaPortalUrl: "https://x",
      teslaSiteId: "tesla-1",
      dealLinks: [{ dealId: "d1" }, { dealId: "d2" }],
    });
    (mockPrisma.zuperJobCache.findMany as jest.Mock).mockResolvedValue([
      { jobUid: "job-1", hubspotDealId: "d1" },
      { jobUid: "job-2", hubspotDealId: "d2" },
    ]);
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { custom_fields: [] } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    await expect(cascadeUrlToJobs("prop-1")).resolves.not.toThrow();
    const putCall = fetchMock.mock.calls.find((c: unknown[]) => (c[1] as { method?: string }).method === "PUT");
    expect(putCall).toBeDefined();
  });
});
