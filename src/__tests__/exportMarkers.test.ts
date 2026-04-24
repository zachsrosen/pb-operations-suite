/**
 * @jest-environment jsdom
 */

import { downloadMarkersCsv } from "@/app/dashboards/map/exportMarkers";
import type { JobMarker } from "@/lib/map-types";

describe("downloadMarkersCsv", () => {
  let lastBlobText: string;
  const origBlob = globalThis.Blob;
  const origCreate = (URL as unknown as { createObjectURL?: (b: Blob) => string }).createObjectURL;
  const origRevoke = (URL as unknown as { revokeObjectURL?: (s: string) => void }).revokeObjectURL;
  let clickSpy: jest.SpyInstance;
  const createUrl = jest.fn((): string => "blob:mock");
  const revokeUrl = jest.fn((_: string): void => undefined);

  beforeEach(() => {
    lastBlobText = "";
    // jsdom lacks URL.createObjectURL / revokeObjectURL — stub them directly.
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = createUrl;
    (URL as unknown as { revokeObjectURL: (s: string) => void }).revokeObjectURL = revokeUrl;
    createUrl.mockClear();
    revokeUrl.mockClear();
    (globalThis as unknown as { Blob: typeof Blob }).Blob = function (parts: BlobPart[]) {
      lastBlobText = String(parts[0] ?? "");
      return { size: lastBlobText.length, type: "text/csv" } as unknown as Blob;
    } as unknown as typeof Blob;
    clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  afterEach(() => {
    (globalThis as unknown as { Blob: typeof Blob }).Blob = origBlob;
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = origCreate as never;
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = origRevoke as never;
    clickSpy.mockRestore();
  });

  function sampleMarker(overrides: Partial<JobMarker> = {}): JobMarker {
    return {
      id: "install:1",
      kind: "install",
      scheduled: true,
      lat: 39.5,
      lng: -104.9,
      address: { street: "123 Main", city: "Denver", state: "CO", zip: "80202" },
      title: "Test job",
      scheduledAt: "2026-04-24T15:00:00Z",
      ...overrides,
    };
  }

  it("writes headers + one row per marker", () => {
    downloadMarkersCsv([sampleMarker(), sampleMarker({ id: "install:2", title: "Other" })]);
    const lines = lastBlobText.split("\n");
    // header + 2 rows
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("id,kind,scheduled,title,address,city,state,zip");
    expect(lines[1]).toContain("install:1");
    expect(lines[2]).toContain("install:2");
  });

  it("escapes quotes and commas", () => {
    downloadMarkersCsv([
      sampleMarker({ title: 'O"Brien, residence', address: { street: "1, Main", city: "Denver", state: "CO", zip: "80202" } }),
    ]);
    // Quoted field with embedded "" escape
    expect(lastBlobText).toContain('"O""Brien, residence"');
    expect(lastBlobText).toContain('"1, Main"');
  });

  it("triggers a download via a temporary anchor click", () => {
    downloadMarkersCsv([sampleMarker()], "my-export.csv");
    expect(createUrl).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeUrl).toHaveBeenCalled();
  });
});
