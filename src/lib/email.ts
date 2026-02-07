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

// Appointment type display names
const APPOINTMENT_TYPE_LABELS: Record<string, string> = {
  survey: "Site Survey",
  installation: "Installation",
  inspection: "Inspection",
};

// Format time for display (e.g., "08:00" -> "8:00 AM")
function formatTime(time: string): string {
  if (!time) return "";
  const [hours, minutes] = time.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${String(minutes).padStart(2, "0")} ${period}`;
}

// Format date for display (e.g., "2024-02-15" -> "Friday, February 15, 2024")
function formatDate(dateStr: string): string {
  const date = new Date(dateStr + "T12:00:00"); // Use noon to avoid timezone issues
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
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

/**
 * Send scheduling notification to assigned crew member
 */
interface SendSchedulingNotificationParams {
  to: string; // Crew member email
  crewMemberName: string;
  scheduledByName: string;
  scheduledByEmail: string;
  appointmentType: "survey" | "installation" | "inspection";
  customerName: string;
  customerAddress: string;
  scheduledDate: string; // YYYY-MM-DD
  scheduledStart?: string; // HH:mm
  scheduledEnd?: string; // HH:mm
  projectId: string;
  notes?: string;
}

export async function sendSchedulingNotification(
  params: SendSchedulingNotificationParams
): Promise<{ success: boolean; error?: string }> {
  const resend = getResendClient();

  const appointmentTypeLabel = APPOINTMENT_TYPE_LABELS[params.appointmentType] || params.appointmentType;
  const formattedDate = formatDate(params.scheduledDate);
  const timeSlot = params.scheduledStart && params.scheduledEnd
    ? `${formatTime(params.scheduledStart)} - ${formatTime(params.scheduledEnd)}`
    : "Full day";

  // If no Resend API key, log for development
  if (!resend) {
    console.log(`
    ==========================================
    SCHEDULING NOTIFICATION for ${params.to}
    Crew Member: ${params.crewMemberName}
    Scheduled By: ${params.scheduledByName} (${params.scheduledByEmail})
    Type: ${appointmentTypeLabel}
    Customer: ${params.customerName}
    Address: ${params.customerAddress}
    Date: ${formattedDate}
    Time: ${timeSlot}
    Notes: ${params.notes || "None"}
    (Set RESEND_API_KEY to send real emails)
    ==========================================
    `);
    return { success: true };
  }

  try {
    const { error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || "PB Operations <noreply@photonbrothers.com>",
      to: [params.to],
      subject: `New ${appointmentTypeLabel} Scheduled - ${params.customerName}`,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0a0a0f; color: #ffffff; padding: 40px 20px; margin: 0;">
            <div style="max-width: 500px; margin: 0 auto; background-color: #12121a; border: 1px solid #1e1e2e; border-radius: 12px; padding: 32px;">
              <h1 style="font-size: 24px; font-weight: bold; background: linear-gradient(to right, #f97316, #fb923c); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin: 0 0 8px 0; text-align: center;">
                PB Operations Suite
              </h1>
              <p style="color: #71717a; font-size: 14px; text-align: center; margin: 0 0 32px 0;">
                New Appointment Scheduled
              </p>

              <div style="background-color: #0a0a0f; border: 1px solid #1e1e2e; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
                <div style="display: flex; align-items: center; margin-bottom: 16px;">
                  <span style="background: linear-gradient(to right, #f97316, #fb923c); color: white; padding: 4px 12px; border-radius: 4px; font-size: 12px; font-weight: 600; text-transform: uppercase;">
                    ${appointmentTypeLabel}
                  </span>
                </div>

                <h2 style="font-size: 20px; color: #ffffff; margin: 0 0 16px 0;">
                  ${params.customerName}
                </h2>

                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="color: #71717a; font-size: 13px; padding: 8px 0; border-bottom: 1px solid #1e1e2e;">📍 Address</td>
                    <td style="color: #ffffff; font-size: 13px; padding: 8px 0; border-bottom: 1px solid #1e1e2e; text-align: right;">${params.customerAddress}</td>
                  </tr>
                  <tr>
                    <td style="color: #71717a; font-size: 13px; padding: 8px 0; border-bottom: 1px solid #1e1e2e;">📅 Date</td>
                    <td style="color: #ffffff; font-size: 13px; padding: 8px 0; border-bottom: 1px solid #1e1e2e; text-align: right;">${formattedDate}</td>
                  </tr>
                  <tr>
                    <td style="color: #71717a; font-size: 13px; padding: 8px 0; border-bottom: 1px solid #1e1e2e;">⏰ Time</td>
                    <td style="color: #ffffff; font-size: 13px; padding: 8px 0; border-bottom: 1px solid #1e1e2e; text-align: right;">${timeSlot}</td>
                  </tr>
                  <tr>
                    <td style="color: #71717a; font-size: 13px; padding: 8px 0;">👤 Scheduled by</td>
                    <td style="color: #ffffff; font-size: 13px; padding: 8px 0; text-align: right;">${params.scheduledByName}</td>
                  </tr>
                  ${params.notes ? `
                  <tr>
                    <td colspan="2" style="padding-top: 16px;">
                      <div style="background-color: #1e1e2e; border-radius: 6px; padding: 12px;">
                        <p style="color: #71717a; font-size: 12px; margin: 0 0 4px 0;">📝 Notes</p>
                        <p style="color: #ffffff; font-size: 13px; margin: 0;">${params.notes}</p>
                      </div>
                    </td>
                  </tr>
                  ` : ""}
                </table>
              </div>

              <p style="color: #71717a; font-size: 12px; text-align: center; margin: 0;">
                Please check your Zuper app for complete details.
              </p>
            </div>

            <p style="color: #3f3f46; font-size: 11px; text-align: center; margin-top: 24px;">
              Photon Brothers Operations Suite
            </p>
          </body>
        </html>
      `,
      text: `New ${appointmentTypeLabel} Scheduled

Hi ${params.crewMemberName},

You have been scheduled for a new ${appointmentTypeLabel.toLowerCase()} appointment.

Customer: ${params.customerName}
Address: ${params.customerAddress}
Date: ${formattedDate}
Time: ${timeSlot}
Scheduled by: ${params.scheduledByName}
${params.notes ? `\nNotes: ${params.notes}` : ""}

Please check your Zuper app for complete details.

- PB Operations`,
    });

    if (error) {
      console.error("Failed to send scheduling notification:", error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    console.error("Failed to send scheduling notification:", err);
    return { success: false, error: "Failed to send notification email" };
  }
}
