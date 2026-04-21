export interface RecaptchaVerifyResult {
  success: boolean;
  score: number | null;
  action: string | null;
  reason?: string;
}

export async function verifyRecaptcha(token: string, expectedAction?: string): Promise<RecaptchaVerifyResult> {
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret) {
    // Fail-open in environments without a key configured (dev, tests).
    console.warn("[estimator] RECAPTCHA_SECRET_KEY not configured — allowing request with null score");
    return { success: true, score: null, action: null, reason: "no_secret" };
  }
  if (!token) {
    return { success: false, score: null, action: null, reason: "missing_token" };
  }

  try {
    const body = new URLSearchParams({ secret, response: token });
    const resp = await fetch("https://www.google.com/recaptcha/api/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!resp.ok) {
      return { success: false, score: null, action: null, reason: `http_${resp.status}` };
    }
    const data = (await resp.json()) as {
      success?: boolean;
      score?: number;
      action?: string;
      "error-codes"?: string[];
    };
    const score = typeof data.score === "number" ? data.score : null;
    const action = typeof data.action === "string" ? data.action : null;
    if (!data.success) {
      return { success: false, score, action, reason: (data["error-codes"] ?? []).join(",") };
    }
    if (expectedAction && action && action !== expectedAction) {
      return { success: false, score, action, reason: "action_mismatch" };
    }
    return { success: true, score, action };
  } catch (err) {
    return {
      success: false,
      score: null,
      action: null,
      reason: `exception:${err instanceof Error ? err.message : "unknown"}`,
    };
  }
}
