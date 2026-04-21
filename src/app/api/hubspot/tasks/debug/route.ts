/**
 * GET /api/hubspot/tasks/_diag
 *
 * One-off diagnostic endpoint to figure out why my-tasks returns empty.
 * Admin-only. Remove once resolved.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { hubspotClient } from "@/lib/hubspot";

export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const normalized = email.trim().toLowerCase();
  const steps: Array<Record<string, unknown>> = [];

  try {
    steps.push({ step: "list-unfiltered-start" });
    const unfiltered = await hubspotClient.crm.owners.ownersApi.getPage(undefined, undefined, 500, false);
    const emails = (unfiltered.results ?? []).map((o) => ({
      id: o.id,
      email: o.email,
      emailLower: o.email?.toLowerCase() ?? null,
    }));
    const myMatch = emails.find((o) => o.emailLower === normalized);
    steps.push({
      step: "list-unfiltered-result",
      totalCount: unfiltered.results?.length ?? 0,
      hasNextPage: Boolean(unfiltered.paging?.next?.after),
      myEmailLowered: normalized,
      myMatch: myMatch ?? null,
      firstFive: emails.slice(0, 5),
    });
  } catch (err) {
    steps.push({
      step: "list-unfiltered-error",
      error: err instanceof Error ? err.message : String(err),
      code: (err as { code?: number })?.code,
    });
  }

  try {
    steps.push({ step: "filter-by-email-start" });
    const filtered = await hubspotClient.crm.owners.ownersApi.getPage(normalized, undefined, 1, false);
    steps.push({
      step: "filter-by-email-result",
      resultCount: filtered.results?.length ?? 0,
      firstResult: filtered.results?.[0] ?? null,
    });
  } catch (err) {
    steps.push({
      step: "filter-by-email-error",
      error: err instanceof Error ? err.message : String(err),
      code: (err as { code?: number })?.code,
    });
  }

  return NextResponse.json({ email, normalized, steps });
}
