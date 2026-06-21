import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config(); // fall back to .env

const TOKEN = process.env.HUBSPOT_ACCESS_TOKEN!;
const H = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

async function main() {
  // Mirror the existing vishtik_project_id property's group/fieldType.
  const idRes = await fetch("https://api.hubapi.com/crm/v3/properties/deals/vishtik_project_id", { headers: H });
  if (!idRes.ok) throw new Error(`vishtik_project_id lookup failed: ${idRes.status}`);
  const idProp = await idRes.json();
  const groupName = idProp.groupName as string;

  const name = "vishtik_project_url";
  const check = await fetch(`https://api.hubapi.com/crm/v3/properties/deals/${name}`, { headers: H });
  if (check.ok) { console.log(`✓ ${name} already exists`); return; }

  const res = await fetch("https://api.hubapi.com/crm/v3/properties/deals", {
    method: "POST", headers: H,
    body: JSON.stringify({
      name, label: "Vishtik Project URL", type: "string", fieldType: "text",
      groupName, description: "Deep link to the Vishtik design project for this deal.",
    }),
  });
  console.log(res.ok ? `✓ Created ${name} (group ${groupName})` : `✗ ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
