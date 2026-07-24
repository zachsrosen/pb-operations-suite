/**
 * Vishtik WRITE actions — reverse-engineered from the portal (spike 2026-07-23),
 * NOT an official API. Kept in its own module with its own login so a break in
 * this fragile path can never take down the read-only sync (lib/vishtik.ts).
 *
 * Endpoints + payloads confirmed live:
 *   • send chat message: POST /Project/Project/Add-comment
 *       { message, id: <vishtikProjectId>, ir_replay_to_msg_id: "",
 *         replay_msg_string: "", ci_csrf_token }
 *
 * Everything here is gated by VISHTIK_WRITE_ENABLED and defaults to DRY-RUN
 * (VISHTIK_WRITE_DRY_RUN !== "false") so a misconfiguration cannot post to real
 * customer projects.
 */

import {
  CookieJar,
  VISHTIK_BASE,
  VishtikAuthError,
  resolveVishtikCreds,
} from "@/lib/vishtik";

const TIMEZONE = "America/Denver";

/** Whether the write capability is switched on at all. Server-only flag. */
export function isVishtikWriteEnabled(): boolean {
  return process.env.VISHTIK_WRITE_ENABLED === "true";
}

/**
 * Dry-run is ON unless explicitly disabled. Turning writes on
 * (VISHTIK_WRITE_ENABLED=true) is not enough to post for real — you must ALSO
 * set VISHTIK_WRITE_DRY_RUN=false. Two deliberate switches guard live posts.
 */
export function isVishtikDryRun(): boolean {
  return process.env.VISHTIK_WRITE_DRY_RUN !== "false";
}

/** Log in on a fresh jar (duplicated from lib/vishtik.ts on purpose — the
 *  write path stays isolated from the sync's session). */
async function login(jar: CookieJar): Promise<void> {
  const { user, pass } = await resolveVishtikCreds();
  const g = await fetch(`${VISHTIK_BASE}/login`, { redirect: "manual" });
  jar.absorb(g.headers.getSetCookie());
  const body = new URLSearchParams({
    back_url: "",
    timezone: TIMEZONE,
    username: user,
    password: pass,
  });
  const csrf = jar.csrfToken();
  if (csrf) body.set("ci_csrf_token", csrf);
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
  if ((r.headers.get("location") || "").includes("/login")) {
    throw new VishtikAuthError("Vishtik login rejected");
  }
}

/** The exact form body posted to Add-comment. Pure — unit-tested. */
export function buildCommentPayload(
  vishtikProjectId: string,
  message: string,
): Record<string, string> {
  return {
    message,
    id: vishtikProjectId,
    ir_replay_to_msg_id: "",
    replay_msg_string: "",
  };
}

export interface SendCommentResult {
  ok: boolean;
  dryRun: boolean;
  /** The payload that was (or would be) posted — echoed for verification. */
  payload: Record<string, string>;
  /** Vishtik HTTP status on a real send; null on dry-run. */
  httpStatus: number | null;
  /** True when the status was flipped to Request Revision after the message. */
  revisionRequested: boolean;
  /** Non-fatal problems (e.g. status flip failed) — the message still posted. */
  warnings: string[];
}

/** Vishtik status code for "Request Revision" (legend reconned 2026-07-23). */
export const STATUS_REQUEST_REVISION = "3";

/**
 * Extract the project's currently-assigned Vishtik user id — the selected
 * option of the `.projectuserdata` control on the detail page. The status
 * change carries this as `userid`, so we read it and pass it back UNCHANGED to
 * avoid reassigning the project. Returns null when it can't be parsed, in
 * which case the caller skips the status change rather than guessing.
 */
async function fetchAssignedUserId(
  jar: CookieJar,
  vishtikProjectId: string,
): Promise<string | null> {
  const r = await fetch(
    `${VISHTIK_BASE}/Project/Project/Project-Details?id=${encodeURIComponent(vishtikProjectId)}`,
    { headers: { Cookie: jar.header() } },
  );
  if (!r.ok) return null;
  const html = await r.text();
  const sel = html.match(
    /<select[^>]*class=["'][^"']*projectuserdata[^"']*["'][^>]*>([\s\S]*?)<\/select>/i,
  );
  if (!sel) return null;
  const opt = sel[1].match(/<option[^>]*\bselected\b[^>]*value=["']?(\d+)["']?/i)
    ?? sel[1].match(/<option[^>]*value=["']?(\d+)["']?[^>]*\bselected\b/i);
  return opt ? opt[1] : null;
}

/** POST a status change. reason is "" — the portal sends it empty. */
async function postStatusChange(
  jar: CookieJar,
  args: { id: string; status: string; userid: string },
): Promise<void> {
  const form = new URLSearchParams({
    id: args.id,
    status: args.status,
    reason: "",
    userid: args.userid,
  });
  const csrf = jar.csrfToken();
  if (csrf) form.set("ci_csrf_token", csrf);
  const r = await fetch(`${VISHTIK_BASE}/Project/Project/Project-Chage-Status`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
      Cookie: jar.header(),
    },
    body: form,
  });
  if (!r.ok) throw new VishtikAuthError(`Project-Chage-Status failed (HTTP ${r.status})`);
}

/**
 * Post a chat message to a Vishtik project, and — per Zach's workflow — flip
 * the status to Request Revision (posting a message IS a revision request).
 * The status flip preserves the current assignee and is BEST-EFFORT: if it
 * fails, the message still posted, so it returns as a warning, never an error.
 *
 * On dry-run (the default) nothing posts; the payload is logged and returned.
 * Throws only if the message POST itself fails — never a silent success.
 */
export async function sendProjectComment(opts: {
  vishtikProjectId: string;
  message: string;
  /** Flip status → Request Revision after the message. Default true. */
  requestRevision?: boolean;
  dryRun?: boolean;
}): Promise<SendCommentResult> {
  const dryRun = opts.dryRun ?? isVishtikDryRun();
  const requestRevision = opts.requestRevision ?? true;
  const payload = buildCommentPayload(opts.vishtikProjectId, opts.message);

  if (dryRun) {
    console.warn(
      `[vishtik-write] DRY-RUN Add-comment → project ${opts.vishtikProjectId}` +
        `${requestRevision ? " + status→Request Revision" : ""}: ${JSON.stringify(payload)}`,
    );
    return { ok: true, dryRun: true, payload, httpStatus: null, revisionRequested: false, warnings: [] };
  }

  const jar = new CookieJar();
  await login(jar);

  // THE message. If this fails the whole call fails.
  const form = new URLSearchParams(payload);
  const csrf = jar.csrfToken();
  if (csrf) form.set("ci_csrf_token", csrf);
  const r = await fetch(`${VISHTIK_BASE}/Project/Project/Add-comment`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
      Cookie: jar.header(),
    },
    body: form,
  });
  if (!r.ok) throw new VishtikAuthError(`Add-comment failed (HTTP ${r.status})`);

  // Best-effort status flip. Never fails the send that already landed.
  const warnings: string[] = [];
  let revisionRequested = false;
  if (requestRevision) {
    try {
      const userid = await fetchAssignedUserId(jar, opts.vishtikProjectId);
      if (!userid) {
        warnings.push("skipped status change: couldn't resolve the current assignee (message posted)");
      } else {
        await postStatusChange(jar, { id: opts.vishtikProjectId, status: STATUS_REQUEST_REVISION, userid });
        revisionRequested = true;
      }
    } catch (err) {
      warnings.push(`status change failed (message posted): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { ok: true, dryRun: false, payload, httpStatus: r.status, revisionRequested, warnings };
}
