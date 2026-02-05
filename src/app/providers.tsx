"use client";

import { ReactNode } from "react";
import { SessionProvider } from "next-auth/react";
import { ToastProvider } from "@/contexts/ToastContext";
import { GlobalSearch } from "@/components/GlobalSearch";
import { AuthSync } from "@/components/AuthSync";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <ToastProvider>
        <AuthSync />
        {children}
        <GlobalSearch />
      </ToastProvider>
    </SessionProvider>
  );
}
