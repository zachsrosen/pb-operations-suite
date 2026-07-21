import { TEAM_CONFIGS, groupForQueueDeal, groupForStatus } from "@/lib/pi-hub/config";
import { ACCENT_FOR_TEAM } from "@/app/dashboards/pi-hub/accents";
import { LIVE_STATUS_OPTIONS } from "./fixtures/pi-status-options";

// ACCENT_FOR_TEAM duplicates TEAM_CONFIGS[team].accent on purpose — the client
// bundle must not import the server config module. Duplication is only safe if
// it can't silently drift.
describe("ACCENT_FOR_TEAM mirrors TEAM_CONFIGS", () => {
  for (const config of Object.values(TEAM_CONFIGS)) {
    it(`${config.key}: accent matches the config`, () => {
      expect(ACCENT_FOR_TEAM[config.key]).toBe(config.accent);
    });
  }

  it("covers every configured team", () => {
    expect(Object.keys(ACCENT_FOR_TEAM).sort()).toEqual(
      Object.keys(TEAM_CONFIGS).sort(),
    );
  });
});

describe("TEAM_CONFIGS validity", () => {
  for (const config of Object.values(TEAM_CONFIGS)) {
    // ACTIVE options only — the write path (getActiveEnumOptions) filters
    // archived/hidden, so a config status pinned to an archived value would
    // pass a raw containment check but fail at write time.
    const live = LIVE_STATUS_OPTIONS[config.statusProperty]
      .filter((o) => !o.archived && !o.hidden)
      .map((o) => o.value);
    it(`${config.key}: every configured status exists in HubSpot`, () => {
      const configured = [...config.terminalStatuses, ...Object.values(config.groups).flat()];
      for (const s of configured) expect(live).toContain(s);
    });
    it(`${config.key}: no status is in two groups`, () => {
      const all = Object.values(config.groups).flat();
      expect(new Set(all).size).toBe(all.length);
    });
    it(`${config.key}: terminal statuses are not grouped`, () => {
      for (const t of config.terminalStatuses) expect(groupForStatus(config, t)).toBe("other");
    });
  }
  it("unknown statuses fall to 'other'", () => {
    expect(groupForStatus(TEAM_CONFIGS.permit, "Some Future Status")).toBe("other");
  });

  it("inspection-section status is terminal (never double-fetched by the main query)", () => {
    for (const config of Object.values(TEAM_CONFIGS)) {
      if (config.inspection) {
        expect(config.terminalStatuses).toContain(config.inspection.statusValue);
      }
    }
  });
});

describe("groupForQueueDeal", () => {
  const permit = TEAM_CONFIGS.permit;

  it("permit Complete with no pto_status is an inspection row", () => {
    expect(
      groupForQueueDeal(permit, { permitting_status: "Complete" }),
    ).toBe("inspection");
    expect(
      groupForQueueDeal(permit, { permitting_status: "Complete", pto_status: null }),
    ).toBe("inspection");
    // HubSpot renders property-missing as an empty string on some reads.
    expect(
      groupForQueueDeal(permit, { permitting_status: "Complete", pto_status: "" }),
    ).toBe("inspection");
  });

  it("any pto_status means the PTO team owns the deal — not inspection", () => {
    expect(
      groupForQueueDeal(permit, {
        permitting_status: "Complete",
        pto_status: "PTO Waiting on Interconnection Approval",
      }),
    ).toBe("other");
  });

  it("non-terminal permit statuses group exactly as groupForStatus does", () => {
    expect(
      groupForQueueDeal(permit, {
        permitting_status: "Submitted to AHJ",
        pto_status: null,
      }),
    ).toBe("waiting");
  });

  it("teams without an inspection section never produce inspection rows", () => {
    expect(groupForQueueDeal(TEAM_CONFIGS.ic, { interconnection_status: "Application Approved" })).toBe("other");
    expect(groupForQueueDeal(TEAM_CONFIGS.pto, { pto_status: "PTO" })).toBe("other");
  });
});
