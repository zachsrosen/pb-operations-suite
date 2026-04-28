/**
 * PM Accountability — server entry. Audience-gated.
 *
 * Real-email check (ignores impersonation). Renders the client dashboard
 * if authorized, a minimal "Not authorized" page otherwise.
 */
import DashboardShell from "@/components/DashboardShell";
import { checkAudienceAccess } from "@/lib/pm-tracker/audience";
import { PMDashboard } from "./PMDashboard";

export const dynamic = "force-dynamic";

export default async function PMAccountabilityPage() {
  const { ok, email } = await checkAudienceAccess();

  if (!ok) {
    return (
      <DashboardShell title="PM Accountability" accentColor="purple">
        <div className="bg-surface rounded-xl border border-t-border p-8 text-center">
          <h2 className="text-lg font-semibold text-foreground">Not authorized</h2>
          <p className="text-sm text-muted mt-2">
            This dashboard contains sensitive HR-adjacent data and is restricted to a
            specific audience list. Contact Zach if you believe you should have access.
          </p>
          {email && (
            <p className="text-xs text-muted mt-3 font-mono">Signed in as: {email}</p>
          )}
        </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell
      title="PM Accountability"
      subtitle="Project Manager activity, outcomes, and saves"
      accentColor="purple"
    >
      <PMDashboard />
    </DashboardShell>
  );
}
