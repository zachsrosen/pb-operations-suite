import DashboardShell from "@/components/DashboardShell";
import ReviewActions from "@/components/ReviewActions";
import { EagleViewPanel } from "@/components/EagleViewPanel";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";

interface Props {
  params: Promise<{ dealId: string }>;
}

export default async function ReviewHistoryPage({ params }: Props) {
  const { dealId } = await params;
  const session = await auth();
  const userRole = session?.user?.roles?.[0] ?? "VIEWER";

  const reviews = await prisma.projectReview.findMany({
    where: { dealId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const projectId = reviews[0]?.projectId || dealId;

  return (
    <DashboardShell title={`Reviews — ${projectId}`} accentColor="orange" dealId={dealId}>
      <div className="space-y-6">
        {/* Run review actions */}
        <ReviewActions dealId={dealId} dealName={projectId} userRole={userRole} />

        {/* EagleView TrueDesign — manual order + status. Auto-orders fire via
            HubSpot workflow when EAGLEVIEW_AUTO_PULL_ENABLED is true. */}
        <EagleViewPanel dealId={dealId} />

        <div className="grid grid-cols-1 gap-4">
          {["design-review"].map((skill) => {
            const latest = reviews.find((r) => r.skill === skill);
            return (
              <div key={skill} className="rounded-xl border border-t-border bg-surface p-4">
                <p className="text-xs font-medium text-muted uppercase tracking-wide">{skill.replace(/-/g, " ")}</p>
                {latest ? (
                  <>
                    <p className={`text-2xl font-bold mt-1 ${latest.passed ? "text-emerald-500" : "text-red-500"}`}>
                      {latest.passed ? "Passed" : `${latest.errorCount} errors`}
                    </p>
                    <p className="text-xs text-muted mt-1">
                      {latest.trigger} · {new Date(latest.createdAt).toLocaleDateString()}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted mt-1">No reviews yet</p>
                )}
              </div>
            );
          })}
        </div>

        <div className="rounded-xl border border-t-border bg-surface">
          <div className="border-b border-t-border px-4 py-3">
            <h3 className="text-sm font-semibold text-foreground">Review History</h3>
          </div>
          <div className="divide-y divide-t-border">
            {reviews.map((review) => (
              <div key={review.id} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${review.passed ? "bg-emerald-500" : "bg-red-500"}`} />
                    <span className="text-sm font-medium text-foreground">{review.skill.replace(/-/g, " ")}</span>
                    <span className="text-xs text-muted">{review.trigger}</span>
                  </div>
                  <div className="text-xs text-muted">
                    {review.triggeredBy} · {new Date(review.createdAt).toLocaleString()} · {review.durationMs}ms
                  </div>
                </div>
                {(review.findings as Array<{ severity: string; message: string }>).length > 0 && (
                  <div className="mt-2 space-y-1 pl-4">
                    {(review.findings as Array<{ severity: string; message: string }>).map((f, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm">
                        <span className={f.severity === "error" ? "text-red-500" : f.severity === "warning" ? "text-amber-500" : "text-blue-500"}>
                          {f.severity === "error" ? "●" : f.severity === "warning" ? "▲" : "ℹ"}
                        </span>
                        <span className="text-foreground">{f.message}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {reviews.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-muted">
                No reviews have been run for this deal yet.
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
