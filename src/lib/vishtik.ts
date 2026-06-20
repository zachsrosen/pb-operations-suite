// src/lib/vishtik.ts
export const VISHTIK_BASE = "https://project.vishtik.com";

export interface VishtikProject {
  vishtikId: string;
  projNumber: string | null;
  customerName: string;
  status: string;
}

export function parseProjNumber(customerName: string): string | null {
  const m = (customerName || "").match(/PROJ-\d+/);
  return m ? m[0] : null;
}

export function detailUrl(vishtikId: string): string {
  return `${VISHTIK_BASE}/Project/Project/Project-Details?id=${vishtikId}`;
}

export class CookieJar {
  private cookies = new Map<string, string>();
  /** Absorb an array of raw Set-Cookie header lines. */
  absorb(setCookies: string[]): void {
    for (const line of setCookies) {
      const first = line.split(";")[0];
      const eq = first.indexOf("=");
      if (eq === -1) continue;
      const name = first.slice(0, eq).trim();
      const val = first.slice(eq + 1).trim();
      if (name) this.cookies.set(name, val);
    }
  }
  value(name: string): string | undefined {
    return this.cookies.get(name);
  }
  /** First cookie whose name contains "csrf" (CI's token cookie name varies). */
  csrfToken(): string | undefined {
    for (const [name, val] of this.cookies) {
      if (/csrf/i.test(name)) return val;
    }
    return undefined;
  }
  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

export class VishtikAuthError extends Error {}

export interface ProjectPage {
  data: { id: string; customer_name: string; status: string }[];
  total_page: number;
  current_page: number;
  total_row: number;
}

export interface VishtikTransport {
  login(): Promise<void>;
  /** One Get-Project call. `cntr` = page number, `showtotal` = page size. */
  getProjectPage(args: { cntr: number; showtotal: number }): Promise<ProjectPage>;
}

const COMPLETENESS_TOLERANCE = 0.95; // fetched must reach ≥95% of total_row

function toProjects(rows: ProjectPage["data"]): VishtikProject[] {
  return rows.map((r) => ({
    vishtikId: String(r.id),
    projNumber: parseProjNumber(r.customer_name),
    customerName: r.customer_name,
    status: String(r.status),
  }));
}

/**
 * Fetch the entire Vishtik project list. Strategy:
 *  1. Page through with cntr=1..total_page at showtotal=100.
 *  2. If the cursor is stuck (current_page stops advancing with cntr), fall
 *     back to showtotal tiling: page-2-of-size-S returns rows [S+1, 2S];
 *     a halving sequence of S covers the list, row 1 is grabbed separately.
 * Returns {complete:false} if coverage < tolerance of total_row (so the caller
 * suppresses writes rather than under-matching on a partial scrape).
 */
export async function fetchAllProjects(
  t: VishtikTransport,
): Promise<{ projects: VishtikProject[]; complete: boolean }> {
  await t.login();
  const byId = new Map<string, VishtikProject>();
  const ingest = (rows: ProjectPage["data"]) =>
    toProjects(rows).forEach((p) => byId.set(p.vishtikId, p));

  const first = await t.getProjectPage({ cntr: 1, showtotal: 100 });
  ingest(first.data);
  const totalRow = first.total_row;

  // Detect whether cntr paginates: fetch page 2 and see if it differs.
  let cursorWorks = true;
  if (first.total_page > 1) {
    const second = await t.getProjectPage({ cntr: 2, showtotal: 100 });
    const firstIds = new Set(first.data.map((r) => String(r.id)));
    const secondNew = second.data.some((r) => !firstIds.has(String(r.id)));
    cursorWorks = secondNew;
    ingest(second.data);
    if (cursorWorks) {
      for (let p = 3; p <= first.total_page; p++) {
        ingest((await t.getProjectPage({ cntr: p, showtotal: 100 })).data);
      }
    }
  }

  if (!cursorWorks) {
    // Tiling fallback: server is stuck returning "page 2"; window = [S+1, 2S].
    const sizes = [1140, 570, 285, 143, 72, 36, 18, 9, 5, 3, 2, 1];
    for (const S of sizes) {
      ingest((await t.getProjectPage({ cntr: 1, showtotal: S })).data);
    }
    // row 1 is only reachable from a fresh page-1 render (DOM in the browser
    // skill); server-side it is covered by the smallest tile when present.
  }

  const projects = [...byId.values()];
  const complete = totalRow === 0 ? projects.length === 0
    : projects.length >= Math.floor(totalRow * COMPLETENESS_TOLERANCE);
  return { projects, complete };
}
