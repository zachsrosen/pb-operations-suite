// ---------------------------------------------------------------------------
// PE document uploader (owner) overrides
//
// The analytics attribution credits a doc to whoever uploaded its latest
// version. That's wrong when a later, incorrect version supersedes an earlier
// correct one (e.g. Wes's v2 was approved but Layla's v1 was the right doc).
// These overrides let an admin pin the credited uploader for a (deal, doc),
// winning over the latest-version rule.
//
// Stored as a single JSON row in SystemConfig — no migration, low volume.
// ---------------------------------------------------------------------------

import { prisma } from "@/lib/db";

const CONFIG_KEY = "pe_uploader_overrides";

export interface UploaderOverride {
  uploader: string; // email credited, or "" to attribute to Unknown
  setBy: string;
  reason: string;
  at: string; // ISO
  versionAtOverride?: number; // doc's latest version number when the override was set
  notifiedVersion?: number; // highest version we've already alerted on (re-check guard)
}

export type UploaderOverrideMap = Record<string, UploaderOverride>; // key: `${dealId}|${docName}`

export function overrideKey(dealId: string, docName: string): string {
  return `${dealId}|${docName}`;
}

export async function getUploaderOverridesRaw(): Promise<UploaderOverrideMap> {
  if (!prisma) return {};
  const row = await prisma.systemConfig.findUnique({ where: { key: CONFIG_KEY } });
  if (!row?.value) return {};
  try {
    const parsed = JSON.parse(row.value);
    return parsed && typeof parsed === "object" ? (parsed as UploaderOverrideMap) : {};
  } catch {
    return {};
  }
}

/** Flat key -> credited-uploader map for overlaying onto latestUploaderByDoc. */
export async function getUploaderOverrideMap(): Promise<Map<string, string | null>> {
  const raw = await getUploaderOverridesRaw();
  const out = new Map<string, string | null>();
  for (const [k, v] of Object.entries(raw)) {
    out.set(k, v.uploader ? v.uploader : null); // "" -> Unknown attribution
  }
  return out;
}

/** Set (uploader non-empty) or clear (uploader null/empty) an override. */
export async function setUploaderOverride(args: {
  dealId: string;
  docName: string;
  uploader: string | null;
  setBy: string;
  reason?: string;
}): Promise<void> {
  if (!prisma) throw new Error("Database not available");
  const raw = await getUploaderOverridesRaw();
  const key = overrideKey(args.dealId, args.docName);
  const clear = args.uploader === null;
  if (clear) {
    delete raw[key];
  } else {
    // Capture the doc's current latest version so a later resubmission (a
    // higher version) can be detected and flagged for re-check.
    const v = await currentMaxVersion(args.dealId, args.docName);
    raw[key] = {
      uploader: args.uploader ?? "",
      setBy: args.setBy,
      reason: args.reason ?? "",
      at: new Date().toISOString(),
      versionAtOverride: v,
      notifiedVersion: v,
    };
  }
  await prisma.systemConfig.upsert({
    where: { key: CONFIG_KEY },
    create: { key: CONFIG_KEY, value: JSON.stringify(raw) },
    update: { value: JSON.stringify(raw) },
  });
}

async function currentMaxVersion(dealId: string, docName: string): Promise<number> {
  if (!prisma) return 0;
  const agg = await prisma.peDocVersion.aggregate({
    where: { dealId, docName },
    _max: { version: true },
  });
  return agg._max.version ?? 0;
}

export interface ResubmittedOverride {
  dealId: string;
  docName: string;
  uploader: string; // currently-credited (overridden) email
  setBy: string;
  fromVersion: number; // version when the override was set
  toVersion: number; // new latest version
}

/**
 * Find overrides whose doc has a NEW version above the one we last alerted on,
 * and bump their `notifiedVersion` so each resubmission only alerts once.
 * Returns the freshly-resubmitted overrides for notification.
 */
export async function detectAndConsumeResubmissions(): Promise<ResubmittedOverride[]> {
  if (!prisma) return [];
  const raw = await getUploaderOverridesRaw();
  const keys = Object.keys(raw);
  if (keys.length === 0) return [];

  const found: ResubmittedOverride[] = [];
  let changed = false;
  for (const key of keys) {
    const ov = raw[key];
    const sep = key.indexOf("|");
    const dealId = key.slice(0, sep);
    const docName = key.slice(sep + 1);
    const current = await currentMaxVersion(dealId, docName);
    // Legacy overrides (set before version tracking) have no baseline. Establish
    // one at the current version without alarming — only genuine FUTURE
    // resubmissions (a version above this baseline) should notify.
    if (ov.versionAtOverride == null) {
      raw[key] = { ...ov, versionAtOverride: current, notifiedVersion: current };
      changed = true;
      continue;
    }
    const baseline = ov.notifiedVersion ?? ov.versionAtOverride;
    if (current > baseline) {
      found.push({ dealId, docName, uploader: ov.uploader, setBy: ov.setBy, fromVersion: ov.versionAtOverride, toVersion: current });
      raw[key] = { ...ov, notifiedVersion: current };
      changed = true;
    }
  }
  if (changed) {
    await prisma.systemConfig.upsert({
      where: { key: CONFIG_KEY },
      create: { key: CONFIG_KEY, value: JSON.stringify(raw) },
      update: { value: JSON.stringify(raw) },
    });
  }
  return found;
}
