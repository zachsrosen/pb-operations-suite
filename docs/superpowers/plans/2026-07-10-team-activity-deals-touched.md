# Team Activity Deals-Touched Metric Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "distinct deals touched per day" metric (active-at-touch-time + 3-day buffer) to the team-activity dashboard, CLI, and CSV exports.

**Architecture:** Extend the existing 3-layer pipeline: the hubspot adapter additionally pulls engagements owned by roster members, attributes them to deals (direct association, else email→contact→deal hop), stamps every attributed deal active/inactive via a pure helper, and attaches a `deals[]` field to hubspot events; the pure metrics layer derives `dealsTouched`/`dealsTouchedAll` per person-day and `avgDealsTouched` per person; UI/CLI surface the numbers. Spec: `docs/superpowers/specs/2026-07-10-team-activity-deals-touched-design.md` — read it first; it is the contract.

**Tech Stack:** TypeScript, Next.js app router, Jest, HubSpot CRM v3/v4 APIs. No DB/schema changes.

**Worktree:** `.worktrees/team-activity-deals-touched`, branch `feat/team-activity-deals-touched`. Run all commands from the worktree root.

---

## Chunk 1: Pure metrics layer (TDD)

### Task 1: `isTouchOnActiveDeal` helper

**Files:**
- Modify: `src/lib/team-activity/metrics.ts` (add after `isWeekday`, ~line 103)
- Test: `src/__tests__/team-activity-metrics.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

In `src/__tests__/team-activity-metrics.test.ts`: add `isTouchOnActiveDeal` to
the EXISTING top-of-file metrics import (don't add a second import statement —
`import/first` lint). Then append:

```ts

