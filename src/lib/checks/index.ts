/**
 * Check Engine Registry
 *
 * Maps skill names to arrays of check functions.
 */

import type { CheckFn, SkillName } from "./types";

const registry = new Map<SkillName, CheckFn[]>();

export function registerChecks(skill: SkillName, checks: CheckFn[]): void {
  registry.set(skill, checks);
}

export function getChecks(skill: SkillName): CheckFn[] {
  return registry.get(skill) ?? [];
}

export function getRegisteredSkills(): SkillName[] {
  return Array.from(registry.keys());
}
