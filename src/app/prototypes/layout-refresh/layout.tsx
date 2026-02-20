import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";

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
  if (!user || (user.role !== "ADMIN" && user.role !== "OWNER")) {
    redirect("/");
  }

  return children;
}
