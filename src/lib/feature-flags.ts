// Feature flags for gradual rollout. Keep reads narrow — just env lookups, no
// caching layer. Server-side flags control API handlers; client-side (NEXT_PUBLIC_*)
// control UI visibility.

export function isOnCallRotationsEnabled(): boolean {
  return process.env.ON_CALL_ROTATIONS_ENABLED === "true";
}

export function isOnCallRotationsEnabledClient(): boolean {
  return process.env.NEXT_PUBLIC_ON_CALL_ROTATIONS_ENABLED === "true";
}
