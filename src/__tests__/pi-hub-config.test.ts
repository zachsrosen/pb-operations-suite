import { TEAM_CONFIGS, groupForStatus } from "@/lib/pi-hub/config";
import { LIVE_STATUS_OPTIONS } from "./fixtures/pi-status-options";

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
});
