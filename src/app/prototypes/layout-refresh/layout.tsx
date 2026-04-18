import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";
import { normalizeRole } from "@/lib/user-access";
import type { UserRole } from "@/generated/prisma/enums";

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
  const roles: UserRole[] = (user?.roles ?? []).map((r) => normalizeRole(r as UserRole));
  if (!roles.some((r) => r === "ADMIN" || r === "EXECUTIVE")) {
    redirect("/");
  }

  return children;
}
