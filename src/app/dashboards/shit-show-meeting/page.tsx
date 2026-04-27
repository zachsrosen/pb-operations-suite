import { auth } from "@/auth";
import { redirect } from "next/navigation";
import DashboardShell from "@/components/DashboardShell";
import { ShitShowMeetingClient } from "./ShitShowMeetingClient";

export default async function ShitShowMeetingPage() {
  const session = await auth();
  if (!session?.user) redirect("/");

  return (
    <DashboardShell
      title="Shit Show Meeting"
      accentColor="red"
      fullWidth
    >
      <ShitShowMeetingClient userEmail={session.user.email ?? ""} />
    </DashboardShell>
  );
}
