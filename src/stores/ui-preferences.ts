import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Persisted UI preferences store.
 * Replaces raw localStorage usage in useFavorites and InstallPrompt.
 */
interface UIPreferencesStore {
  favorites: string[];
  installDismissed: boolean;
  addFavorite: (href: string) => void;
  removeFavorite: (href: string) => void;
  toggleFavorite: (href: string) => void;
  isFavorite: (href: string) => boolean;
  dismissInstall: () => void;
}

export const useUIPreferences = create<UIPreferencesStore>()(
  persist(
    (set, get) => ({
      favorites: [],
      installDismissed: false,

      addFavorite: (href) =>
        set((state) => ({
          favorites: state.favorites.includes(href)
            ? state.favorites
            : [...state.favorites, href],
        })),

      removeFavorite: (href) =>
        set((state) => ({
          favorites: state.favorites.filter((f) => f !== href),
        })),

      toggleFavorite: (href) => {
        if (get().favorites.includes(href)) {
          get().removeFavorite(href);
        } else {
          get().addFavorite(href);
        }
      },

      isFavorite: (href) => get().favorites.includes(href),

      dismissInstall: () => set({ installDismissed: true }),
    }),
    {
      name: "pb-ui-preferences",
    }
  )
);
