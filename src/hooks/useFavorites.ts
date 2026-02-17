"use client";

import { useCallback } from "react";
import { useUIPreferences } from "@/stores/ui-preferences";

/**
 * Hook for managing dashboard favorites via Zustand store.
 * Favorited dashboards are shown prominently on the home page.
 * Persisted to localStorage via Zustand persist middleware.
 */
export function useFavorites() {
  const favorites = useUIPreferences((s) => s.favorites);
  const addFavoriteStore = useUIPreferences((s) => s.addFavorite);
  const removeFavoriteStore = useUIPreferences((s) => s.removeFavorite);
  const toggleFavoriteStore = useUIPreferences((s) => s.toggleFavorite);

  const addFavorite = useCallback(
    (href: string) => addFavoriteStore(href),
    [addFavoriteStore]
  );

  const removeFavorite = useCallback(
    (href: string) => removeFavoriteStore(href),
    [removeFavoriteStore]
  );

  const toggleFavorite = useCallback(
    (href: string) => toggleFavoriteStore(href),
    [toggleFavoriteStore]
  );

  const isFavorite = useCallback(
    (href: string) => favorites.includes(href),
    [favorites]
  );

  return { favorites, addFavorite, removeFavorite, toggleFavorite, isFavorite };
}
