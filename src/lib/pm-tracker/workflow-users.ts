/**
 * HubSpot user IDs that represent workflows / integrations / service accounts.
 *
 * Used by the Phase 2 saves detector to attribute resolutions correctly:
 * if a deal stage change was made by a workflow user, the resolution does
 * NOT count as a PM-driven save.
 *
 * Bootstrap: seeded during Phase 2 development by querying recent stage-
 * change events for distinct `hs_updated_by_user_id` values, then manually
 * flagging which IDs are workflows vs. real PB employees.
 *
 * Empty until Phase 2 lands.
 */

export const WORKFLOW_USER_IDS: ReadonlyArray<string> = [];

export function isWorkflowUser(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return WORKFLOW_USER_IDS.includes(userId);
}
