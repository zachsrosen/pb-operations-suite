"use client";

import { ReactNode } from "react";
import { SessionProvider } from "next-auth/react";
import { ToastProvider } from "@/contexts/ToastContext";
import { GlobalSearch } from "@/components/GlobalSearch";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <ToastProvider>
        {children}
        <GlobalSearch />
      </ToastProvider>
    </SessionProvider>
  );
}
