import fs from "fs";

// Load .env.local
const lines = fs.readFileSync(".env.local", "utf-8").split("\n");
for (const line of lines) {
  const match = line.match(/^([^#=]+)=(.*)/);
  if (match) {
    let val = match[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[match[1].trim()] = val;
  }
}

// Override with the Resend fallback sender
process.env.RESEND_FROM_EMAIL = "onboarding@resend.dev";

const { Resend } = await import("resend");
const resend = new Resend(process.env.RESEND_API_KEY);

const from = `PB Operations <${process.env.RESEND_FROM_EMAIL}>`;
console.log(`Sending from: ${from}`);
console.log(`Sending to: delivered@resend.dev (Resend test inbox)`);

try {
  const result = await resend.emails.send({
    from,
    to: ["delivered@resend.dev"],
    subject: "PB Ops - Site Survey Notification Test",
    text: "This is a test scheduling notification from PB Operations Suite.",
    html: "<h2>Site Survey Scheduled</h2><p>This is a test scheduling notification from PB Operations Suite.</p>",
  });

  if (result.error) {
    console.log(`\nFAILED: ${result.error.message}`);
  } else {
    console.log(`\nSUCCESS! Email ID: ${result.data?.id}`);
  }
} catch (err) {
  console.log(`\nEXCEPTION: ${err.message}`);
}
