/**
 * Parse a project number and customer name out of an IDR deal name.
 *
 * Handles both the Project-pipeline format and the Service/D&R format, which
 * carries a leading pipeline tag:
 *   "PROJ-1234 | Smith, John | 123 Main St"          → Project
 *   "SVC | PROJ-3956 | Farrell, William | 5008 …"    → Service / D&R
 *
 * Strategy: find the segment that actually contains the PROJ number (it isn't
 * always first), then take the *next* segment as the customer name. A
 * "Last, First" name is flipped to "First Last".
 */
export function parseDealLabel(dealName: string): { projNum: string | null; fullName: string } {
  const parts = dealName.split("|").map((s) => s.trim());

  // Locate the PROJ-XXXX segment anywhere in the label (not just the first).
  let projNum: string | null = null;
  let projIdx = -1;
  for (let i = 0; i < parts.length; i++) {
    const m = parts[i]?.match(/PROJ-\d+/);
    if (m) {
      projNum = m[0];
      projIdx = i;
      break;
    }
  }

  // Customer name is the segment right after the PROJ segment; when there's no
  // PROJ segment, fall back to the second-then-first segment (legacy behavior).
  const namePart =
    (projIdx >= 0 ? parts[projIdx + 1] : undefined) ?? parts[1] ?? parts[0] ?? dealName;

  // Flip "Last, First" → "First Last".
  const comma = namePart.indexOf(",");
  if (comma > 0) {
    const last = namePart.slice(0, comma).trim();
    const first = namePart.slice(comma + 1).trim();
    return { projNum, fullName: first ? `${first} ${last}` : last };
  }
  return { projNum, fullName: namePart.trim() };
}
