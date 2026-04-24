/**
 * Service Contact Signals
 *
 * Computes the freshest "last customer contact" timestamp for a service deal
 * by looking beyond the stale HubSpot fields (`hs_last_sales_activity_timestamp`,
 * `notes_last_contacted`) which only update when activity is logged INSIDE
 * HubSpot. Service teams interact with customers via Zuper, personal cell,
 * Gmail, and on-site visits — none of which feed those HubSpot fields.
 *
 * Two richer sources:
 *   - HubSpot Engagements API: catches every manually-logged engagement
 *     (calls, notes, meetings, emails) including back-dated entries
 *   - Zuper Job Cache: scheduledStart + completedDate from linked jobs
 *     are strong proxies for customer interaction (scheduling call, on-site
 *     visit at completion)
 *
 * The caller picks whichever is freshest across these + the legacy fields.
 *
 * Spec: Jessica meeting 2026-04-23 — service overview shows 70/360 day
 * "no contact" warnings for customers we talked to yesterday.
 */

import { getDealEngagements } from "@/lib/hubspot-engagements";

export interface ZuperJobLike {
  scheduledStart?: Date | string | null;
  completedDate?: Date | string | null;
}

/**
 * Most recent past customer-interaction timestamp across the deal's Zuper jobs.
 *
 * Uses cached `ZuperJobCache` data — no extra Zuper API calls. Picks the
 * MAX of (completedDate, scheduledStart) across all jobs, BUT discards any
 * timestamp in the future. `scheduledStart` is the planned visit datetime,
 * so for a future-scheduled job it would otherwise produce a future
 * "lastContactDate" that downstream scoring (`daysSinceContact >= N`)
 * silently rejects, suppressing the no-contact warning entirely.
 *
 * Returns null when there are no jobs or none have either timestamp in the
 * past.
 */
export function deriveZuperLastActivity(
  jobs: ZuperJobLike[],
  now: Date = new Date(),
): string | null {
  const nowMs = now.getTime();
  let best: number | null = null;
  for (const j of jobs) {
    for (const raw of [j.completedDate, j.scheduledStart]) {
      if (!raw) continue;
      const t = raw instanceof Date ? raw.getTime() : new Date(raw).getTime();
      if (
        Number.isFinite(t) &&
        t <= nowMs &&
        (best === null || t > best)
      ) {
        best = t;
      }
    }
  }
  return best === null ? null : new Date(best).toISOString();
}

/**
 * Most recent engagement timestamp on a HubSpot deal — covers manually-logged
 * notes/calls/emails/meetings that `notes_last_contacted` may miss.
 *
 * Uses the cached `getDealEngagements()` (5-min TTL per deal). Returns null on
 * fetch failure or empty result so the caller can fall back to other signals.
 */
export async function getDealEngagementsLastTimestamp(
  hubspotDealId: string,
): Promise<string | null> {
  try {
    const engagements = await getDealEngagements(hubspotDealId, false);
    if (!engagements || engagements.length === 0) return null;
    let best: number | null = null;
    for (const e of engagements) {
      const t = new Date(e.timestamp).getTime();
      if (Number.isFinite(t) && (best === null || t > best)) best = t;
    }
    return best === null ? null : new Date(best).toISOString();
  } catch (err) {
    console.warn(
      `[service-contact-signals] Engagements fetch failed for deal ${hubspotDealId}:`,
      err,
    );
    return null;
  }
}
