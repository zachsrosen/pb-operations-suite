import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-utils";
import { evaluateLiveFlags } from "@/lib/pm-flag-rules";
import PmActionQueueClient from "./PmActionQueueClient";

export default async function PmActionQueuePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/dashboards/pm-action-queue");

  const allowed = new Set([
    "ADMIN",
    "OWNER",
    "EXECUTIVE",
    "PROJECT_MANAGER",
    "OPERATIONS_MANAGER",
  ]);
  if (!user.roles.some((r: string) => allowed.has(r))) redirect("/");

  const isAdminLike = user.roles.some((r: string) =>
    ["ADMIN", "OWNER", "EXECUTIVE", "OPERATIONS_MANAGER"].includes(r)
  );

  // Live-mode evaluation: reconcile flags against current data before
  // rendering. Graceful degradation — on timeout or error, render the
  // existing queue from DB (stale data > broken page). Both branches
  // emit observability so we know when the 30s bound is being hit.
  //
  // 30s upper bound: matches Vercel function maxDuration on this route.
  const TIMEOUT_SENTINEL = Symbol("pm-flags-eval-timeout");
  const evalDeadline = new Promise<typeof TIMEOUT_SENTINEL>(resolve =>
    setTimeout(() => resolve(TIMEOUT_SENTINEL), 30_000)
  );
  try {
    const result = await Promise.race([evaluateLiveFlags(), evalDeadline]);
    if (result === TIMEOUT_SENTINEL) {
      // Vercel log drain + Sentry breadcrumb pick up console.warn.
      console.warn(
        "[pm-action-queue] live-mode evaluation timed out after 30s — rendering stale queue from DB"
      );
    }
  } catch (err) {
    // Sentry already auto-instrumented at the route level.
    console.error("[pm-action-queue] live-mode evaluation failed", err);
  }

  return <PmActionQueueClient isAdminLike={isAdminLike} />;
}
