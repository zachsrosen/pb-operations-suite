import {
  MARKER_COLORS,
  CREW_COLOR_WORKING,
  CREW_COLOR_IDLE,
  CLUSTER_COLORS,
  CLUSTER_THRESHOLDS,
  markerFillStyle,
  SHOP_LABELS,
} from "@/lib/map-colors";
import type { JobMarkerKind } from "@/lib/map-types";

describe("map-colors", () => {
  const KINDS: JobMarkerKind[] = ["install", "service", "inspection", "survey", "dnr", "roofing"];

  it("MARKER_COLORS covers every JobMarkerKind with a 6-digit hex", () => {
    for (const k of KINDS) {
      expect(MARKER_COLORS[k]).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("crew colors are hex strings", () => {
    expect(CREW_COLOR_WORKING).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(CREW_COLOR_IDLE).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(CREW_COLOR_WORKING).not.toBe(CREW_COLOR_IDLE);
  });

  it("cluster thresholds are monotonic", () => {
    expect(CLUSTER_THRESHOLDS.medium).toBeLessThan(CLUSTER_THRESHOLDS.large);
    expect(CLUSTER_COLORS.small).toBeTruthy();
    expect(CLUSTER_COLORS.medium).toBeTruthy();
    expect(CLUSTER_COLORS.large).toBeTruthy();
  });

  it("markerFillStyle returns solid fill for scheduled", () => {
    const s = markerFillStyle("install", true);
    expect(s.fillColor).toBe(MARKER_COLORS.install);
    expect(s.fillOpacity).toBe(1);
  });

  it("markerFillStyle returns transparent fill for unscheduled", () => {
    const s = markerFillStyle("install", false);
    expect(s.fillColor).toBe("transparent");
    expect(s.fillOpacity).toBe(0);
    expect(s.strokeColor).toBe(MARKER_COLORS.install);
    expect(s.strokeDashArray).toBeDefined();
  });

  it("SHOP_LABELS covers the 5 CrewShopId values", () => {
    expect(SHOP_LABELS.dtc).toBeTruthy();
    expect(SHOP_LABELS.westy).toBeTruthy();
    expect(SHOP_LABELS.cosp).toBeTruthy();
    expect(SHOP_LABELS.ca).toBeTruthy();
    expect(SHOP_LABELS.camarillo).toBeTruthy();
  });
});
