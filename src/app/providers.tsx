"use client";

import { ReactNode } from "react";
import { ToastProvider } from "@/contexts/ToastContext";
import { GlobalSearch } from "@/components/GlobalSearch";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      {children}
      <GlobalSearch />
    </ToastProvider>
  );
}
