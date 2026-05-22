import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-utils";
import DashboardShell from "@/components/DashboardShell";
import EagleViewOrdersClient from "./EagleViewOrdersClient";

export default async function EagleViewOrdersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  return (
    <DashboardShell title="EagleView Orders" accentColor="orange">
      <EagleViewOrdersClient userEmail={user.email} />
    </DashboardShell>
  );
}
