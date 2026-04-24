import { redirect } from "next/navigation";
import DashboardShell from "@/components/DashboardShell";
import { getCurrentUser } from "@/lib/auth-utils";
import RequestProductClient from "./RequestProductClient";

export default async function RequestProductPage() {
  if (process.env.SALES_PRODUCT_REQUESTS_ENABLED !== "true") {
    redirect("/");
  }
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/dashboards/request-product");

  return (
    <DashboardShell title="Request a Product" accentColor="cyan">
      <RequestProductClient userEmail={user.email} />
    </DashboardShell>
  );
}
