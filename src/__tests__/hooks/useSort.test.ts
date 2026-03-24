/**
 * @jest-environment jsdom
 */
import { renderHook, act } from "@testing-library/react";
import { useSort, sortRows } from "@/hooks/useSort";

describe("useSort", () => {
  it("initializes with provided defaults", () => {
    const { result } = renderHook(() => useSort("name", "desc"));
    expect(result.current.sortKey).toBe("name");
    expect(result.current.sortDir).toBe("desc");
  });

  it("defaults to null key and asc direction", () => {
    const { result } = renderHook(() => useSort());
    expect(result.current.sortKey).toBeNull();
    expect(result.current.sortDir).toBe("asc");
  });

  it("sets new key with provided defaultDir", () => {
    const { result } = renderHook(() => useSort("name", "asc"));
    act(() => result.current.toggle("amount"));
    expect(result.current.sortKey).toBe("amount");
    expect(result.current.sortDir).toBe("asc");
  });

  it("toggles direction on same key", () => {
    const { result } = renderHook(() => useSort("name", "asc"));
    act(() => result.current.toggle("name"));
    expect(result.current.sortDir).toBe("desc");
    act(() => result.current.toggle("name"));
    expect(result.current.sortDir).toBe("asc");
  });

  it("respects custom defaultDir when switching keys", () => {
    const { result } = renderHook(() => useSort("name", "desc"));
    act(() => result.current.toggle("amount"));
    expect(result.current.sortDir).toBe("desc");
  });
});

describe("sortRows", () => {
  const rows = [
    { name: "Charlie", amount: 300, active: true },
    { name: "Alice", amount: 100, active: false },
    { name: "Bob", amount: 200, active: true },
  ];

  it("returns rows unchanged when key is null", () => {
    expect(sortRows(rows, null, "asc")).toEqual(rows);
  });

  it("sorts strings ascending", () => {
    const sorted = sortRows(rows, "name", "asc");
    expect(sorted.map((r) => r.name)).toEqual(["Alice", "Bob", "Charlie"]);
  });

  it("sorts strings descending", () => {
    const sorted = sortRows(rows, "name", "desc");
    expect(sorted.map((r) => r.name)).toEqual(["Charlie", "Bob", "Alice"]);
  });

  it("sorts numbers ascending", () => {
    const sorted = sortRows(rows, "amount", "asc");
    expect(sorted.map((r) => r.amount)).toEqual([100, 200, 300]);
  });

  it("sorts numbers descending", () => {
    const sorted = sortRows(rows, "amount", "desc");
    expect(sorted.map((r) => r.amount)).toEqual([300, 200, 100]);
  });

  it("sorts booleans (true first in ascending)", () => {
    const sorted = sortRows(rows, "active", "asc");
    expect(sorted.map((r) => r.active)).toEqual([true, true, false]);
  });

  it("pushes null values to end regardless of direction", () => {
    const withNull = [...rows, { name: null as unknown as string, amount: 50, active: false }];
    const asc = sortRows(withNull, "name", "asc");
    expect(asc[asc.length - 1].name).toBeNull();
    const desc = sortRows(withNull, "name", "desc");
    expect(desc[desc.length - 1].name).toBeNull();
  });

  it("does not mutate the original array", () => {
    const original = [...rows];
    sortRows(rows, "name", "asc");
    expect(rows).toEqual(original);
  });
});

describe("useSort + sortRows integration", () => {
  it("toggles direction after switching to a new key", () => {
    const { result } = renderHook(() => useSort("name", "asc"));
    act(() => result.current.toggle("amount"));
    act(() => result.current.toggle("amount"));
    expect(result.current.sortDir).toBe("desc");
  });
});
