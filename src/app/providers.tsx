"use client";

import { ReactNode } from "react";
import { SessionProvider } from "next-auth/react";
import { ToastProvider } from "@/contexts/ToastContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { GlobalSearch } from "@/components/GlobalSearch";
import { BugReportButton } from "@/components/BugReportButton";
import { AuthSync } from "@/components/AuthSync";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <ThemeProvider>
        <ToastProvider>
          <AuthSync />
          {children}
          <GlobalSearch />
          <BugReportButton />
        </ToastProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
