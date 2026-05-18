import { MonitoringAnalyzer } from "@/lib/pe-crossref/analyzers/monitoring";
import type { CrossRefContext } from "@/lib/pe-crossref/types";

const baseContext = (overrides: Partial<CrossRefContext> = {}): CrossRefContext => ({
  deal: {
    dealId: "d1",
    dealName: "Test",
    address: "",
    systemType: "solar+battery",
    stageName: "PTO",
    peM1Status: null,
    peM2Status: null,
    rootFolderId: "root",
    designFolderId: null,
  },
  planset: null,
  salesOrder: null,
  powerHubAsset: null,
  installPhotos: [],
  nameplateExtractions: new Map(),
  monitoringFolder: null,
  latestAuditRun: null,
  ...overrides,
});

describe("MonitoringAnalyzer", () => {
  it("emits MONITORING when a corrected screenshot exists in M1 folder", async () => {
    const tasks = await MonitoringAnalyzer.detectTasks(
      baseContext({
        monitoringFolder: {
          m1FolderId: "m1",
          hasOriginalScreenshot: true,
          correctedScreenshotFile: {
            id: "c",
            name: "PowerHub_corrected.png",
            modifiedTime: "2026-05-10T00:00:00Z",
          },
        },
      }),
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0].pCode).toBe("MONITORING");
    expect(tasks[0].identityKey).toBe("MONITORING@v1:m1-folder:powerhub-corrected");
    expect(tasks[0].severity).toBe("monitoring");
    expect(tasks[0].evidence).toEqual({
      fileId: "c",
      fileName: "PowerHub_corrected.png",
      modifiedTime: "2026-05-10T00:00:00Z",
    });
  });

  it("does NOT emit MONITORING when no corrected screenshot exists", async () => {
    const tasks = await MonitoringAnalyzer.detectTasks(
      baseContext({
        monitoringFolder: {
          m1FolderId: "m1",
          hasOriginalScreenshot: true,
          correctedScreenshotFile: null,
        },
      }),
    );
    expect(tasks.find((t) => t.pCode === "MONITORING")).toBeUndefined();
  });

  it("emits ENPHASE when planset has Enphase inverter and no monitoring screenshot exists", async () => {
    const tasks = await MonitoringAnalyzer.detectTasks(
      baseContext({
        planset: {
          fileId: "p1",
          fileName: "plans.pdf",
          specsByPage: [
            {
              page: 4,
              pw3Model: null,
              bsModel: null,
              expansionUnitModel: null,
              moduleBrand: null,
              moduleQty: null,
              inverterModel: "Enphase IQ8",
            },
          ],
        },
        monitoringFolder: {
          m1FolderId: "m1",
          hasOriginalScreenshot: false,
          correctedScreenshotFile: null,
        },
      }),
    );
    const t = tasks.find((t) => t.pCode === "ENPHASE");
    expect(t).toBeDefined();
    expect(t?.identityKey).toBe("ENPHASE@v1:account-access");
    expect(t?.evidence).toEqual({ detectedInverter: "Enphase IQ8", page: 4 });
  });

  it("does NOT emit ENPHASE when a monitoring screenshot already exists", async () => {
    const tasks = await MonitoringAnalyzer.detectTasks(
      baseContext({
        planset: {
          fileId: "p1",
          fileName: "plans.pdf",
          specsByPage: [
            {
              page: 4,
              pw3Model: null,
              bsModel: null,
              expansionUnitModel: null,
              moduleBrand: null,
              moduleQty: null,
              inverterModel: "Enphase IQ8",
            },
          ],
        },
        monitoringFolder: {
          m1FolderId: "m1",
          hasOriginalScreenshot: true,
          correctedScreenshotFile: null,
        },
      }),
    );
    expect(tasks.find((t) => t.pCode === "ENPHASE")).toBeUndefined();
  });

  it("does NOT emit ENPHASE for non-Enphase inverters", async () => {
    const tasks = await MonitoringAnalyzer.detectTasks(
      baseContext({
        planset: {
          fileId: "p1",
          fileName: "plans.pdf",
          specsByPage: [
            {
              page: 4,
              pw3Model: null,
              bsModel: null,
              expansionUnitModel: null,
              moduleBrand: null,
              moduleQty: null,
              inverterModel: "Tesla Solar Inverter 7.6kW",
            },
          ],
        },
        monitoringFolder: {
          m1FolderId: "m1",
          hasOriginalScreenshot: false,
          correctedScreenshotFile: null,
        },
      }),
    );
    expect(tasks.find((t) => t.pCode === "ENPHASE")).toBeUndefined();
  });

  it("emits nothing when monitoringFolder is null", async () => {
    const tasks = await MonitoringAnalyzer.detectTasks(baseContext());
    expect(tasks).toHaveLength(0);
  });
});
