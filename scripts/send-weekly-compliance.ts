import fs from "node:fs";
import path from "node:path";
import { getComplianceDigest } from "@/lib/compliance-digest";
import { sendWeeklyComplianceEmail } from "@/lib/email";

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf-8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function parseRecipients(raw: string): string[] {
  const parts = raw
    .split(/[,\n;]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(parts)];
}

const repoRoot = process.cwd();
loadEnvFile(path.join(repoRoot, ".env"));
loadEnvFile(path.join(repoRoot, ".env.local"));

async function main() {
  const recipientInput =
    process.argv[2] ||
    process.env.COMPLIANCE_REPORT_RECIPIENTS ||
    process.env.GOOGLE_ADMIN_EMAIL ||
    "zach@photonbrothers.com";

  const daysInput = Number(process.argv[3] || process.env.COMPLIANCE_REPORT_DAYS || "7");
  const days = Number.isFinite(daysInput) && daysInput > 0 ? Math.min(90, Math.floor(daysInput)) : 7;
  const recipients = parseRecipients(recipientInput);
  if (recipients.length === 0) {
    throw new Error("No recipients provided");
  }

  // Weekly report should only go to explicit report recipients.
  process.env.SCHEDULING_NOTIFICATION_BCC = "";

  const to = recipients[0];
  const bcc = recipients.slice(1);

  console.log(`Building ${days}-day compliance digest for ${to}${bcc.length ? ` (bcc: ${bcc.join(", ")})` : ""}`);

  const digest = await getComplianceDigest(days);
  const sendResult = await sendWeeklyComplianceEmail({
    to,
    ...(bcc.length ? { bcc } : {}),
    digest,
  });

  console.log(
    JSON.stringify(
      {
        success: sendResult.success,
        error: sendResult.error,
        to,
        bcc,
        period: digest.period,
        summary: digest.summary,
      },
      null,
      2
    )
  );

  if (!sendResult.success) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
