import { PlansetAnalyzer } from "@/lib/pe-crossref/analyzers/planset";
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

describe("PlansetAnalyzer", () => {
  it("emits nothing when no audit run is available", async () => {
    const tasks = await PlansetAnalyzer.detectTasks(baseContext());
    expect(tasks).toHaveLength(0);
  });

  it("emits nothing when audit ran but no planset vision result captured", async () => {
    const tasks = await PlansetAnalyzer.detectTasks(
      baseContext({
        latestAuditRun: {
          runId: "r1",
          photoAssignments: new Map(),
          plansetVisionResult: null,
        },
      }),
    );
    expect(tasks).toHaveLength(0);
  });

  it("emits P10 when PW3 placeholder 1707000-XX-Y appears in issues — extracts PV page", async () => {
    const tasks = await PlansetAnalyzer.detectTasks(
      baseContext({
        latestAuditRun: {
          runId: "r1",
          photoAssignments: new Map(),
          plansetVisionResult: {
            plansetFileId: "abc",
            plansetFileName: "PROJ9542.pdf",
            issues: [
              "CRITICAL: Tesla Powerwall 3 model number shows 1707000-XX-Y on electrical line diagram (PV-5) — must specify variant.",
            ],
            equipmentVisible: [],
          },
        },
      }),
    );
    const p10 = tasks.find((t) => t.pCode === "P10");
    expect(p10).toBeDefined();
    expect(p10?.identityKey).toBe("P10@v1:planset:abc:pw3-generic:p5");
    expect(p10?.severity).toBe("conditional");
    expect(p10?.message).toContain("PV-5");
    expect((p10?.evidence as { page: number }).page).toBe(5);
  });

  it("emits P10B when BS placeholder 1624171-XX-Y appears in equipmentVisible", async () => {
    const tasks = await PlansetAnalyzer.detectTasks(
      baseContext({
        latestAuditRun: {
          runId: "r1",
          photoAssignments: new Map(),
          plansetVisionResult: {
            plansetFileId: "abc",
            plansetFileName: "x.pdf",
            issues: [],
            equipmentVisible: ["Tesla Backup Switch 200A (1624171-XX-Y)"],
          },
        },
      }),
    );
    const p10b = tasks.find((t) => t.pCode === "P10B");
    expect(p10b).toBeDefined();
    expect(p10b?.identityKey).toBe("P10B@v1:planset:abc:bs-generic");
    expect(p10b?.action).toContain("1624171-00-E");
  });

  it("emits P10C when Expansion Unit placeholder 1807000-XX-Y appears", async () => {
    const tasks = await PlansetAnalyzer.detectTasks(
      baseContext({
        latestAuditRun: {
          runId: "r1",
          photoAssignments: new Map(),
          plansetVisionResult: {
            plansetFileId: "abc",
            plansetFileName: "x.pdf",
            issues: ["Expansion Unit shows 1807000-XX-Y on PV-6"],
            equipmentVisible: [],
          },
        },
      }),
    );
    const p10c = tasks.find((t) => t.pCode === "P10C");
    expect(p10c).toBeDefined();
    expect(p10c?.identityKey).toBe("P10C@v1:planset:abc:exp-generic:p6");
  });

  it("emits multiple P-codes when multiple placeholders appear", async () => {
    const tasks = await PlansetAnalyzer.detectTasks(
      baseContext({
        latestAuditRun: {
          runId: "r1",
          photoAssignments: new Map(),
          plansetVisionResult: {
            plansetFileId: "abc",
            plansetFileName: "x.pdf",
            issues: [
              "Tesla Powerwall 3 shows 1707000-XX-Y on PV-5",
              "Backup Switch shows 1624171-XX-Y",
            ],
            equipmentVisible: ["1807000-XX-Y expansion unit"],
          },
        },
      }),
    );
    expect(tasks.map((t) => t.pCode).sort()).toEqual(["P10", "P10B", "P10C"]);
  });

  it("does NOT emit when the planset already specifies the variant (no XX-Y placeholder)", async () => {
    const tasks = await PlansetAnalyzer.detectTasks(
      baseContext({
        latestAuditRun: {
          runId: "r1",
          photoAssignments: new Map(),
          plansetVisionResult: {
            plansetFileId: "abc",
            plansetFileName: "x.pdf",
            issues: ["Plan set looks good."],
            equipmentVisible: ["Tesla Powerwall 3 (1707000-21-Y) - qty 2", "Tesla Backup Switch (1624171-00-E)"],
          },
        },
      }),
    );
    expect(tasks).toHaveLength(0);
  });

  it("identity key includes plansetFileId so revised plansets auto-resolve old tasks", async () => {
    const make = (fileId: string) =>
      PlansetAnalyzer.detectTasks(
        baseContext({
          latestAuditRun: {
            runId: "r1",
            photoAssignments: new Map(),
            plansetVisionResult: {
              plansetFileId: fileId,
              plansetFileName: "x.pdf",
              issues: ["Tesla Powerwall 3 shows 1707000-XX-Y on PV-5"],
              equipmentVisible: [],
            },
          },
        }),
      );
    const oldTasks = await make("planset-v1");
    const newTasks = await make("planset-v2");
    expect(oldTasks[0].identityKey).not.toBe(newTasks[0].identityKey);
  });
});
