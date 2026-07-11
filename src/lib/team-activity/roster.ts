/**
 * Team-activity roster — who to include in the report.
 *
 * `email` is the canonical Google/login identity (also how PB Ops ActivityLog
 * and Aircall key their rows). `aliases` covers people whose HubSpot/Aircall
 * rows use a short address (e.g. kat@ vs kat.pospischil@). `hubspotUserId` and
 * `aircallId` are optional fast-paths; adapters that can resolve by directory
 * lookup will do so when these are absent. Edit this list freely — it is the
 * single source of truth for who the report covers.
 *
 * Default = Zach's precon team + the PM group (Natasha, Wes; the other PMs
 * are already precon members). Caleb & Patrick are IT, intentionally excluded.
 */

export interface RosterMember {
  email: string;
  name: string;
  aliases?: string[];
  hubspotUserId?: string;
  aircallId?: string;
  /** Zuper user_name as it appears in ZuperJobCache.assignedUsers (low-signal source). */
  zuperName?: string;
}

// Identities verified against the User table + Aircall on 2026-07-02. Canonical
// email is the person's real login/Google address; do not invent first.last
// variants. HubSpot resolves via directory lookup on these + aliases.
export const DEFAULT_ROSTER: RosterMember[] = [
  { email: "zach@photonbrothers.com", name: "Zach Rosen", aliases: ["zach.rosen@photonbrothers.com"] },
  { email: "alexis@photonbrothers.com", name: "Alexis Severson", aircallId: "965988" },
  { email: "peter.zaun@photonbrothers.com", name: "Peter Zaun" },
  { email: "kaitlyn@photonbrothers.com", name: "Kaitlyn Martinez", aircallId: "966000" },
  { email: "jacob.campbell@photonbrothers.com", name: "Jacob Campbell" },
  { email: "layla@photonbrothers.com", name: "Layla Counts", aircallId: "1217192" },
  { email: "kat@photonbrothers.com", name: "Katlyyn Arnoldi", aircallId: "1079651" },
  { email: "kristofer.stuhff@photonbrothers.com", name: "Kristofer Stuhff" },
  { email: "elliott.gunning@photonbrothers.com", name: "Elliott Gunning" },
  { email: "natasha.sanford@photonbrothers.com", name: "Natasha Wooten Sanford", hubspotUserId: "77265642", aircallId: "1522029" },
  { email: "wes.benscoter@photonbrothers.com", name: "Wes Benscoter" },
];

/** All lowercase addresses a roster member is known by (canonical + aliases). */
export function memberEmails(m: RosterMember): string[] {
  return [m.email, ...(m.aliases ?? [])].map((e) => e.toLowerCase());
}

/** Map every known address (canonical + alias) -> canonical email. */
export function buildEmailIndex(roster: RosterMember[]): Map<string, string> {
  const idx = new Map<string, string>();
  for (const m of roster) for (const e of memberEmails(m)) idx.set(e, m.email.toLowerCase());
  return idx;
}
