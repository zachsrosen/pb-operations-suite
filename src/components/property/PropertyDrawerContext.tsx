// src/components/property/PropertyDrawerContext.tsx
//
// App-level context that owns a single <PropertyDrawer> instance so that any
// <PropertyLink> in the tree can open the drawer without each call-site
// mounting its own copy. Task 6.3 will wire <PropertyDrawerProvider> into the
// root layout; until then, consumers must mount it themselves for the hook to
// resolve.
"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import PropertyDrawer from "@/components/PropertyDrawer";

interface PropertyDrawerContextValue {
  /** Open the drawer. Pass null for a "no property record yet" legacy state. */
  openDrawer: (hubspotObjectId: string | null) => void;
  closeDrawer: () => void;
}

const PropertyDrawerContext = createContext<PropertyDrawerContextValue | null>(null);

export function PropertyDrawerProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [hubspotObjectId, setHubspotObjectId] = useState<string | null>(null);

  const openDrawer = useCallback((id: string | null) => {
    setHubspotObjectId(id);
    setOpen(true);
  }, []);

  const closeDrawer = useCallback(() => {
    setOpen(false);
  }, []);

  const value = useMemo<PropertyDrawerContextValue>(
    () => ({ openDrawer, closeDrawer }),
    [openDrawer, closeDrawer],
  );

  return (
    <PropertyDrawerContext.Provider value={value}>
      {children}
      <PropertyDrawer
        open={open}
        onClose={closeDrawer}
        hubspotObjectId={hubspotObjectId}
      />
    </PropertyDrawerContext.Provider>
  );
}

export function usePropertyDrawer(): PropertyDrawerContextValue {
  const ctx = useContext(PropertyDrawerContext);
  if (!ctx) {
    throw new Error(
      "usePropertyDrawer() must be used inside <PropertyDrawerProvider>. " +
        "Mount the provider at the app/suite layout level (see Task 6.3).",
    );
  }
  return ctx;
}
