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
 * Default = Zach's precon team + Natasha (Ops Mgr/PM). Caleb & Patrick are IT,
 * intentionally excluded.
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

export const DEFAULT_ROSTER: RosterMember[] = [
  { email: "zach.rosen@photonbrothers.com", name: "Zach Rosen" },
  { email: "alexis.severson@photonbrothers.com", name: "Alexis Severson", aliases: ["alexis@photonbrothers.com"] },
  { email: "peter.zaun@photonbrothers.com", name: "Peter Zaun" },
  { email: "kaitlyn.arnoldi@photonbrothers.com", name: "Kaitlyn Arnoldi", aliases: ["kaitlyn@photonbrothers.com"] },
  { email: "jacob.campbell@photonbrothers.com", name: "Jacob Campbell" },
  { email: "layla.alqurashi@photonbrothers.com", name: "Layla Alqurashi", aliases: ["layla@photonbrothers.com"] },
  { email: "kat.pospischil@photonbrothers.com", name: "Kat Pospischil", aliases: ["kat@photonbrothers.com"] },
  { email: "kristofer.stuhff@photonbrothers.com", name: "Kristofer Stuhff" },
  { email: "elliott.gunning@photonbrothers.com", name: "Elliott Gunning" },
  { email: "natasha.sanford@photonbrothers.com", name: "Natasha Sanford", hubspotUserId: "77265642", aircallId: "1522029" },
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
