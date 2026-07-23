import {
  TAB_CONFIGS,
  groupForStatus,
  subGroupForStatus,
  type TabConfig,
} from "@/lib/design-hub/config";
import { STATUS_MAPS } from "@/lib/deal-status-labels";
import { SUB_GROUP_ORDER } from "@/lib/design-hub/types";

/**
 * The load-bearing test for this feature.
 *
 * "Every status maps somewhere" is trivially true on the design tab (it has an
 * `other` catch-all) and therefore worthless. What actually breaks the hub is
 * a typo'd status string that silently never matches, a status listed in two
 * lanes, or — on the DA tab, which has no catch-all — a HubSpot option nobody
 * added a lane for, which would make those deals invisible.
 */

function mappedStatuses(config: TabConfig): string[] {
  return Object.values(config.groups).flatMap((s) => [...(s ?? [])]);
}

describe("design-hub config", () => {
  describe.each(Object.values(TAB_CONFIGS))("$label tab", (config) => {
    const known = STATUS_MAPS[config.statusProperty];

    it("references a status property that exists", () => {
      expect(known).toBeDefined();
    });

    it("lists only real HubSpot option values in its groups", () => {
      const unknown = mappedStatuses(config).filter((s) => !(s in known));
      expect(unknown).toEqual([]);
    });

    it("lists only real HubSpot option values as terminal", () => {
      const unknown = config.terminalStatuses.filter((s) => !(s in known));
      expect(unknown).toEqual([]);
    });

    it("never puts one status in two groups", () => {
      const all = mappedStatuses(config);
      const dupes = all.filter((s, i) => all.indexOf(s) !== i);
      expect(dupes).toEqual([]);
    });

    it("never marks a grouped status as terminal", () => {
      const terminal = new Set<string>(config.terminalStatuses);
      const overlap = mappedStatuses(config).filter((s) => terminal.has(s));
      expect(overlap).toEqual([]);
    });

    it("declares every group it lists in groupOrder", () => {
      const ordered = new Set<string>(config.groupOrder);
      const missing = Object.keys(config.groups).filter((g) => !ordered.has(g));
      expect(missing).toEqual([]);
    });
  });

  it("covers every layout_status value — the DA tab has no catch-all", () => {
    const config = TAB_CONFIGS.da;
    expect(config.exhaustive).toBe(true);
    const covered = new Set([
      ...mappedStatuses(config),
      ...config.terminalStatuses,
    ]);
    const uncovered = Object.keys(STATUS_MAPS.layout_status).filter(
      (s) => !covered.has(s),
    );
    // A miss here means real deals would silently vanish from the DA queue.
    expect(uncovered).toEqual([]);
  });

  it("routes unmapped design statuses to the catch-all rather than dropping them", () => {
    expect(TAB_CONFIGS.design.exhaustive).toBe(false);
    expect(groupForStatus(TAB_CONFIGS.design, "Ready for Design")).toBe("other");
    expect(groupForStatus(TAB_CONFIGS.design, "On Hold")).toBe("other");
    // Archived statuses stay visible in `other`, not silently terminal.
    expect(groupForStatus(TAB_CONFIGS.design, "In Revision")).toBe("other");
  });

  it("puts the review statuses in their agreed lanes", () => {
    const design = TAB_CONFIGS.design;
    expect(groupForStatus(design, "Initial Review")).toBe("idr");
    // Both final-review states share the FDR lane (Zach 2026-07-22).
    expect(groupForStatus(design, "Ready for Review")).toBe("fdr");
    expect(groupForStatus(design, "DA Approved")).toBe("fdr");
  });

  describe("revision sub-grouping", () => {
    const design = TAB_CONFIGS.design;
    const revisionLanes = [
      ...(design.groups.revisions_needed ?? []),
      ...(design.groups.revisions_in_progress ?? []),
    ];

    it("assigns every revision-lane status exactly one revision type", () => {
      const unclassified = revisionLanes.filter(
        (s) => subGroupForStatus(design, s) === null,
      );
      // An unclassified row renders under "Unclassified" in the UI rather than
      // disappearing, but it means config drift and should be fixed here.
      expect(unclassified).toEqual([]);
    });

    it("never assigns a revision type to a non-revision status", () => {
      const outside = mappedStatuses(design).filter(
        (s) => !revisionLanes.includes(s) && subGroupForStatus(design, s) !== null,
      );
      expect(outside).toEqual([]);
    });

    it("pairs each revision type across both lanes", () => {
      for (const sub of SUB_GROUP_ORDER) {
        const statuses = design.subGroups?.[sub] ?? [];
        const needed = statuses.filter((s) =>
          design.groups.revisions_needed?.includes(s),
        );
        const inProgress = statuses.filter((s) =>
          design.groups.revisions_in_progress?.includes(s),
        );
        // Each type must have both a "needed" and an "in progress" status, or
        // one of the two lanes silently has no section for it.
        expect({ sub, needed: needed.length, inProgress: inProgress.length })
          .toEqual({ sub, needed: 1, inProgress: 1 });
      }
    });
  });
});
