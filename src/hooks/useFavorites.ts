"use client";

import { useState, useCallback, useEffect } from "react";

const STORAGE_KEY = "pb-ops-favorites";

/**
 * Hook for managing dashboard favorites using localStorage.
 * Favorited dashboards are shown prominently on the home page.
 */
export function useFavorites() {
  const [favorites, setFavorites] = useState<string[]>([]);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setFavorites(JSON.parse(stored));
      }
    } catch {
      // Ignore storage errors
    }
  }, []);

  // Save to localStorage on change
  const persist = useCallback((newFavorites: string[]) => {
    setFavorites(newFavorites);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newFavorites));
    } catch {
      // Ignore storage errors
    }
  }, []);

  const addFavorite = useCallback(
    (href: string) => {
      if (!favorites.includes(href)) {
        persist([...favorites, href]);
      }
    },
    [favorites, persist]
  );

  const removeFavorite = useCallback(
    (href: string) => {
      persist(favorites.filter((f) => f !== href));
    },
    [favorites, persist]
  );

  const toggleFavorite = useCallback(
    (href: string) => {
      if (favorites.includes(href)) {
        removeFavorite(href);
      } else {
        addFavorite(href);
      }
    },
    [favorites, addFavorite, removeFavorite]
  );

  const isFavorite = useCallback(
    (href: string) => favorites.includes(href),
    [favorites]
  );

  return { favorites, addFavorite, removeFavorite, toggleFavorite, isFavorite };
}
