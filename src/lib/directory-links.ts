/**
 * Directory identity link matcher — pure functions, no I/O.
 *
 * Computes which app Users can be linked to external identities (HubSpot
 * owners, Zuper users, CrewMembers) by email match. Never-overwrite
 * semantics: users with an existing link are counted but left untouched,
 * so manual corrections always survive re-syncs.
 */

export interface ExternalIdentity {
  id: string;
  email: string | null;
  label: string;
}

export interface LinkableUser {
  id: string;
  email: string;
  existingLink: string | null;
  name: string | null;
}

export interface LinkPlan {
  fills: Array<{ userId: string; externalId: string; label: string }>;
  alreadyLinked: number;
  unmatched: Array<{
    email: string;
    reason: "no-external-match" | "duplicate-external-email";
  }>;
}

/** Trim + lowercase an email; null for null/empty/whitespace-only input. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const normalized = raw.trim().toLowerCase();
  return normalized === "" ? null : normalized;
}

/**
 * Plan link fills for users against external identities, matching on
 * normalized email. Externals without an email are ignored. Two externals
 * sharing an email make that email unmatchable (reported, never guessed).
 */
export function planLinkFills(
  users: LinkableUser[],
  externals: ExternalIdentity[],
): LinkPlan {
  const byEmail = new Map<string, ExternalIdentity[]>();
  for (const ext of externals) {
    const email = normalizeEmail(ext.email);
    if (!email) continue;
    const existing = byEmail.get(email);
    if (existing) existing.push(ext);
    else byEmail.set(email, [ext]);
  }

  const plan: LinkPlan = { fills: [], alreadyLinked: 0, unmatched: [] };

  for (const user of users) {
    if (user.existingLink != null) {
      plan.alreadyLinked++;
      continue;
    }
    const email = normalizeEmail(user.email);
    const matches = email ? (byEmail.get(email) ?? []) : [];
    if (matches.length === 1) {
      plan.fills.push({
        userId: user.id,
        externalId: matches[0].id,
        label: matches[0].label,
      });
    } else {
      plan.unmatched.push({
        email: email ?? user.email,
        reason:
          matches.length > 1 ? "duplicate-external-email" : "no-external-match",
      });
    }
  }

  return plan;
}

export interface CrewCandidate {
  crewMemberId: string;
  crewName: string;
  userId: string;
  userName: string;
}

/** Trim, lowercase, and collapse internal whitespace for name comparison. */
function normalizeName(raw: string | null): string | null {
  if (raw == null) return null;
  const normalized = raw.trim().toLowerCase().replace(/\s+/g, " ");
  return normalized === "" ? null : normalized;
}

/**
 * Suggest CrewMember → User links by exact (case/whitespace-insensitive)
 * full-name match. Only crew with no email and no existing user link are
 * considered. Ambiguous matches (2+ users with the same name) produce
 * nothing — those are manual-only. Candidates are suggestions for admin
 * review; callers must never write them automatically.
 */
export function nameMatchCandidates(
  crew: Array<{
    id: string;
    name: string;
    email: string | null;
    userId: string | null;
  }>,
  users: Array<{ id: string; name: string | null; email: string }>,
): CrewCandidate[] {
  const usersByName = new Map<string, Array<{ id: string; name: string }>>();
  for (const user of users) {
    const name = normalizeName(user.name);
    if (!name) continue;
    const existing = usersByName.get(name);
    const entry = { id: user.id, name: user.name as string };
    if (existing) existing.push(entry);
    else usersByName.set(name, [entry]);
  }

  const candidates: CrewCandidate[] = [];
  for (const member of crew) {
    if (normalizeEmail(member.email) != null) continue;
    if (member.userId != null) continue;
    const name = normalizeName(member.name);
    if (!name) continue;
    const matches = usersByName.get(name) ?? [];
    if (matches.length !== 1) continue; // 0 = no match, 2+ = ambiguous
    candidates.push({
      crewMemberId: member.id,
      crewName: member.name,
      userId: matches[0].id,
      userName: matches[0].name,
    });
  }

  return candidates;
}
