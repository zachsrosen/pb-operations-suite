import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import DashboardShell from "@/components/DashboardShell";
import { IcHubClient } from "./IcHubClient";

export default async function IcHubPage() {
  if (process.env.IC_HUB_ENABLED !== "true") notFound();
  const session = await auth();
  if (!session?.user) redirect("/");

  return (
    <DashboardShell title="Interconnection Hub" accentColor="green" fullWidth>
      <IcHubClient userEmail={session.user.email ?? ""} />
    </DashboardShell>
  );
}
