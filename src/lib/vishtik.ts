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
 *  2. If the server's cursor is stuck (it ignores `cntr` and keeps returning one
 *     fixed page — detected when page 2 does not report `current_page === 2`),
 *     fall back to a best-effort showtotal tiling: requesting page 2 of size S
 *     returns the window [S+1, 2S], and a halving sequence of S values is unioned
 *     to cover the list. A separate cntr:1 call at the largest S grabs the head
 *     [1, S] in case the stuck page happens to be page 1 (which the cntr:2 tiles
 *     would miss). This is a best-effort union validated empirically at rollout,
 *     not a guaranteed-complete enumeration; the `complete` gate below is the
 *     safety net.
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

  // Detect whether cntr paginates: fetch page 2 and check the server honored the
  // page number (current_page === 2). A stuck cursor ignores cntr and returns a
  // fixed page, so current_page won't reflect the requested page.
  let cursorWorks = true;
  if (first.total_page > 1) {
    const second = await t.getProjectPage({ cntr: 2, showtotal: 100 });
    cursorWorks = second.current_page === 2;
    ingest(second.data); // keep page 2's rows regardless of detection outcome
    if (cursorWorks) {
      for (let p = 3; p <= first.total_page; p++) {
        ingest((await t.getProjectPage({ cntr: p, showtotal: 100 })).data);
      }
    }
  }

  if (!cursorWorks) {
    // Best-effort tiling fallback: the server is stuck returning one fixed page.
    // For each size S, page 2 of size S yields the window [S+1, 2S]; a halving
    // sequence of S values is unioned (de-duped by id via `ingest`) to cover the
    // list. One cntr:1 call at the largest S covers the head [1, S] — needed in
    // case the stuck page happens to BE page 1, which the cntr:2 tiles miss.
    const sizes = [1140, 570, 285, 143, 72, 36, 18, 9, 5, 3, 2, 1];
    ingest((await t.getProjectPage({ cntr: 1, showtotal: sizes[0] })).data);
    for (const S of sizes) {
      ingest((await t.getProjectPage({ cntr: 2, showtotal: S })).data);
    }
  }

  const projects = [...byId.values()];
  const complete = totalRow === 0 ? projects.length === 0
    : projects.length >= Math.floor(totalRow * COMPLETENESS_TOLERANCE);
  return { projects, complete };
}

const TIMEZONE = "America/Denver";

/** Live transport. Logs in with env creds; re-logins once on a mid-run 401. */
export function fetchTransport(): VishtikTransport {
  const jar = new CookieJar();
  let loggedIn = false;

  async function doLogin(): Promise<void> {
    const user = process.env.VISHTIK_USERNAME;
    const pass = process.env.VISHTIK_PASSWORD;
    if (!user || !pass) throw new VishtikAuthError("VISHTIK_USERNAME/PASSWORD not set");
    // Warm cookies (CI sets ci_session + csrf cookie on GET /login).
    const g = await fetch(`${VISHTIK_BASE}/login`, { redirect: "manual" });
    jar.absorb(g.headers.getSetCookie());
    const body = new URLSearchParams({
      back_url: "",
      timezone: TIMEZONE,
      username: user,
      password: pass,
    });
    const csrf = jar.csrfToken();
    if (csrf) body.set("ci_csrf_token", csrf); // exact field name confirmed in dry-run
    const r = await fetch(`${VISHTIK_BASE}/login-auth`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: jar.header(),
      },
      body,
    });
    jar.absorb(r.headers.getSetCookie());
    const location = r.headers.get("location") || "";
    if (location.includes("/login")) throw new VishtikAuthError("Vishtik login rejected");
    loggedIn = true;
  }

  return {
    async login() {
      if (!loggedIn) await doLogin();
    },
    async getProjectPage({ cntr, showtotal }) {
      const params = new URLSearchParams({
        cntr: String(cntr),
        recorddata: String(showtotal),
        showtotal: String(showtotal),
        search: "", status: "", servicetype: "",
        startdate: "", enddate: "", bylastdate: "", pe_stamp: "",
        allproject: "1", assigned_user: "", assigned_me: "0", created_user: "",
      });
      const csrf = jar.csrfToken();
      if (csrf) params.set("ci_csrf_token", csrf);
      const call = () =>
        fetch(`${VISHTIK_BASE}/Project/Project/Get-Project`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "X-Requested-With": "XMLHttpRequest",
            Cookie: jar.header(),
          },
          body: params,
        });
      let r = await call();
      if (r.status === 401 || r.status === 302) {
        loggedIn = false;
        await doLogin();
        r = await call();
      }
      if (!r.ok) throw new VishtikAuthError(`Get-Project ${r.status}`);
      const json = (await r.json()) as ProjectPage;
      jar.absorb(r.headers.getSetCookie());
      return json;
    },
  };
}
