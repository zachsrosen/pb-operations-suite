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
    raw[key] = {
      uploader: args.uploader ?? "",
      setBy: args.setBy,
      reason: args.reason ?? "",
      at: new Date().toISOString(),
    };
  }
  await prisma.systemConfig.upsert({
    where: { key: CONFIG_KEY },
    create: { key: CONFIG_KEY, value: JSON.stringify(raw) },
    update: { value: JSON.stringify(raw) },
  });
}
