import { HardwareAnalyzer } from "@/lib/pe-crossref/analyzers/hardware";
import type { CrossRefContext, NameplateData } from "@/lib/pe-crossref/types";

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

const nameplate = (model: string | null, overrides: Partial<NameplateData> = {}): NameplateData => ({
  photoFileId: `p-${model ?? "null"}`,
  detectedModel: model,
  detectedSerial: null,
  notes: "",
  ...overrides,
});

describe("HardwareAnalyzer", () => {
  it("emits nothing when PowerHub data is missing", async () => {
    const tasks = await HardwareAnalyzer.detectTasks(baseContext());
    expect(tasks).toHaveLength(0);
  });

  it("emits P1 WRONG HARDWARE when nameplate and PowerHub disagree — critical severity", async () => {
    const tasks = await HardwareAnalyzer.detectTasks(
      baseContext({
        powerHubAsset: { siteId: "s1", powerwallEntries: [{ model: "1707000-21-Y" }] },
        nameplateExtractions: new Map([
          ["p1", nameplate("1707000-11-M", { detectedSerial: "TG12530600006T5" })],
        ]),
      }),
    );
    const p1 = tasks.find((t) => t.pCode === "P1");
    expect(p1).toBeDefined();
    expect(p1?.severity).toBe("critical");
    expect(p1?.identityKey).toBe("P1@v1:powerhub:1707000-21-Y:nameplate:1707000-11-M");
    expect(p1?.message).toContain("TG12530600006T5");
    expect(p1?.action).toContain("Zuper Additional Visits");
  });

  it("includes LEADER hint in message when nameplate notes contain LEADER", async () => {
    const tasks = await HardwareAnalyzer.detectTasks(
      baseContext({
        powerHubAsset: { siteId: "s1", powerwallEntries: [{ model: "1707000-21-Y" }] },
        nameplateExtractions: new Map([
          ["p1", nameplate("1707000-11-M", { notes: "LEADER sticker visible" })],
        ]),
      }),
    );
    const p1 = tasks.find((t) => t.pCode === "P1");
    expect(p1?.message).toContain("LEADER sticker visible");
  });

  it("emits P1 NEEDS VERIFICATION (major) when PowerHub data exists but no nameplate extracted", async () => {
    const tasks = await HardwareAnalyzer.detectTasks(
      baseContext({
        powerHubAsset: { siteId: "s1", powerwallEntries: [{ model: "1707000-21-Y" }] },
        nameplateExtractions: new Map(),
      }),
    );
    const t = tasks.find((t) => t.identityKey === "P1@v1:no-nameplate-photo");
    expect(t).toBeDefined();
    expect(t?.severity).toBe("major");
    expect(t?.action).toContain("Photo_10");
  });

  it("emits P6 POWERHUB MIXED (critical) when PowerHub returns multiple PW3 variants", async () => {
    const tasks = await HardwareAnalyzer.detectTasks(
      baseContext({
        powerHubAsset: {
          siteId: "s1",
          powerwallEntries: [{ model: "1707000-11-M" }, { model: "1707000-21-Y" }],
        },
      }),
    );
    const p6 = tasks.find((t) => t.pCode === "P6");
    expect(p6).toBeDefined();
    expect(p6?.severity).toBe("critical");
    expect(p6?.identityKey).toBe("P6@v1:powerhub:mixed:1707000-11-M+1707000-21-Y");
    expect(p6?.message).toContain("1707000-11-M + 1707000-21-Y");
  });

  it("emits nothing when nameplate matches PowerHub", async () => {
    const tasks = await HardwareAnalyzer.detectTasks(
      baseContext({
        powerHubAsset: { siteId: "s1", powerwallEntries: [{ model: "1707000-21-Y" }] },
        nameplateExtractions: new Map([
          ["p1", nameplate("1707000-21-Y")],
        ]),
      }),
    );
    expect(tasks).toHaveLength(0);
  });

  it("case-insensitive comparison — lowercase nameplate matches uppercase PowerHub", async () => {
    const tasks = await HardwareAnalyzer.detectTasks(
      baseContext({
        powerHubAsset: { siteId: "s1", powerwallEntries: [{ model: "1707000-21-y" }] },
        nameplateExtractions: new Map([
          ["p1", nameplate("1707000-21-Y")],
        ]),
      }),
    );
    expect(tasks).toHaveLength(0);
  });

  it("emits P6 + P1 together when site has mixed PowerHub AND nameplate disagrees", async () => {
    const tasks = await HardwareAnalyzer.detectTasks(
      baseContext({
        powerHubAsset: {
          siteId: "s1",
          powerwallEntries: [{ model: "1707000-11-M" }, { model: "1707000-21-Y" }],
        },
        nameplateExtractions: new Map([
          ["p1", nameplate("1707000-11-J")],
        ]),
      }),
    );
    const codes = tasks.map((t) => t.pCode).sort();
    expect(codes).toEqual(["P1", "P6"]);
  });
});
