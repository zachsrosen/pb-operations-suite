import { scanM1MonitoringFolder } from "@/lib/pe-crossref/extractors/monitoring-folder";

jest.mock("@/lib/drive-plansets", () => ({
  listDriveFilesRecursive: jest.fn(),
}));
import { listDriveFilesRecursive } from "@/lib/drive-plansets";
const mockList = listDriveFilesRecursive as jest.MockedFunction<typeof listDriveFilesRecursive>;

describe("scanM1MonitoringFolder", () => {
  beforeEach(() => mockList.mockReset());

  it("returns null when no folder id is provided", async () => {
    const result = await scanM1MonitoringFolder(null);
    expect(result).toBeNull();
  });

  it("flags hasOriginalScreenshot when a PowerHub file is present", async () => {
    mockList.mockResolvedValue([
      { id: "1", name: "PowerHub_2026-05-01.png", mimeType: "image/png", modifiedTime: "2026-05-01T00:00:00Z" },
    ]);
    const result = await scanM1MonitoringFolder("folder-1");
    expect(result?.hasOriginalScreenshot).toBe(true);
    expect(result?.correctedScreenshotFile).toBeNull();
  });

  it("returns the most-recent corrected file when multiple exist", async () => {
    mockList.mockResolvedValue([
      { id: "old", name: "PowerHub_corrected_2026-05-01.png", mimeType: "image/png", modifiedTime: "2026-05-01T00:00:00Z" },
      { id: "new", name: "PowerHub_corrected_2026-05-10.png", mimeType: "image/png", modifiedTime: "2026-05-10T00:00:00Z" },
    ]);
    const result = await scanM1MonitoringFolder("folder-1");
    expect(result?.correctedScreenshotFile?.id).toBe("new");
  });

  it("hasOriginalScreenshot=false when no powerhub or monitoring files exist", async () => {
    mockList.mockResolvedValue([
      { id: "x", name: "RandomDoc.pdf", mimeType: "application/pdf", modifiedTime: "2026-05-01T00:00:00Z" },
    ]);
    const result = await scanM1MonitoringFolder("folder-1");
    expect(result?.hasOriginalScreenshot).toBe(false);
    expect(result?.correctedScreenshotFile).toBeNull();
  });

  it("recognises Enphase / Enlighten filenames as monitoring screenshots", async () => {
    mockList.mockResolvedValue([
      { id: "e", name: "Enphase_Enlighten_2026-05-12.png", mimeType: "image/png", modifiedTime: "2026-05-12T00:00:00Z" },
    ]);
    const result = await scanM1MonitoringFolder("folder-1");
    expect(result?.hasOriginalScreenshot).toBe(true);
  });
});
