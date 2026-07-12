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
  /** One Get-Project call. `offset` = 0-based row offset, `limit` = page size. */
  getProjectPage(args: { offset: number; limit: number }): Promise<ProjectPage>;
}

const COMPLETENESS_TOLERANCE = 0.95; // fetched must reach ≥95% of total_row
// 100 is the largest page size verified against the live server (2026-07-10);
// don't raise without re-testing — an over-cap `showtotal` could silently clamp
// while the offset keeps striding, skipping alternate windows.
const PAGE_SIZE = 100;

function toProjects(rows: ProjectPage["data"]): VishtikProject[] {
  return rows.map((r) => ({
    vishtikId: String(r.id),
    projNumber: parseProjNumber(r.customer_name),
    customerName: r.customer_name,
    status: String(r.status),
  }));
}

/**
 * Fetch the entire Vishtik project list via offset pagination.
 *
 * Confirmed live semantics (2026-07-10, tested logged-in in the browser):
 * `recorddata` is the 0-based ROW OFFSET and `showtotal` is the PAGE SIZE;
 * `cntr` is ignored by the server. (The previous implementation sent
 * recorddata=showtotal, which pinned every request to one offset and forced a
 * halving-tile fallback that hard-capped coverage at ~2,280 rows — silently
 * dropping the oldest projects as the list grew past that.)
 *
 * Guard: if a page returns no rows the list didn't know about, the server's
 * offset semantics have drifted again — stop fetching and let the `complete`
 * gate below report a partial scrape so the caller suppresses writes rather
 * than under-matching.
 */
export async function fetchAllProjects(
  t: VishtikTransport,
): Promise<{ projects: VishtikProject[]; complete: boolean }> {
  await t.login();
  const byId = new Map<string, VishtikProject>();
  const ingest = (rows: ProjectPage["data"]) =>
    toProjects(rows).forEach((p) => byId.set(p.vishtikId, p));

  const first = await t.getProjectPage({ offset: 0, limit: PAGE_SIZE });
  ingest(first.data);
  const totalRow = first.total_row;

  for (let offset = PAGE_SIZE; offset < totalRow; offset += PAGE_SIZE) {
    const page = await t.getProjectPage({ offset, limit: PAGE_SIZE });
    if (page.data.length === 0) break; // ran past the end (total_row shrank mid-scan)
    const sizeBefore = byId.size;
    ingest(page.data);
    if (byId.size === sizeBefore) break; // offset ignored/stuck — bail to the completeness gate
  }

  const projects = [...byId.values()];
  const complete = totalRow === 0 ? projects.length === 0
    : projects.length >= Math.floor(totalRow * COMPLETENESS_TOLERANCE);
  return { projects, complete };
}

const TIMEZONE = "America/Denver";

/**
 * Get-Project form params. Exported for the regression test: `recorddata` must
 * carry the row OFFSET and `showtotal` the page size — the original sync bug
 * was sending recorddata=showtotal, which pinned every request to one window.
 */
export function getProjectParams(offset: number, limit: number): Record<string, string> {
  return {
    cntr: "1", // ignored by the server; kept for form-shape compatibility
    recorddata: String(offset),
    showtotal: String(limit),
    search: "", status: "", servicetype: "",
    startdate: "", enddate: "", bylastdate: "", pe_stamp: "",
    allproject: "1", assigned_user: "", assigned_me: "0", created_user: "",
  };
}

/**
 * Resolve Vishtik credentials. Prefers env vars (local dev / dry-run); falls
 * back to `SystemConfig` rows `vishtik_username` / `vishtik_password` for prod,
 * where the Vercel env store is full (same DB-row pattern as the Enphase /
 * EagleView tokens). Prisma is imported dynamically so the parse helpers and
 * their tests don't pull in the DB client at module load.
 */
async function resolveVishtikCreds(): Promise<{ user: string; pass: string }> {
  let user = process.env.VISHTIK_USERNAME;
  let pass = process.env.VISHTIK_PASSWORD;
  if (!user || !pass) {
    try {
      const { prisma } = await import("@/lib/db");
      if (prisma) {
        const rows = await prisma.systemConfig.findMany({
          where: { key: { in: ["vishtik_username", "vishtik_password"] } },
        });
        for (const row of rows) {
          if (row.key === "vishtik_username") user = user || row.value;
          if (row.key === "vishtik_password") pass = pass || row.value;
        }
      }
    } catch {
      // DB unavailable — fall through to the not-set error below.
    }
  }
  if (!user || !pass) {
    throw new VishtikAuthError(
      "Vishtik creds not set (env VISHTIK_USERNAME/PASSWORD or SystemConfig vishtik_username/vishtik_password)",
    );
  }
  return { user, pass };
}

/** Live transport. Logs in with resolved creds; re-logins once on a mid-run 401. */
export function fetchTransport(): VishtikTransport {
  const jar = new CookieJar();
  let loggedIn = false;

  async function doLogin(): Promise<void> {
    const { user, pass } = await resolveVishtikCreds();
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
    async getProjectPage({ offset, limit }) {
      const params = new URLSearchParams(getProjectParams(offset, limit));
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
