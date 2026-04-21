import type { UserRole } from "@/generated/prisma/enums";
import {
  BADGE_COLOR_OPTIONS,
  SCOPE_VALUES,
  LABEL_MAX_LEN,
  DESCRIPTION_MAX_LEN,
  BADGE_ABBREV_MAX_LEN,
  LANDING_CARDS_MAX,
  type GuardViolation,
  type RoleDefinitionOverridePayload,
} from "@/lib/role-override-types";

/**
 * Pre-write invariant checks for role definition overrides.
 *
 * Returns a list of violations — empty list means payload is OK. The API
 * route returns 400 with the list on non-empty. The editor mirrors these
 * checks client-side for live feedback but the server is canonical.
 *
 * Spec: docs/superpowers/specs/2026-04-20-role-access-editor-design.md
 *       (Section: "Guards — src/lib/role-guards.ts")
 *
 * Limitations (documented non-goals):
 *  - ADMIN lockout guard runs ONLY on ADMIN role edits. Cross-role
 *    scenarios (e.g. editing SERVICE to break a multi-role admin) and
 *    "last admin user" detection are out of scope.
 *  - Payload shape (required fields, JSON type correctness) is validated
 *    by the API route parser, not here. This function assumes the payload
 *    matches the TS type.
 */
export function validateRoleEdit(
  role: UserRole,
  payload: RoleDefinitionOverridePayload,
): GuardViolation[] {
  const violations: GuardViolation[] = [];

  // ----- allowedRoutes shape + ADMIN lockout -----
  if (payload.allowedRoutes) {
    for (const route of payload.allowedRoutes) {
      if (typeof route !== "string" || (!route.startsWith("/") && route !== "*")) {
        violations.push({
          field: "allowedRoutes",
          message: `Route "${route}" must start with "/" or equal "*".`,
        });
      }
    }
    if (role === "ADMIN") {
      const hasWildcard = payload.allowedRoutes.includes("*");
      const hasAdminRoute = payload.allowedRoutes.some(
        (r) => r === "/admin" || r.startsWith("/admin/"),
      );
      const hasApiAdmin = payload.allowedRoutes.some(
        (r) => r === "/api/admin" || r.startsWith("/api/admin/"),
      );
      if (!hasWildcard && !(hasAdminRoute && hasApiAdmin)) {
        violations.push({
          field: "allowedRoutes",
          message:
            "ADMIN must retain '*' OR both '/admin' and '/api/admin' in allowedRoutes to prevent lockout.",
        });
      }
    }
  }

  // ----- suites shape -----
  if (payload.suites) {
    for (const s of payload.suites) {
      if (typeof s !== "string" || !s.startsWith("/suites/")) {
        violations.push({
          field: "suites",
          message: `Suite "${s}" must start with "/suites/".`,
        });
      }
    }
  }

  // ----- landingCards shape + size -----
  if (payload.landingCards) {
    if (payload.landingCards.length > LANDING_CARDS_MAX) {
      violations.push({
        field: "landingCards",
        message: `Landing cards capped at ${LANDING_CARDS_MAX}; got ${payload.landingCards.length}.`,
      });
    }
    for (const c of payload.landingCards) {
      if (typeof c?.href !== "string" || !c.href.startsWith("/")) {
        violations.push({
          field: "landingCards",
          message: `Landing card href "${c?.href}" must start with "/".`,
        });
      }
    }
  }

  // ----- badge -----
  if (payload.badge) {
    if (payload.badge.color !== undefined) {
      if (!BADGE_COLOR_OPTIONS.includes(payload.badge.color as (typeof BADGE_COLOR_OPTIONS)[number])) {
        violations.push({
          field: "badge",
          message: `Badge color "${payload.badge.color}" is not in the allowed palette (${BADGE_COLOR_OPTIONS.join(", ")}).`,
        });
      }
    }
    if (payload.badge.abbrev !== undefined) {
      if (typeof payload.badge.abbrev !== "string" || payload.badge.abbrev.length > BADGE_ABBREV_MAX_LEN) {
        violations.push({
          field: "badge",
          message: `Badge abbrev must be a string of at most ${BADGE_ABBREV_MAX_LEN} characters.`,
        });
      }
    }
  }

  // ----- scope -----
  if (payload.scope !== undefined) {
    if (!SCOPE_VALUES.includes(payload.scope)) {
      violations.push({
        field: "scope",
        message: `Scope must be one of: ${SCOPE_VALUES.join(", ")}.`,
      });
    }
  }

  // ----- label / description -----
  if (payload.label !== undefined) {
    if (typeof payload.label !== "string" || payload.label.length > LABEL_MAX_LEN) {
      violations.push({
        field: "label",
        message: `Label must be a string of at most ${LABEL_MAX_LEN} characters.`,
      });
    }
  }
  if (payload.description !== undefined) {
    if (typeof payload.description !== "string" || payload.description.length > DESCRIPTION_MAX_LEN) {
      violations.push({
        field: "description",
        message: `Description must be a string of at most ${DESCRIPTION_MAX_LEN} characters.`,
      });
    }
  }

  return violations;
}
