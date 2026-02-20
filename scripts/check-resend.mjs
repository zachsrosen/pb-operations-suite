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

const { Resend } = await import("resend");
const resend = new Resend(process.env.RESEND_API_KEY);

// 1. List verified domains
console.log("=== RESEND DOMAINS ===");
try {
  const domains = await resend.domains.list();
  if (domains.data?.data?.length) {
    for (const d of domains.data.data) {
      console.log(`  ${d.name} — status: ${d.status}, region: ${d.region}`);
    }
  } else {
    console.log("  No domains verified!");
    console.log("  You can only send from: onboarding@resend.dev");
  }
} catch (err) {
  console.log("  Error listing domains:", err.message);
}

// 2. List API keys (to check permissions)
console.log("\n=== RESEND API KEY INFO ===");
try {
  const keys = await resend.apiKeys.list();
  if (keys.data?.data?.length) {
    for (const k of keys.data.data) {
      console.log(`  ${k.name} — id: ${k.id}, created: ${k.created_at}`);
    }
  }
} catch (err) {
  console.log("  Error listing keys:", err.message);
}

// 3. Determine what 'from' the app would use
const parseEmail = (s) => {
  if (!s) return null;
  const m = s.trim().match(/<([^>]+)>/);
  const c = (m ? m[1] : s).trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c) ? c : null;
};
const senderEmail =
  parseEmail(process.env.GOOGLE_EMAIL_SENDER) ||
  parseEmail(process.env.EMAIL_FROM) ||
  parseEmail(process.env.GOOGLE_ADMIN_EMAIL);
const from = process.env.EMAIL_FROM || (senderEmail ? `PB Operations <${senderEmail}>` : "PB Operations <noreply@photonbrothers.com>");

console.log(`\n=== FROM ADDRESS ===`);
console.log(`  App would send from: ${from}`);
console.log(`  Sender domain: ${senderEmail?.split("@")[1] || "unknown"}`);

// 4. Try a test send to see the actual error
console.log("\n=== TEST SEND ===");
try {
  const result = await resend.emails.send({
    from,
    to: ["delivered@resend.dev"], // Resend's test address — always succeeds if from is valid
    subject: "PB Ops Notification Test",
    text: "This is a test email from PB Operations Suite to verify Resend is working.",
    html: "<p>This is a test email from PB Operations Suite to verify Resend is working.</p>",
  });

  if (result.error) {
    console.log(`  FAILED: ${result.error.message}`);
    console.log(`  Error name: ${result.error.name}`);
  } else {
    console.log(`  SUCCESS! Email ID: ${result.data?.id}`);
  }
} catch (err) {
  console.log(`  EXCEPTION: ${err.message}`);
}
