// src/app/admin/layout.tsx
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-utils";
import { AdminShell } from "@/components/admin-shell/AdminShell";

/**
 * Applies the AdminShell chrome to every `/admin/*` page.
 *
 * Auth: middleware already gates `/admin` as admin-only via ADMIN_ONLY_ROUTES.
 * We also do a server-side check here so a stale JWT can't bypass it — admin
 * access is high-risk enough to warrant the double check (matches the pattern
 * in each admin page today).
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/admin");
  if (!user.roles?.includes("ADMIN")) redirect("/unassigned");

  return <AdminShell>{children}</AdminShell>;
}
