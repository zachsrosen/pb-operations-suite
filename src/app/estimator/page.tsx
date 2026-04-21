import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function EstimatorEntryPage() {
  if (process.env.NEXT_PUBLIC_ESTIMATOR_V2_ENABLED !== "true") {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 sm:px-6">
        <div className="rounded-2xl border border-t-border bg-surface p-8 shadow-card">
          <h1 className="text-2xl font-semibold tracking-tight">Coming soon</h1>
          <p className="mt-3 text-sm text-muted">
            Our updated solar estimator is on the way. In the meantime, request a free estimate at{" "}
            <a
              href="https://www.photonbrothers.com/free-solar-estimate"
              className="underline hover:text-foreground"
            >
              photonbrothers.com
            </a>
            .
          </p>
        </div>
      </div>
    );
  }

  redirect("/estimator/new-install?step=address");
}
