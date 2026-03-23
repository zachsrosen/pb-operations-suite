import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { getUserByEmail } from "@/lib/db";
import { zuper } from "@/lib/zuper";

/**
 * POST /api/zuper/jobs/link-deal
 *
 * Update the hubspot_deal_id custom field on one or more Zuper jobs.
 * Admin-only. Body: { links: [{ jobUid, dealId }] }
 */
export async function POST(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const dbUser = await getUserByEmail(authResult.email);
  if (!dbUser || dbUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const body = await request.json();
  const links: { jobUid: string; dealId: string }[] = body.links;

  if (!Array.isArray(links) || links.length === 0) {
    return NextResponse.json({ error: "links array required" }, { status: 400 });
  }

  if (links.length > 50) {
    return NextResponse.json({ error: "Max 50 links per request" }, { status: 400 });
  }

  const results: { jobUid: string; dealId: string; success: boolean; error?: string }[] = [];

  for (const { jobUid, dealId } of links) {
    try {
      // Add deal ID as a job tag (hubspot-{dealId}) — works on all jobs
      // regardless of custom field template. The comparison route already
      // checks job_tags as a fallback for deal ID extraction.
      const tag = `hubspot-${dealId}`;

      // First get current tags to avoid overwriting
      const current = await zuper.getJob(jobUid);
      const existingTags: string[] =
        current.type === "success" && Array.isArray((current.data as any)?.job_tags)
          ? (current.data as any).job_tags
          : [];

      if (existingTags.includes(tag)) {
        results.push({ jobUid, dealId, success: true, error: undefined });
        continue;
      }

      const res = await zuper.updateJob(jobUid, {
        job_tags: [...existingTags, tag],
      });

      results.push({
        jobUid,
        dealId,
        success: res.type === "success",
        error: res.type === "error" ? String(res.error) : undefined,
      });
    } catch (err) {
      results.push({
        jobUid,
        dealId,
        success: false,
        error: String(err),
      });
    }

    // Rate limit
    await new Promise((r) => setTimeout(r, 200));
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  return NextResponse.json({ succeeded, failed, results });
}
