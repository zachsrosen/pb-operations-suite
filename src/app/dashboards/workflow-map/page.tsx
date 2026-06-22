import { auth } from "@/auth";
import { redirect } from "next/navigation";
import DashboardShell from "@/components/DashboardShell";
import WorkflowMapClient from "@/components/workflow-map/WorkflowMapClient";

/**
 * Workflow Map dashboard — visual map of HubSpot pipelines, stages, and the
 * automation flows that fire on them.
 *
 * Readable by all authenticated users (the /api/workflow-map endpoint is
 * allow-listed for every role). `canEditSop` gates the SOP edit-in-place
 * affordance. It is ADMIN-only: the `/api/admin` middleware prefix gate blocks
 * non-ADMIN before the SOP write route's in-route check runs, so EXECUTIVE
 * users would see the Edit button but 403 on Save. This matches the existing
 * /sop editor's ADMIN-only wall.
 */
export default async function WorkflowMapPage() {
  const session = await auth();
  if (!session?.user) redirect("/");

  const roles = (session.user as { roles?: string[] } | undefined)?.roles ?? [];
  const canEditSop = roles.includes("ADMIN");

  return (
    <DashboardShell title="Workflow Map" accentColor="cyan">
      <WorkflowMapClient canEditSop={canEditSop} />
    </DashboardShell>
  );
}
