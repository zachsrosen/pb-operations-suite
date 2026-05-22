/**
 * Create 12 Tesla device-MODEL properties on HubSpot:
 *   4 properties × 3 objects (Property custom object, Deal, Ticket)
 *
 * Companion to _create-tesla-device-hubspot-props.ts (which created the
 * 5 serial/summary props). Idempotent — checks existence before creating;
 * safe to re-run.
 *
 * Run: tsx scripts/_create-tesla-model-hubspot-props.ts
 */

const TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
if (!TOKEN) {
  console.error("HUBSPOT_ACCESS_TOKEN missing");
  process.exit(1);
}

const PROPERTY_OBJECT_TYPE = process.env.HUBSPOT_PROPERTY_OBJECT_TYPE;
if (!PROPERTY_OBJECT_TYPE) {
  console.error("HUBSPOT_PROPERTY_OBJECT_TYPE missing");
  process.exit(1);
}

const GROUP_NAME = "tesla_powerhub";

interface PropSpec {
  name: string;
  label: string;
  description: string;
}

const PROPS: PropSpec[] = [
  {
    name: "tesla_gateway_model",
    label: "Tesla Gateway Model",
    description:
      "Human-readable Tesla Powerwall Gateway product name (e.g. 'Powerwall+', 'Tesla Backup Gateway 2'). Mapped from the part number via tesla-part-numbers.",
  },
  {
    name: "tesla_powerwall_model",
    label: "Tesla Powerwall Model",
    description:
      "Human-readable Tesla Powerwall product name (e.g. 'Powerwall 3', 'Powerwall+'). Mapped from the part number via tesla-part-numbers.",
  },
  {
    name: "tesla_inverter_model",
    label: "Tesla Inverter Model",
    description: "Human-readable Tesla solar inverter product name.",
  },
  {
    name: "tesla_meter_model",
    label: "Tesla Meter Model",
    description: "Human-readable Tesla site meter product name (typically NEURIO).",
  },
];

const OBJECTS: Array<{ id: string; label: string }> = [
  { id: PROPERTY_OBJECT_TYPE, label: "Property" },
  { id: "0-3", label: "Deal" },
  { id: "0-5", label: "Ticket" },
];

async function propertyExists(objectType: string, name: string): Promise<boolean> {
  const res = await fetch(
    `https://api.hubapi.com/crm/v3/properties/${objectType}/${name}`,
    { headers: { Authorization: `Bearer ${TOKEN}` } },
  );
  return res.ok;
}

async function createProperty(objectType: string, spec: PropSpec) {
  const body = {
    name: spec.name,
    label: spec.label,
    description: spec.description,
    groupName: GROUP_NAME,
    type: "string",
    fieldType: "text",
  };
  const res = await fetch(`https://api.hubapi.com/crm/v3/properties/${objectType}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Create failed (${res.status}): ${text}`);
  }
}

(async () => {
  let created = 0;
  let skipped = 0;
  for (const obj of OBJECTS) {
    for (const spec of PROPS) {
      const exists = await propertyExists(obj.id, spec.name);
      if (exists) {
        console.log(`  [skip] ${obj.label}.${spec.name} already exists`);
        skipped++;
        continue;
      }
      try {
        await createProperty(obj.id, spec);
        console.log(`  [create] ${obj.label}.${spec.name}`);
        created++;
      } catch (err) {
        console.error(`  [error] ${obj.label}.${spec.name}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
  console.log(`\nCreated: ${created}  Skipped: ${skipped}  Total expected: ${OBJECTS.length * PROPS.length}`);
})();
