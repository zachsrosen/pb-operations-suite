import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import DashboardShell from "@/components/DashboardShell";
import { PermitHubClient } from "./PermitHubClient";

export default async function PermitHubPage() {
  if (process.env.PERMIT_HUB_ENABLED !== "true") notFound();
  const session = await auth();
  if (!session?.user) redirect("/");

  return (
    <DashboardShell title="Permit Hub" accentColor="blue" fullWidth>
      <PermitHubClient userEmail={session.user.email ?? ""} />
    </DashboardShell>
  );
}
