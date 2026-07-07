/**
 * One-time: seed the "Additional Visit from deal checkbox" admin workflow.
 *
 * Trigger: create_additional_visit deal property → "true"
 * Steps:  fetch reason → create Additional Visit Zuper job → write job UID
 *         back to new_zuper_job_uid (fires the existing Link Deal to Zuper
 *         Job HubSpot workflow) → reset the checkbox → HubSpot note.
 *
 * Creates as ACTIVE, attributed to Zach. Idempotent by name.
 *
 *     npx tsx scripts/_seed-additional-visit-workflow.ts
 */
import "dotenv/config";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client.js";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
});

const WORKFLOW_NAME = "Deal checkbox → Additional Visit Zuper job";
const ADDITIONAL_VISIT_CATEGORY_UID = "d83c054f-69c1-470c-964c-2b79e88258f4";

async function main() {
  const existing = await prisma.adminWorkflow.findFirst({ where: { name: WORKFLOW_NAME } });
  if (existing) {
    console.log(`Workflow already exists (${existing.id}, ${existing.status}) — skipping`);
    return;
  }

  const zach = await prisma.user.findFirst({ where: { email: "zach@photonbrothers.com" } });
  if (!zach) throw new Error("Zach's user row not found");

  const workflow = await prisma.adminWorkflow.create({
    data: {
      name: WORKFLOW_NAME,
      description:
        "Tick 'Create Additional Visit Job' on a deal to auto-create an unscheduled Additional Visit job in Zuper. Reason textarea becomes the job description. Resets the checkbox when done.",
      status: "ACTIVE",
      triggerType: "HUBSPOT_PROPERTY_CHANGE",
      triggerConfig: {
        objectType: "deal",
        propertyName: "create_additional_visit",
        propertyValuesIn: ["true"],
      },
      definition: {
        steps: [
          {
            id: "fetch-reason",
            kind: "fetch-hubspot-deal",
            inputs: {
              dealId: "{{trigger.objectId}}",
              propertyNames: "additional_visit_reason, dealname",
            },
          },
          {
            id: "create-job",
            kind: "create-zuper-job",
            inputs: {
              dealId: "{{trigger.objectId}}",
              jobCategoryUid: ADDITIONAL_VISIT_CATEGORY_UID,
              jobDescription: "{{previous.fetch-reason.properties.additional_visit_reason}}",
            },
          },
          {
            id: "link-job",
            kind: "update-hubspot-property",
            inputs: {
              dealId: "{{trigger.objectId}}",
              propertyName: "new_zuper_job_uid",
              propertyValue: "{{previous.create-job.jobUid}}",
            },
          },
          {
            id: "reset-checkbox",
            kind: "update-hubspot-property",
            inputs: {
              dealId: "{{trigger.objectId}}",
              propertyName: "create_additional_visit",
              propertyValue: "false",
            },
          },
          {
            id: "note",
            kind: "add-hubspot-note",
            inputs: {
              dealId: "{{trigger.objectId}}",
              body:
                '<p>Additional Visit job created in Zuper via PB Ops workflow: ' +
                '<a href="{{previous.create-job.jobUrl}}">{{previous.create-job.jobTitle}}</a></p>',
            },
          },
        ],
      },
      maxRunsPerHour: 30,
      createdById: zach.id,
    },
  });

  console.log(`Created ACTIVE workflow ${workflow.id}: ${WORKFLOW_NAME}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
