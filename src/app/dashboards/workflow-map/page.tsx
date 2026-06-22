import { auth } from "@/auth";
import { redirect } from "next/navigation";
import DashboardShell from "@/components/DashboardShell";
import WorkflowMapClient from "@/components/workflow-map/WorkflowMapClient";

/**
 * Workflow Map dashboard — visual map of HubSpot pipelines, stages, and the
 * automation flows that fire on them.
 *
 * Readable by all authenticated users (the /api/workflow-map endpoint is
 * allow-listed for every role). `canEditSop` gates the later edit-in-place
 * chunk — it mirrors the gate the SOP write endpoint enforces (ADMIN or
 * EXECUTIVE) and is threaded through to the client for future use.
 */
export default async function WorkflowMapPage() {
  const session = await auth();
  if (!session?.user) redirect("/");

  const roles = (session.user as { roles?: string[] } | undefined)?.roles ?? [];
  const canEditSop = roles.includes("ADMIN") || roles.includes("EXECUTIVE");

  return (
    <DashboardShell title="Workflow Map" accentColor="cyan">
      <WorkflowMapClient canEditSop={canEditSop} />
    </DashboardShell>
  );
}
