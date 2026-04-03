import { auth } from "@/auth";
import { redirect } from "next/navigation";
import DashboardShell from "@/components/DashboardShell";
import { IdrMeetingClient } from "./IdrMeetingClient";

export default async function IdrMeetingPage() {
  const session = await auth();
  if (!session?.user) redirect("/");

  return (
    <DashboardShell
      title="Design & Ops Meeting Hub"
      accentColor="orange"
      fullWidth
    >
      <IdrMeetingClient userEmail={session.user.email ?? ""} />
    </DashboardShell>
  );
}
