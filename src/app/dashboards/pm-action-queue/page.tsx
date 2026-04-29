import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-utils";
import PmActionQueueClient from "./PmActionQueueClient";

export default async function PmActionQueuePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/dashboards/pm-action-queue");

  const allowed = new Set([
    "ADMIN",
    "OWNER",
    "EXECUTIVE",
    "PROJECT_MANAGER",
    "OPERATIONS_MANAGER",
  ]);
  if (!user.roles.some((r: string) => allowed.has(r))) redirect("/");

  const isAdminLike = user.roles.some((r: string) =>
    ["ADMIN", "OWNER", "EXECUTIVE", "OPERATIONS_MANAGER"].includes(r)
  );

  return <PmActionQueueClient isAdminLike={isAdminLike} />;
}
