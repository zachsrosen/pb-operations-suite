import { redirect } from "next/navigation";
import DashboardShell from "@/components/DashboardShell";
import { getCurrentUser } from "@/lib/auth-utils";
import RequestProductClient from "./RequestProductClient";

// Ensure the feature flag is evaluated at request time, not baked at build time.
export const dynamic = "force-dynamic";

export default async function RequestProductPage() {
  // Feature-flag gating happens via the suite card visibility (see
  // src/app/suites/sales-marketing/page.tsx) — no server-side redirect here.
  // Next.js sometimes inlines process.env string-literal reads at build time
  // even with force-dynamic, which caused a stuck redirect bug in prod.
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/dashboards/request-product");

  return (
    <DashboardShell title="Request a Product" accentColor="cyan">
      <RequestProductClient userEmail={user.email} />
    </DashboardShell>
  );
}
