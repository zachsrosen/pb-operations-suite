"use client";

import { useEffect, useId } from "react";
import { create } from "zustand";

interface DeployRefreshStore {
  updateAvailable: boolean;
  dirtySources: Record<string, true>;
  isDirty: boolean;
  setUpdateAvailable: (value: boolean) => void;
  clearUpdateAvailable: () => void;
  setDirtySource: (id: string, dirty: boolean) => void;
}

export const useDeployRefreshStore = create<DeployRefreshStore>()((set) => ({
  updateAvailable: false,
  dirtySources: {},
  isDirty: false,
  setUpdateAvailable: (value) => set({ updateAvailable: value }),
  clearUpdateAvailable: () => set({ updateAvailable: false }),
  setDirtySource: (id, dirty) =>
    set((state) => {
      if (dirty) {
        if (state.dirtySources[id]) return state;
        return {
          dirtySources: { ...state.dirtySources, [id]: true },
          isDirty: true,
        };
      }

      if (!state.dirtySources[id]) return state;

      const nextDirtySources = { ...state.dirtySources };
      delete nextDirtySources[id];

      return {
        dirtySources: nextDirtySources,
        isDirty: Object.keys(nextDirtySources).length > 0,
      };
    }),
}));

/**
 * Marks the current page as having unsaved work while `isDirty` is true.
 * Interactive pages can adopt this hook incrementally to block deploy-time
 * refreshes until local edits are saved.
 */
export function useDeployRefreshDirty(isDirty: boolean) {
  const sourceId = useId();
  const setDirtySource = useDeployRefreshStore((state) => state.setDirtySource);

  useEffect(() => {
    setDirtySource(sourceId, isDirty);
    return () => setDirtySource(sourceId, false);
  }, [isDirty, setDirtySource, sourceId]);
}
