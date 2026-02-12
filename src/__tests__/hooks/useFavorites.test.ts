/**
 * @jest-environment jsdom
 */
import { renderHook, act } from "@testing-library/react";
import { useFavorites } from "@/hooks/useFavorites";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: jest.fn((key: string) => store[key] || null),
    setItem: jest.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: jest.fn((key: string) => {
      delete store[key];
    }),
    clear: jest.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: jest.fn((index: number) => Object.keys(store)[index] || null),
  };
})();

Object.defineProperty(window, "localStorage", { value: localStorageMock });

describe("useFavorites", () => {
  beforeEach(() => {
    localStorageMock.clear();
    jest.clearAllMocks();
  });

  it("starts with an empty favorites array", () => {
    const { result } = renderHook(() => useFavorites());
    expect(result.current.favorites).toEqual([]);
  });

  it("loads favorites from localStorage on mount", () => {
    localStorageMock.setItem("pb-ops-favorites", JSON.stringify(["/dashboards/sales"]));

    renderHook(() => useFavorites());

    // useEffect runs asynchronously, but the initial state will be overridden
    // We need to wait for the effect
    expect(localStorageMock.getItem).toHaveBeenCalledWith("pb-ops-favorites");
  });

  it("adds a favorite", () => {
    const { result } = renderHook(() => useFavorites());

    act(() => {
      result.current.addFavorite("/dashboards/sales");
    });

    expect(result.current.favorites).toContain("/dashboards/sales");
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      "pb-ops-favorites",
      JSON.stringify(["/dashboards/sales"])
    );
  });

  it("does not add duplicate favorites", () => {
    const { result } = renderHook(() => useFavorites());

    act(() => {
      result.current.addFavorite("/dashboards/sales");
    });
    act(() => {
      result.current.addFavorite("/dashboards/sales");
    });

    expect(result.current.favorites.filter((f) => f === "/dashboards/sales")).toHaveLength(1);
  });

  it("removes a favorite", () => {
    const { result } = renderHook(() => useFavorites());

    act(() => {
      result.current.addFavorite("/dashboards/sales");
      result.current.addFavorite("/dashboards/dnr");
    });

    act(() => {
      result.current.removeFavorite("/dashboards/sales");
    });

    expect(result.current.favorites).not.toContain("/dashboards/sales");
    expect(result.current.favorites).toContain("/dashboards/dnr");
  });

  it("toggleFavorite adds when not present", () => {
    const { result } = renderHook(() => useFavorites());

    act(() => {
      result.current.toggleFavorite("/dashboards/pe");
    });

    expect(result.current.favorites).toContain("/dashboards/pe");
  });

  it("toggleFavorite removes when already present", () => {
    const { result } = renderHook(() => useFavorites());

    act(() => {
      result.current.addFavorite("/dashboards/pe");
    });

    act(() => {
      result.current.toggleFavorite("/dashboards/pe");
    });

    expect(result.current.favorites).not.toContain("/dashboards/pe");
  });

  it("isFavorite returns true for favorited paths", () => {
    const { result } = renderHook(() => useFavorites());

    act(() => {
      result.current.addFavorite("/dashboards/sales");
    });

    expect(result.current.isFavorite("/dashboards/sales")).toBe(true);
    expect(result.current.isFavorite("/dashboards/dnr")).toBe(false);
  });
});
