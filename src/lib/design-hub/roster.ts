/**
 * Design-lead roster helpers. Deliberately separate from assignments.ts, which
 * imports Prisma: the assign dialog is a CLIENT component and needs the roster,
 * and pulling a module with a `@/lib/db` import into the client bundle produces
 * the "node:module" dev 500 (see reference: client→Prisma import leak).
 *
 * daily-focus/config.ts has no imports at all, so it is safe to reach through.
 */

import { DESIGN_LEADS } from "@/lib/daily-focus/config";

export interface DesignLeadOption {
  email: string;
  name: string;
  firstName: string;
}

export const DESIGN_LEAD_OPTIONS: DesignLeadOption[] = DESIGN_LEADS.map((l) => ({
  email: l.email,
  name: l.name,
  firstName: l.firstName,
}));

const byEmail = new Map(
  DESIGN_LEAD_OPTIONS.map((l) => [l.email.toLowerCase(), l]),
);

export function designLeadName(email: string): string {
  return byEmail.get(email.toLowerCase())?.name ?? email;
}

export function designLeadFirstName(email: string): string {
  return byEmail.get(email.toLowerCase())?.firstName ?? email;
}

export function isDesignLead(email: string): boolean {
  return byEmail.has(email.toLowerCase());
}
