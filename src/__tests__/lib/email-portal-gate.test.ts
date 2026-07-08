/**
 * Customer-facing portal emails are disabled unless PORTAL_CUSTOMER_EMAILS_ENABLED
 * is explicitly set. Olivia (the PM bot) owns all customer messaging — the app
 * must not email customers on invite/book/reschedule/cancel.
 */

import { sendPortalEmail } from "@/lib/email";

const ENV_KEYS = [
  "PORTAL_CUSTOMER_EMAILS_ENABLED",
  "GOOGLE_WORKSPACE_EMAIL_ENABLED",
  "RESEND_API_KEY",
  "PORTAL_SENDER_EMAIL",
  "SCHEDULING_NOTIFICATION_BCC",
] as const;

describe("sendPortalEmail customer-email kill switch", () => {
  const savedEnv: Record<string, string | undefined> = {};
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    fetchSpy = jest.spyOn(global, "fetch").mockRejectedValue(new Error("no network in tests"));
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    fetchSpy.mockRestore();
  });

  const params = {
    to: "customer@example.com",
    subject: "Your Site Survey is Confirmed - Photon Brothers",
    html: "<p>Hi</p>",
  };

  it("skips sending when PORTAL_CUSTOMER_EMAILS_ENABLED is unset", async () => {
    const result = await sendPortalEmail(params);
    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("skips sending when PORTAL_CUSTOMER_EMAILS_ENABLED is false", async () => {
    process.env.PORTAL_CUSTOMER_EMAILS_ENABLED = "false";
    const result = await sendPortalEmail(params);
    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("attempts to send when PORTAL_CUSTOMER_EMAILS_ENABLED is true", async () => {
    process.env.PORTAL_CUSTOMER_EMAILS_ENABLED = "true";
    process.env.GOOGLE_WORKSPACE_EMAIL_ENABLED = "true";
    const result = await sendPortalEmail(params);
    // Workspace creds are missing/mocked, so the send fails — but it must NOT
    // be reported as skipped: the gate let it through to the provider path.
    expect(result.skipped).toBeUndefined();
  });
});
