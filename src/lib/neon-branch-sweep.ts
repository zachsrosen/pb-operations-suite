/**
 * Neon Branch Sweep
 *
 * Deletes stale Vercel-created preview branches from the Neon project so they
 * cannot accumulate and rack up "extra branch" charges. The Neon↔Vercel
 * integration creates a branch per preview deployment; its "auto-delete
 * obsolete branches" toggle has proven unreliable (it let ~580 branches pile
 * up), so this is the durable backstop.
 *
 * Safety: only ever targets branches that are ALL of:
 *   - named `preview/*` (Vercel integration naming)
 *   - not the default branch (production is the default)
 *   - not protected
 *   - older than `maxAgeDays`
 * The production branch is never eligible under any configuration.
 */

const NEON_API_BASE = "https://console.neon.tech/api/v2";

export interface NeonBranch {
  id: string;
  name: string;
  default?: boolean;
  protected?: boolean;
  created_at: string; // ISO 8601
}

export interface SweepConfig {
  projectId: string;
  apiKey: string;
  maxAgeDays: number;
}

export interface SweepResult {
  scanned: number;
  eligible: number;
  deleted: number;
  failed: number;
  failures: Array<{ id: string; name: string }>;
  dryRun: boolean;
}

/**
 * Pure selector — which branches are safe to delete. Kept side-effect free so
 * the deletion criteria can be unit-tested without hitting the network.
 */
export function selectStalePreviewBranches(
  branches: NeonBranch[],
  nowMs: number,
  maxAgeDays: number,
): NeonBranch[] {
  const cutoff = nowMs - maxAgeDays * 24 * 60 * 60 * 1000;
  return branches.filter((b) => {
    if (b.default) return false;
    if (b.protected) return false;
    if (!b.name || !b.name.startsWith("preview/")) return false;
    const created = Date.parse(b.created_at);
    if (Number.isNaN(created)) return false; // unknown age → never delete
    return created < cutoff;
  });
}

async function listAllBranches(
  projectId: string,
  apiKey: string,
): Promise<NeonBranch[]> {
  const out: NeonBranch[] = [];
  let cursor: string | undefined;
  do {
    const qs = new URLSearchParams({ limit: "100" });
    if (cursor) qs.set("cursor", cursor);
    const res = await fetch(
      `${NEON_API_BASE}/projects/${projectId}/branches?${qs.toString()}`,
      { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } },
    );
    if (!res.ok) {
      throw new Error(`Neon list branches failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as {
      branches?: NeonBranch[];
      pagination?: { cursor?: string };
    };
    const page = data.branches ?? [];
    out.push(...page);
    cursor = page.length === 100 ? data.pagination?.cursor : undefined;
  } while (cursor);
  return out;
}

async function deleteBranch(
  projectId: string,
  branchId: string,
  apiKey: string,
): Promise<boolean> {
  const res = await fetch(
    `${NEON_API_BASE}/projects/${projectId}/branches/${branchId}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } },
  );
  return res.ok;
}

/**
 * List → select stale → delete (unless dryRun). Deletes sequentially with a
 * small delay to stay well under Neon's API rate limit.
 */
export async function sweepStalePreviewBranches(
  config: SweepConfig,
  opts: { nowMs?: number; dryRun?: boolean; delayMs?: number } = {},
): Promise<SweepResult> {
  const nowMs = opts.nowMs ?? Date.now();
  const dryRun = opts.dryRun ?? false;
  const delayMs = opts.delayMs ?? 150;

  const branches = await listAllBranches(config.projectId, config.apiKey);
  const stale = selectStalePreviewBranches(branches, nowMs, config.maxAgeDays);

  let deleted = 0;
  let failed = 0;
  const failures: Array<{ id: string; name: string }> = [];

  if (!dryRun) {
    for (const b of stale) {
      const ok = await deleteBranch(config.projectId, b.id, config.apiKey);
      if (ok) {
        deleted += 1;
      } else {
        failed += 1;
        failures.push({ id: b.id, name: b.name });
      }
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return { scanned: branches.length, eligible: stale.length, deleted, failed, failures, dryRun };
}
