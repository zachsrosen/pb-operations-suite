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
}

/**
 * Post a chat message to a Vishtik project. On dry-run (the default) it logs
 * and returns the payload WITHOUT posting. Throws on auth failure or a non-OK
 * response so the caller surfaces it — never a silent success.
 */
export async function sendProjectComment(opts: {
  vishtikProjectId: string;
  message: string;
  dryRun?: boolean;
}): Promise<SendCommentResult> {
  const dryRun = opts.dryRun ?? isVishtikDryRun();
  const payload = buildCommentPayload(opts.vishtikProjectId, opts.message);

  if (dryRun) {
    console.warn(
      `[vishtik-write] DRY-RUN Add-comment → project ${opts.vishtikProjectId}: ${JSON.stringify(payload)}`,
    );
    return { ok: true, dryRun: true, payload, httpStatus: null };
  }

  const jar = new CookieJar();
  await login(jar);
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
  if (!r.ok) {
    throw new VishtikAuthError(`Add-comment failed (HTTP ${r.status})`);
  }
  return { ok: true, dryRun: false, payload, httpStatus: r.status };
}
