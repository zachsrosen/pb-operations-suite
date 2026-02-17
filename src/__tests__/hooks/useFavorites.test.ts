/**
 * @jest-environment jsdom
 */
import { renderHook, act } from "@testing-library/react";
import { useFavorites } from "@/hooks/useFavorites";
import { useUIPreferences } from "@/stores/ui-preferences";

describe("useFavorites", () => {
  beforeEach(() => {
    // Reset Zustand store state between tests
    useUIPreferences.setState({ favorites: [], installDismissed: false });
  });

  it("starts with an empty favorites array", () => {
    const { result } = renderHook(() => useFavorites());
    expect(result.current.favorites).toEqual([]);
  });

  it("adds a favorite", () => {
    const { result } = renderHook(() => useFavorites());

    act(() => {
      result.current.addFavorite("/dashboards/sales");
    });

    expect(result.current.favorites).toContain("/dashboards/sales");
  });

  it("does not add duplicate favorites", () => {
    const { result } = renderHook(() => useFavorites());

    act(() => {
      result.current.addFavorite("/dashboards/sales");
    });
    act(() => {
      result.current.addFavorite("/dashboards/sales");
    });

    expect(
      result.current.favorites.filter((f) => f === "/dashboards/sales")
    ).toHaveLength(1);
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
