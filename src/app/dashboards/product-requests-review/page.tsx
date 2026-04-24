import { redirect } from "next/navigation";
import DashboardShell from "@/components/DashboardShell";
import { getCurrentUser } from "@/lib/auth-utils";
import ReviewClient from "./ReviewClient";

export const dynamic = "force-dynamic";

export default async function ProductRequestsReviewPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/dashboards/product-requests-review");

  const allowed = ["ADMIN", "OWNER", "TECH_OPS", "DESIGN", "PERMIT", "INTERCONNECT"];
  if (!user.roles.some((r) => allowed.includes(r))) redirect("/");

  return (
    <DashboardShell title="Product Request Queue" accentColor="cyan">
      <ReviewClient />
    </DashboardShell>
  );
}
