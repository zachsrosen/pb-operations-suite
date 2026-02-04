/**
 * @jest-environment jsdom
 */
import { exportToCSV, exportToJSON } from "@/lib/export";

// Mock DOM methods
const mockCreateObjectURL = jest.fn().mockReturnValue("blob:mock-url");
const mockRevokeObjectURL = jest.fn();
const mockClick = jest.fn();
let appendedChild: HTMLAnchorElement | null = null;

beforeAll(() => {
  global.URL.createObjectURL = mockCreateObjectURL;
  global.URL.revokeObjectURL = mockRevokeObjectURL;

  jest.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag === "a") {
      const el = {
        href: "",
        download: "",
        click: mockClick,
      } as unknown as HTMLAnchorElement;
      return el;
    }
    return document.createElement(tag);
  });

  jest.spyOn(document.body, "appendChild").mockImplementation((node) => {
    appendedChild = node as HTMLAnchorElement;
    return node;
  });

  jest.spyOn(document.body, "removeChild").mockImplementation((node) => node);
});

beforeEach(() => {
  mockCreateObjectURL.mockClear();
  mockRevokeObjectURL.mockClear();
  mockClick.mockClear();
  appendedChild = null;
});

describe("exportToCSV", () => {
  it("creates a CSV blob and triggers download", () => {
    const data = [
      { name: "Project A", amount: 50000, location: "Westminster" },
      { name: "Project B", amount: 75000, location: "Centennial" },
    ];

    exportToCSV(data, "test-export");

    // Should have created a blob
    expect(mockCreateObjectURL).toHaveBeenCalledTimes(1);
    const blob = mockCreateObjectURL.mock.calls[0][0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("text/csv;charset=utf-8;");

    // Should have clicked the link
    expect(mockClick).toHaveBeenCalledTimes(1);

    // Should have revoked the URL
    expect(mockRevokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it("does nothing for empty data", () => {
    exportToCSV([], "empty");
    expect(mockCreateObjectURL).not.toHaveBeenCalled();
  });

  it("escapes values containing commas", () => {
    const data = [{ name: "Smith, John", value: 100 }];
    exportToCSV(data, "escape-test");

    const blob = mockCreateObjectURL.mock.calls[0][0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
  });

  it("escapes values containing double quotes", () => {
    const data = [{ name: 'The "Best" Project', value: 100 }];
    exportToCSV(data, "quote-test");

    const blob = mockCreateObjectURL.mock.calls[0][0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
  });

  it("handles null and undefined values", () => {
    const data = [{ name: null, value: undefined, other: "ok" } as Record<string, unknown>];
    exportToCSV(data, "null-test");

    expect(mockCreateObjectURL).toHaveBeenCalledTimes(1);
  });
});

describe("exportToJSON", () => {
  it("creates a JSON blob and triggers download", () => {
    const data = { projects: [{ id: 1 }, { id: 2 }] };
    exportToJSON(data, "test-json");

    expect(mockCreateObjectURL).toHaveBeenCalledTimes(1);
    const blob = mockCreateObjectURL.mock.calls[0][0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("application/json;charset=utf-8;");

    expect(mockClick).toHaveBeenCalledTimes(1);
    expect(mockRevokeObjectURL).toHaveBeenCalledTimes(1);
  });
});
