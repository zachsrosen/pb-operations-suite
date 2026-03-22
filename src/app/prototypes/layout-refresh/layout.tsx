import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";
import { normalizeRole, type UserRole } from "@/lib/role-permissions";

export default async function LayoutRefreshPrototypeLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.email) {
    redirect("/login?callbackUrl=/prototypes/layout-refresh");
  }

  const user = await getUserByEmail(session.user.email);
  const role = user?.role ? normalizeRole(user.role as UserRole) : null;
  if (role !== "ADMIN" && role !== "EXECUTIVE") {
    redirect("/");
  }

  return children;
}
