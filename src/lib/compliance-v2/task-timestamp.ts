/**
 * Resolve the "earliest of" task timestamp per spec §2.3.
 *
 * Returns null when no signal is populated.
 */
export interface TaskTimestampInputs {
  actualEndTime: string | null;
  formCreatedAt: string | null;
  parentCompletedTime: string | null;
}

export function resolveTaskTimestamp(inputs: TaskTimestampInputs): Date | null {
  const candidates: Date[] = [];
  for (const raw of [inputs.actualEndTime, inputs.formCreatedAt, inputs.parentCompletedTime]) {
    if (!raw) continue;
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) candidates.push(d);
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.getTime() - b.getTime());
  return candidates[0];
}
