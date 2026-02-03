import { Resend } from "resend";

// Lazy initialization to avoid build-time errors when API key isn't set
let resendClient: Resend | null = null;

function getResendClient(): Resend | null {
  if (!process.env.RESEND_API_KEY) {
    return null;
  }
  if (!resendClient) {
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
}

interface SendVerificationEmailParams {
  to: string;
  code: string;
}

export async function sendVerificationEmail({
  to,
  code,
}: SendVerificationEmailParams): Promise<{ success: boolean; error?: string }> {
  const resend = getResendClient();

  // If no Resend API key, log the code for development
  if (!resend) {
    console.log(`
    ==========================================
    VERIFICATION CODE for ${to}: ${code}
    (Set RESEND_API_KEY to send real emails)
    ==========================================
    `);
    return { success: true };
  }

  try {
    const { error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || "PB Operations <noreply@photonbrothers.com>",
      to: [to],
      subject: "Your PB Operations Login Code",
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0a0a0f; color: #ffffff; padding: 40px 20px; margin: 0;">
            <div style="max-width: 400px; margin: 0 auto; background-color: #12121a; border: 1px solid #1e1e2e; border-radius: 12px; padding: 32px;">
              <h1 style="font-size: 24px; font-weight: bold; background: linear-gradient(to right, #f97316, #fb923c); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin: 0 0 8px 0; text-align: center;">
                PB Operations Suite
              </h1>
              <p style="color: #71717a; font-size: 14px; text-align: center; margin: 0 0 32px 0;">
                Your login verification code
              </p>

              <div style="background-color: #0a0a0f; border: 1px solid #1e1e2e; border-radius: 8px; padding: 24px; text-align: center; margin-bottom: 24px;">
                <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #ffffff; font-family: monospace;">
                  ${code}
                </span>
              </div>

              <p style="color: #71717a; font-size: 13px; text-align: center; margin: 0 0 8px 0;">
                This code expires in 10 minutes.
              </p>
              <p style="color: #52525b; font-size: 12px; text-align: center; margin: 0;">
                If you didn't request this code, you can safely ignore this email.
              </p>
            </div>

            <p style="color: #3f3f46; font-size: 11px; text-align: center; margin-top: 24px;">
              Photon Brothers Operations Suite
            </p>
          </body>
        </html>
      `,
      text: `Your PB Operations verification code is: ${code}\n\nThis code expires in 10 minutes.\n\nIf you didn't request this code, you can safely ignore this email.`,
    });

    if (error) {
      console.error("Failed to send email:", error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    console.error("Failed to send email:", err);
    return { success: false, error: "Failed to send email" };
  }
}