describe("isTouchOnActiveDeal", () => {
  const t = (iso: string) => new Date(iso);

  it("counts a touch on a non-terminal stage as active", () => {
    expect(isTouchOnActiveDeal("Construction", "Project Pipeline", null, t("2026-07-01T12:00:00Z"))).toBe(true);
  });

  it("counts a terminal-stage touch within the 3-day buffer as active", () => {
    expect(
      isTouchOnActiveDeal("Project Complete", "Project Pipeline", t("2026-07-01T00:00:00Z"), t("2026-07-03T23:00:00Z")),
    ).toBe(true);
  });

  it("does not count a terminal-stage touch past the buffer", () => {
    expect(
      isTouchOnActiveDeal("Project Complete", "Project Pipeline", t("2026-07-01T00:00:00Z"), t("2026-07-04T00:00:01Z")),
    ).toBe(false);
  });

  it("treats a terminal-stage deal with no entered date as not active (conservative)", () => {
    expect(isTouchOnActiveDeal("Cancelled", "Project Pipeline", null, t("2026-07-01T12:00:00Z"))).toBe(false);
  });

  it("matches terminal labels case-insensitively and across hyphen variants", () => {
    const entered = t("2026-06-01T00:00:00Z");
    const touch = t("2026-07-01T00:00:00Z");
    for (const label of ["cancelled", "ON-HOLD", "On-hold", "project complete", "Complete", "Completed", "Closed lost", "Closed won"]) {
      expect(isTouchOnActiveDeal(label, "Project Pipeline", entered, touch)).toBe(false);
    }
  });

  it("excludes Test Pipeline deals from BOTH counts by returning null", () => {
    expect(isTouchOnActiveDeal("Contract Sent", "Test Pipeline", null, t("2026-07-01T12:00:00Z"))).toBe(null);
  });

  it("respects a custom buffer", () => {
    const entered = t("2026-07-01T00:00:00Z");
    expect(isTouchOnActiveDeal("Completed", "Service Pipeline", entered, t("2026-07-05T00:00:00Z"), 7)).toBe(true);
    expect(isTouchOnActiveDeal("Completed", "Service Pipeline", entered, t("2026-07-05T00:00:00Z"), 3)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest team-activity-metrics -t isTouchOnActiveDeal 2>&1 | tail -20`
Expected: FAIL — `isTouchOnActiveDeal` is not exported.

- [ ] **Step 3: Implement the helper**

In `src/lib/team-activity/metrics.ts`, after `isWeekday` (~line 103), add:

```ts
/**
 * Deals-touched stage rule (see 2026-07-10 deals-touched spec §Definitions).
 * Stage `metadata.isClosed` is useless in PB's portal (every post-sale stage is
 * closed), so terminal-ness is matched by label.
 *
 * Returns:
 *  - `true`  — deal counts as ACTIVE at touch time (non-terminal stage, or the
 *              touch is < bufferDays after the deal entered its terminal stage)
 *  - `false` — deal is terminal past the buffer (counts only in the all-count)
 *  - `null`  — deal is excluded from BOTH counts (Test Pipeline)
 */
export const TERMINAL_STAGE_LABELS = new Set([
  "cancelled",
  "on-hold",
  "onhold",
  "project complete",
  "complete",
  "completed",
  "closed lost",
  "closed won",
]);

export function isTouchOnActiveDeal(
  stageLabel: string,
  pipelineLabel: string,
  enteredTerminalAt: Date | null,
  touchAt: Date,
  bufferDays = 3,
): boolean | null {
  if (pipelineLabel.trim().toLowerCase() === "test pipeline") return null;
  if (!TERMINAL_STAGE_LABELS.has(stageLabel.trim().toLowerCase())) return true;
  if (!enteredTerminalAt) return false;
  return touchAt.getTime() < enteredTerminalAt.getTime() + bufferDays * 86_400_000;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest team-activity-metrics -t isTouchOnActiveDeal 2>&1 | tail -5`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/team-activity/metrics.ts src/__tests__/team-activity-metrics.test.ts
git commit -m "feat(team-activity): isTouchOnActiveDeal stage-buffer helper"
```

### Task 2: `dealsTouched` / `dealsTouchedAll` / `avgDealsTouched`

**Files:**
- Modify: `src/lib/team-activity/metrics.ts` (`ActivityEvent`, `PersonDayMetric`, `computePersonDays`, `PersonSummary`, `rollupByPerson`)
- Test: `src/__tests__/team-activity-metrics.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append:

```ts
describe("dealsTouched metrics", () => {
  const ev = (over: Partial<ActivityEvent>): ActivityEvent => ({
    email: "pm@photonbrothers.com",
    timestamp: new Date("2026-07-01T17:00:00Z"), // 11:00 Denver, weekday (Wed)
    source: "hubspot",
    ...over,
  });

  it("counts distinct active deals per day; repeat touches of one deal count once", () => {
    const days = computePersonDays([
      ev({ deals: [{ id: "1", active: true }], objectKey: "DEAL:1", kind: "engagement/emails" }),
      ev({ deals: [{ id: "1", active: true }], objectKey: "DEAL:1", kind: "CRM_OBJECT/UPDATE", timestamp: new Date("2026-07-01T18:00:00Z") }),
      ev({ deals: [{ id: "2", active: false }], objectKey: "DEAL:2", kind: "engagement/notes" }),
    ]);
    expect(days).toHaveLength(1);
    expect(days[0].dealsTouched).toBe(1); // deal 2 is inactive
    expect(days[0].dealsTouchedAll).toBe(2);
  });

  it("a multi-deal engagement counts each attributed deal once but stays one event", () => {
    const days = computePersonDays([
      ev({ deals: [{ id: "1", active: true }, { id: "2", active: true }], objectKey: "DEAL:1", kind: "engagement/emails" }),
    ]);
    expect(days[0].dealsTouched).toBe(2);
    expect(days[0].eventCount).toBe(1);
    expect(days[0].interactions).toBe(1);
  });

  it("ignores DEAL:-keyed events without a deals field (zuper/pe) in both counts", () => {
    const days = computePersonDays([
      ev({ source: "zuper", objectKey: "DEAL:9", kind: "job status" }),
      ev({ source: "pe", objectKey: "DEAL:9", kind: "uploaded doc" }),
      ev({ source: "hubspot", objectKey: "DEAL:9", kind: "login" }), // no deals field either
    ]);
    expect(days[0].dealsTouched).toBe(0);
    expect(days[0].dealsTouchedAll).toBe(0);
  });

  it("only hubspot-source events feed the counts even if deals is present", () => {
    const days = computePersonDays([ev({ source: "zuper", deals: [{ id: "1", active: true }] })]);
    expect(days[0].dealsTouched).toBe(0);
    expect(days[0].dealsTouchedAll).toBe(0);
  });

  it("rollupByPerson averages dealsTouched over active weekdays", () => {
    const days = computePersonDays([
      ev({ deals: [{ id: "1", active: true }, { id: "2", active: true }] }), // Wed 7/1
      ev({ deals: [{ id: "3", active: true }] , timestamp: new Date("2026-07-02T17:00:00Z") }), // Thu 7/2
      ev({ deals: [{ id: "4", active: true }] , timestamp: new Date("2026-07-04T17:00:00Z") }), // Sat — excluded from avg
    ]);
    const [s] = rollupByPerson(days);
    expect(s.avgDealsTouched).toBeCloseTo(1.5); // (2 + 1) / 2 weekdays
  });
});
```

(Ensure the test file's existing imports include `computePersonDays`, `rollupByPerson`, `type ActivityEvent` — extend the import line if needed.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest team-activity-metrics -t "dealsTouched metrics" 2>&1 | tail -20`
Expected: FAIL — `dealsTouched` undefined / type error on `deals`.

- [ ] **Step 3: Implement**

In `src/lib/team-activity/metrics.ts`:

1. `ActivityEvent` — add after `label?`:

```ts
  /**
   * Deal attribution for the deals-touched metric — set ONLY by the hubspot
   * adapter (engagements + audit DEAL edits). One entry per attributed deal
   * with its active-at-touch-time verdict. Other adapters never populate this,
   * so Zuper/PE `DEAL:`-keyed events don't feed the deal counts.
   */
  deals?: { id: string; active: boolean }[];
```

2. `PersonDayMetric` — add after `googleSpanHours`:

```ts
  /** distinct deals with an active-at-touch-time hubspot touch this day */
  dealsTouched: number;
  /** distinct deals touched regardless of stage/age (Test Pipeline excluded upstream) */
  dealsTouchedAll: number;
```

3. In `computePersonDays`, inside the per-group loop (next to the `perSource` accumulation), add:

```ts
    const activeDeals = new Set<string>();
    const allDeals = new Set<string>();
    for (const e of evs) {
      if (e.source !== "hubspot" || !e.deals) continue;
      for (const d of e.deals) {
        allDeals.add(d.id);
        if (d.active) activeDeals.add(d.id);
      }
    }
```

and in the pushed object: `dealsTouched: activeDeals.size, dealsTouchedAll: allDeals.size,`.

4. `PersonSummary` — add `avgDealsTouched: number;` after `avgGoogleSpanHours`. In `rollupByPerson`, add `avgDealsTouched: avg(weekdays.map((d) => d.dealsTouched)),` to the pushed object.

- [ ] **Step 4: Run the full metrics suite**

Run: `npx jest team-activity-metrics 2>&1 | tail -5`
Expected: PASS, including all pre-existing tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/team-activity/metrics.ts src/__tests__/team-activity-metrics.test.ts
git commit -m "feat(team-activity): dealsTouched/dealsTouchedAll person-day metrics"
```

## Chunk 2: HubSpot adapter engagement pull + stamping

### Task 3: Adapter helpers (fetch/search/assoc/deal-status)

**Files:**
- Modify: `src/lib/team-activity/adapters.ts`

No unit tests for these (thin I/O; the pure rule is already tested) — verified by tsc now and the live CLI run in Task 8.

- [ ] **Step 1: Add `warning` to `AdapterResult`**

```ts
export interface AdapterResult {
  events: ActivityEvent[];
  talk?: TalkTimeRecord[];
  skipped?: string;
  /** Source ran but with degraded coverage (e.g. search cap hit, engagement pull failed). */
  warning?: string;
}
```

- [ ] **Step 2: Add a 429-retrying fetch and route `hsGet` through it**

Replace the existing `hsGet` (line ~188) with:

```ts
async function hsFetch(path: string, token: string, init?: RequestInit, retries = 5): Promise<Response> {
  for (let i = 0; ; i++) {
    const res = await fetch(`https://api.hubapi.com${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    if (res.status === 429 && i < retries) {
      await new Promise((r) => setTimeout(r, 1_000 * (i + 1)));
      continue;
    }
    return res;
  }
}

async function hsGet(path: string, token: string): Promise<Response> {
  return hsFetch(path, token);
}
```

- [ ] **Step 3: Add engagement/deal helpers**

After `hsResolveUserIds` (~line 232), add:

```ts
// ---------------------------------------------------------------------------
// Deals-touched: engagement pull + active-deal stamping
// (see docs/superpowers/specs/2026-07-10-team-activity-deals-touched-design.md)
// ---------------------------------------------------------------------------
const ENGAGEMENT_TYPES = ["notes", "calls", "emails", "meetings", "tasks", "communications"] as const;
type EngagementType = (typeof ENGAGEMENT_TYPES)[number];
const SEARCH_CAP = 9_800; // CRM search hard-stops at 10k results per query
const OWNER_CHUNK = 5; // owners per search — keeps each query's volume under the cap

interface HsOwner { id: number | string; email?: string }

/** Resolve roster members -> HubSpot OWNER id (engagements filter on this, not userId). */
async function hsResolveOwnerIds(roster: RosterMember[], token: string): Promise<Map<string, string>> {
  const resolved = new Map<string, string>(); // canonical email -> ownerId
  await mapPool(roster, 5, async (m) => {
    for (const email of memberEmails(m)) {
      const res = await hsFetch(`/crm/v3/owners?email=${encodeURIComponent(email)}`, token);
      if (!res.ok) continue;
      const data = (await res.json()) as { results?: HsOwner[] };
      const id = data.results?.[0]?.id;
      if (id != null) {
        resolved.set(m.email.toLowerCase(), String(id));
        return;
      }
    }
  });
  return resolved;
}

interface EngagementHit { id: string; ownerId: string; ts: Date; type: EngagementType }

/** Search one engagement type for all owners (chunked); ascending hs_timestamp. */
async function searchEngagements(
  type: EngagementType,
  ownerIds: string[],
  range: DateRange,
  token: string,
): Promise<{ hits: EngagementHit[]; capped: boolean }> {
  const hits: EngagementHit[] = [];
  let capped = false;
  for (let i = 0; i < ownerIds.length; i += OWNER_CHUNK) {
    const chunk = ownerIds.slice(i, i + OWNER_CHUNK);
    let after: string | undefined;
    let got = 0;
    for (;;) {
      const res = await hsFetch(`/crm/v3/objects/${type}/search`, token, {
        method: "POST",
        body: JSON.stringify({
          filterGroups: [
            {
              filters: [
                { propertyName: "hubspot_owner_id", operator: "IN", values: chunk },
                {
                  propertyName: "hs_timestamp",
                  operator: "BETWEEN",
                  value: String(range.from.getTime()),
                  highValue: String(range.to.getTime()),
                },
              ],
            },
          ],
          properties: ["hubspot_owner_id", "hs_timestamp"],
          sorts: [{ propertyName: "hs_timestamp", direction: "ASCENDING" }],
          limit: 100,
          ...(after ? { after } : {}),
        }),
      });
      if (!res.ok) throw new Error(`${type} search HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
      const data = (await res.json()) as HsPage<{ id: string; properties?: Record<string, string> }>;
      for (const r of data.results ?? []) {
        const ownerId = r.properties?.hubspot_owner_id;
        const ts = new Date(r.properties?.hs_timestamp ?? NaN);
        if (!ownerId || isNaN(+ts)) continue;
        hits.push({ id: r.id, ownerId, ts, type });
        got++;
      }
      const next = data.paging?.next?.after;
      if (!next) break;
      if (got >= SEARCH_CAP) {
        capped = true;
        break;
      }
      after = next;
      await new Promise((r) => setTimeout(r, 40));
    }
  }
  return { hits, capped };
}

/** v4 batch association read, chunked at 100. Returns fromId -> toIds. */
async function batchAssocRead(
  fromType: string,
  toType: string,
  ids: string[],
  token: string,
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  const uniq = [...new Set(ids)];
  for (let i = 0; i < uniq.length; i += 100) {
    const chunk = uniq.slice(i, i + 100);
    const res = await hsFetch(`/crm/v4/associations/${fromType}/${toType}/batch/read`, token, {
      method: "POST",
      body: JSON.stringify({ inputs: chunk.map((id) => ({ id })) }),
    });
    if (!res.ok) throw new Error(`${fromType}->${toType} assoc HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const data = (await res.json()) as {
      results?: { from: { id: string | number }; to?: { toObjectId: string | number }[] }[];
    };
    for (const r of data.results ?? []) {
      const key = String(r.from.id);
      map.set(key, [...(map.get(key) ?? []), ...(r.to ?? []).map((t) => String(t.toObjectId))]);
    }
  }
  return map;
}

interface DealStatus { stageLabel: string; pipelineLabel: string; enteredTerminalAt: Date | null }

/**
 * Stage + (for terminal stages) entered-date for each deal. Deals the batch
 * read doesn't return (deleted/archived) are absent from the map — the caller
 * excludes their touches from both counts.
 */
async function fetchDealStatuses(dealIds: string[], token: string): Promise<Map<string, DealStatus>> {
  const out = new Map<string, DealStatus>();
  if (!dealIds.length) return out;

  const pipesRes = await hsFetch("/crm/v3/pipelines/deals", token);
  if (!pipesRes.ok) throw new Error(`pipelines HTTP ${pipesRes.status}`);
  const pipes = (await pipesRes.json()) as { results?: { label: string; stages: { id: string; label: string }[] }[] };
  const stageMeta = new Map<string, { label: string; pipeline: string }>();
  for (const p of pipes.results ?? []) {
    for (const s of p.stages) stageMeta.set(String(s.id), { label: s.label, pipeline: p.label });
  }

  const stageByDeal = new Map<string, string>();
  for (let i = 0; i < dealIds.length; i += 100) {
    const chunk = dealIds.slice(i, i + 100);
    const res = await hsFetch("/crm/v3/objects/deals/batch/read", token, {
      method: "POST",
      body: JSON.stringify({ inputs: chunk.map((id) => ({ id })), properties: ["dealstage"] }),
    });
    if (!res.ok) throw new Error(`deals batch read HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const data = (await res.json()) as { results?: { id: string | number; properties?: Record<string, string> }[] };
    for (const r of data.results ?? []) {
      if (r.properties?.dealstage) stageByDeal.set(String(r.id), r.properties.dealstage);
    }
  }

  // Terminal-stage deals need hs_v2_date_entered_<stageId> (the un-prefixed
  // hs_date_entered_* props do NOT exist in PB's portal).
  const terminal: { id: string; stageId: string }[] = [];
  for (const [id, stageId] of stageByDeal) {
    const meta = stageMeta.get(stageId);
    if (meta && TERMINAL_STAGE_LABELS.has(meta.label.trim().toLowerCase())) terminal.push({ id, stageId });
  }
  const enteredByDeal = new Map<string, Date>();
  if (terminal.length) {
    const props = [...new Set(terminal.map((t) => `hs_v2_date_entered_${t.stageId}`))];
    for (let i = 0; i < terminal.length; i += 100) {
      const chunk = terminal.slice(i, i + 100);
      const res = await hsFetch("/crm/v3/objects/deals/batch/read", token, {
        method: "POST",
        body: JSON.stringify({ inputs: chunk.map((t) => ({ id: t.id })), properties: ["dealstage", ...props] }),
      });
      if (!res.ok) throw new Error(`entered-date batch read HTTP ${res.status}`);
      const data = (await res.json()) as { results?: { id: string | number; properties?: Record<string, string> }[] };
      for (const r of data.results ?? []) {
        const entered = r.properties?.[`hs_v2_date_entered_${r.properties?.dealstage}`];
        if (entered) enteredByDeal.set(String(r.id), new Date(entered));
      }
    }
  }

  for (const [id, stageId] of stageByDeal) {
    const meta = stageMeta.get(stageId);
    if (!meta) continue;
    out.set(id, { stageLabel: meta.label, pipelineLabel: meta.pipeline, enteredTerminalAt: enteredByDeal.get(id) ?? null });
  }
  return out;
}
```

Add `TERMINAL_STAGE_LABELS, isTouchOnActiveDeal` to the metrics import at the top of the file.

- [ ] **Step 4: Typecheck (expect unused-symbol errors ONLY)**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: TS6133 "declared but never used" for the new helpers (the repo sets
`noUnusedLocals`) and NOTHING else. Any other error class means a real bug —
fix before proceeding. Do NOT commit yet; Task 4 wires the helpers in and both
tasks commit together there.

### Task 4: Wire the pull into `hubspotAdapter`

**Files:**
- Modify: `src/lib/team-activity/adapters.ts` (`hubspotAdapter`, lines ~234–288)

- [ ] **Step 1: Extend `hubspotAdapter`**

Inside `hubspotAdapter`, after the existing audit/login `perMember` block builds `const events = perMember.flat();`, replace the current ending (`if (scopeError…) … return { events };`) with:

```ts
  const events = perMember.flat();
  if (scopeError && events.length === 0) return { events, skipped: scopeError };

  // --- deals-touched: engagement pull + active-deal stamping ---------------
  // Failure here degrades to a warning: audit/login events still render, only
  // the deals-touched numbers are missing/floored.
  let warning: string | undefined;
  try {
    const ownerIds = await hsResolveOwnerIds(roster, token);
    const emailByOwner = new Map([...ownerIds.entries()].map(([email, id]) => [id, email] as const));
    const ownerList = [...new Set(ownerIds.values())];
    // A portal-wide owners failure must not silently floor the metric to
    // audit-only — surface it.
    if (roster.length && !ownerList.length) {
      warning = "no roster members resolved to a HubSpot owner — deals-touched reflects audit-log edits only";
    }

    const engagementTouches: { hit: EngagementHit; dealIds: string[] }[] = [];
    if (ownerList.length) {
      const capped: string[] = [];
      const failed: string[] = [];
      // Per-type catch: one failing engagement type (e.g. a missing scope)
      // degrades that type only, not the whole metric.
      const perType = await mapPool([...ENGAGEMENT_TYPES], 3, async (type) => {
        try {
          const { hits, capped: hitCap } = await searchEngagements(type, ownerList, range, token);
          if (hitCap) capped.push(type);
          return { type, hits };
        } catch (e) {
          failed.push(`${type} (${msg(e).slice(0, 80)})`);
          return { type, hits: [] as EngagementHit[] };
        }
      });
      const notes = [
        ...(capped.length ? [`search cap hit for ${capped.join(", ")}`] : []),
        ...(failed.length ? [`search failed for ${failed.join("; ")}`] : []),
      ];
      if (notes.length) warning = `engagement pull degraded: ${notes.join("; ")} — deal counts are floor values`;

      for (const { type, hits } of perType) {
        if (!hits.length) continue;
        const dealAssoc = await batchAssocRead(type, "deals", hits.map((h) => h.id), token);
        const orphans = hits.filter((h) => !(dealAssoc.get(h.id) ?? []).length);
        let contactAssoc = new Map<string, string[]>();
        let contactDeals = new Map<string, string[]>();
        if (orphans.length) {
          contactAssoc = await batchAssocRead(type, "contacts", orphans.map((h) => h.id), token);
          const contactIds = [...new Set([...contactAssoc.values()].flat())];
          if (contactIds.length) contactDeals = await batchAssocRead("contacts", "deals", contactIds, token);
        }
        for (const hit of hits) {
          let dealIds = dealAssoc.get(hit.id) ?? [];
          if (!dealIds.length) {
            dealIds = [...new Set((contactAssoc.get(hit.id) ?? []).flatMap((c) => contactDeals.get(c) ?? []))];
          }
          if (dealIds.length) engagementTouches.push({ hit, dealIds });
          // No deal even via contacts -> noise (notification emails) or
          // non-deal work; dropped per spec.
        }
      }
    }

    // Distinct deals from engagements + already-emitted audit DEAL rows.
    // Numeric ids only — audit rows can yield "DEAL:undefined", and one
    // malformed id 400s the whole batch read.
    const allDealIds = new Set<string>(engagementTouches.flatMap((t) => t.dealIds).filter((id) => /^\d+$/.test(id)));
    for (const ev of events) {
      const id = ev.objectKey?.startsWith("DEAL:") ? ev.objectKey.slice(5) : null;
      if (id && /^\d+$/.test(id)) allDealIds.add(id);
    }
    const statuses = await fetchDealStatuses([...allDealIds], token);
    const verdict = (dealId: string, ts: Date): boolean | null => {
      const st = statuses.get(dealId);
      if (!st) return null; // unreadable deal — exclude from both counts
      return isTouchOnActiveDeal(st.stageLabel, st.pipelineLabel, st.enteredTerminalAt, ts);
    };

    // Emit ONE event per engagement, with all attributed deals on it.
    for (const { hit, dealIds } of engagementTouches) {
      const email = emailByOwner.get(hit.ownerId);
      if (!email) continue; // engagement owned by a non-roster owner in the chunk
      const deals = dealIds
        .map((id) => ({ id, active: verdict(id, hit.ts) }))
        .filter((d): d is { id: string; active: boolean } => d.active !== null);
      events.push({
        email,
        timestamp: hit.ts,
        source: "hubspot",
        kind: `engagement/${hit.type}`,
        objectKey: deals[0] ? `DEAL:${deals[0].id}` : undefined,
        deals: deals.length ? deals : undefined,
      });
    }

    // Stamp the audit-log DEAL edits so they feed the same counts.
    for (const ev of events) {
      if (ev.deals || !ev.objectKey?.startsWith("DEAL:")) continue;
      const id = ev.objectKey.slice(5);
      const v = verdict(id, ev.timestamp);
      if (v !== null) ev.deals = [{ id, active: v }];
    }
  } catch (e) {
    warning = `engagement pull failed (${msg(e)}) — deals-touched unavailable for this run`;
  }

  return { events, warning };
```

Note: `emailByOwner` maps ownerId→canonical email. Two roster members can't share an owner id, so the map is safe.

- [ ] **Step 2: Typecheck + full test suite**

Run: `npx tsc --noEmit && npx jest team-activity 2>&1 | tail -5`
Expected: clean tsc (the Task 3 helpers are now used), all Jest green.

- [ ] **Step 3: Commit (covers Tasks 3+4)**

```bash
git add src/lib/team-activity/adapters.ts
git commit -m "feat(team-activity): pull owned engagements and stamp deals-touched in hubspotAdapter"
```

### Task 5: Warning plumbing (API route)

**Files:**
- Modify: `src/app/api/admin/team-activity/route.ts` (~lines 88, 100–110)

- [ ] **Step 1: Pass warnings through**

Change `ran` to carry an optional warning and populate it:

```ts
  const ran: { source: string; events: number; warning?: string }[] = [];
```

and in the results loop:

```ts
    if (res.skipped) skipped.push({ source: r.key, reason: res.skipped });
    else ran.push({ source: r.key, events: res.events.length, ...(res.warning ? { warning: res.warning } : {}) });
```

(The events drilldown route at `src/app/api/admin/team-activity/events/route.ts` needs NO change — it consumes `result.events` generically; verify while editing that it compiles against the new `AdapterResult`.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/admin/team-activity/route.ts
git commit -m "feat(team-activity): surface adapter warnings in API response"
```

## Chunk 3: Surfaces (UI, CLI, roster) + verification

### Task 6: Dashboard UI

**Files:**
- Modify: `src/app/dashboards/admin/team-activity/TeamActivityClient.tsx`

- [ ] **Step 1: Summary table column**

1. `HEADERS` (line ~55): insert `"Deals/day",` after `"Interactions/day",`.
2. In the summary row (after the `avgInteractions` cell, line ~198), insert:

```tsx
                  <td className="px-3 py-2 text-right">{s.avgDealsTouched ? h1(s.avgDealsTouched) : "—"}</td>
```

3. Header alignment: the `<th>` right-align condition `i >= 1 && i <= 8` becomes `i >= 1 && i <= 9`.
4. Both `colSpan={10}` occurrences (expanded detail row ~line 211, empty row ~line 306) become `colSpan={11}`.
5. `ApiResponse["sources"]["ran"]` type gains `warning?: string`.

- [ ] **Step 2: Per-day detail column**

In the inner detail table: add `"Deals"` to the header array after `"Interactions"` (and bump its right-align condition from `i >= 1 && i <= 7` to `i >= 1 && i <= 8`); after the interactions `<td>` (~line 239) insert:

```tsx
                                    <td className="px-2 py-1 text-right">
                                      {d.dealsTouched}
                                      {d.dealsTouchedAll !== d.dealsTouched && (
                                        <span className="text-muted"> ({d.dealsTouchedAll})</span>
                                      )}
                                    </td>
```

Bump the drilldown row's `colSpan={9}` (~line 253) to `colSpan={10}`.

- [ ] **Step 3: Warning badge on the source-status banner**

In the `data.sources.ran.map` block (~line 525), render a warning variant:

```tsx
          {data.sources.ran.map((s) => (
            <span
              key={s.source}
              title={s.warning}
              className={`text-xs px-2 py-1 rounded-md border ${
                s.warning
                  ? "bg-amber-500/10 text-amber-300 border-amber-500/30 cursor-help"
                  : "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
              }`}
            >
              {SOURCE_LABEL[s.source as ActivitySource] ?? s.source} · {s.events.toLocaleString()} events
              {s.warning ? " ⚠" : ""}
            </span>
          ))}
```

- [ ] **Step 4: CSV export + footnote**

In `exportRows` (~line 436) add `avgDealsTouched: h1(s.avgDealsTouched),` after `avgInteractions`. Extend the footnote paragraph (~line 622) with one sentence:

```
&ldquo;Deals/day&rdquo; counts distinct HubSpot deals with logged activity or edits that day, only while the deal was active (3-day grace after completion).
```

- [ ] **Step 5: Typecheck + lint, commit**

Run: `npx tsc --noEmit && npx eslint src/app/dashboards/admin/team-activity/ 2>&1 | tail -5`
Expected: clean.

```bash
git add src/app/dashboards/admin/team-activity/TeamActivityClient.tsx
git commit -m "feat(team-activity): Deals/day column, per-day detail, warning badge, CSV export"
```

### Task 7: CLI + roster

**Files:**
- Modify: `scripts/team-activity-report.ts`
- Modify: `src/lib/team-activity/roster.ts`

- [ ] **Step 1: CLI columns**

In `scripts/team-activity-report.ts`:

1. Daily CSV (line ~112): headers become

```ts
    ["email", "name", "day", "weekday", "events", "interactions", "dealsTouched", "dealsTouchedAll", "spanHours", "activeHours", "talkMinutes", "calls", "googleSpanHours", "pbops", "aircall", "zuper", "hubspot", "google", "pe", "firstLocal", "lastLocal"],
```

and the row mapper inserts `d.dealsTouched, d.dealsTouchedAll,` after `d.interactions` and `d.perSource.pe,` after `d.perSource.google` (fixes the pre-existing missing `pe` column).

2. Summary CSV (line ~122): insert `"avgDealsTouched"` after `"avgInteractions"` in the headers and `s.avgDealsTouched.toFixed(1),` after `s.avgInteractions.toFixed(1),` in the row.

3. Console table (lines ~138–142): insert `${pad("Deals/d", 7)}` after the `Intx/d` header cell and `${pad(s.avgDealsTouched.toFixed(1), 7)}` after the interactions cell.

4. Warning display — extend the run loop (lines ~88–98) so warnings print with the source status:

```ts
      if (r.skipped) skipped.push(`${a.key}: ${r.skipped}`);
      else ran.push(`${a.key} (${r.events.length} events${r.warning ? `; WARN ${r.warning}` : ""})`);
```

- [ ] **Step 2: Roster — add Wes**

In `src/lib/team-activity/roster.ts` `DEFAULT_ROSTER`, append:

```ts
  { email: "wes.benscoter@photonbrothers.com", name: "Wes Benscoter" },
```

(Identity verified against the User table 2026-07-10; the only PROJECT_MANAGER-role user not already listed. Update the roster doc comment's "Default =" line to mention the PM addition.)

- [ ] **Step 3: Typecheck, commit**

Run: `npx tsc --noEmit`
Expected: clean.

```bash
git add scripts/team-activity-report.ts src/lib/team-activity/roster.ts
git commit -m "feat(team-activity): deals-touched in CLI report; add Wes Benscoter to roster"
```

### Task 8: Verification

- [ ] **Step 1: Full test + lint + typecheck**

Run: `npx jest 2>&1 | tail -5 && npx tsc --noEmit && npm run lint 2>&1 | tail -5`
Expected: all green. (Full Jest, not just team-activity — the `ActivityEvent` change is consumed elsewhere.)

- [ ] **Step 2: Live CLI run (read-only against prod APIs)**

Run: `npx tsx --env-file=.env scripts/team-activity-report.ts --from 2026-06-26 --to 2026-07-10 --only hubspot --out ./tmp/reports 2>&1 | tail -25`

(The worktree has no `.env` — copy it first: `cp "/Users/zach/Downloads/Dev Projects/PB-Operations-Suite/.env" .env` — it is gitignored; verify with `git status --short | grep -c "\.env$"` → 0.)

Expected: hubspot source runs (no skip), console table shows a `Deals/d` column with non-zero values for Kaitlyn (~35–40), Alexis (~25–30), Kat (~10–12), Natasha (~10–12, includes buffer), near-zero for Wes. Cross-check against the 2026-07-10 ad-hoc analysis: same ballpark ±20% (window-boundary drift is expected; a 2x discrepancy means an attribution bug — stop and debug).

Wes caveat: near-zero for Wes is expected but ALSO what a wrong email would
produce. Confirm his roster entry actually resolves before accepting the run:

Run: `source <(grep '^HUBSPOT_ACCESS_TOKEN=' .env | sed 's/^/export /') && curl -s "https://api.hubapi.com/crm/v3/owners?email=wes.benscoter@photonbrothers.com" -H "Authorization: Bearer $HUBSPOT_ACCESS_TOKEN" | head -c 200`
Expected: a result with `"id": "169921517"` (verified 2026-07-10).

- [ ] **Step 3: Daily CSV spot-check**

Run: `head -3 ./tmp/reports/team-activity-daily-2026-06-26_2026-07-10.csv`
Expected: header includes `dealsTouched,dealsTouchedAll` and `pe`; rows populate them.

- [ ] **Step 4: Commit any fixes; final commit**

```bash
git add -A && git status --short   # confirm only intended files
git commit -m "test(team-activity): live verification fixes" # only if fixes were needed
```

**Completion:** hand off per superpowers:finishing-a-development-branch — push branch, open PR against main (deploys go through GitHub per project convention). PR description should link the spec and summarize the metric definition + baseline-shift note.
