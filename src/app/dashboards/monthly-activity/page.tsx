import { redirect } from "next/navigation";

// Monthly Activity now lives as a tab on the unified Project Pipeline page,
// sharing the same filters as the funnel. Preserve the old route by redirecting.
export default function MonthlyActivityPage() {
  redirect("/dashboards/project-pipeline-funnel?tab=activity");
}
