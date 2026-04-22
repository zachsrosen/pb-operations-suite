/**
 * Starter workflow templates.
 *
 * Admins pick a template on the list page and get a pre-filled DRAFT
 * workflow they can customize. Templates are code-defined (not DB-backed)
 * so developers can version-control them and admins can't edit them in
 * place — they clone to edit.
 *
 * Adding a template: append to TEMPLATES below. The `definition.steps` and
 * `triggerConfig` follow the same shape as a live AdminWorkflow.
 */

import type { AdminWorkflowTriggerType } from "@/generated/prisma/enums";

export interface WorkflowTemplate {
  slug: string;
  name: string;
  summary: string;
  triggerType: AdminWorkflowTriggerType;
  triggerConfig: Record<string, unknown>;
  /** Reusable definition shape: { steps: [{ id, kind, inputs }] } */
  definition: {
    steps: Array<{
      id: string;
      kind: string;
      inputs: Record<string, string>;
    }>;
  };
  /** Short note shown on the template card — "what this does" in one line. */
  useCase: string;
}

export const TEMPLATES: WorkflowTemplate[] = [
  {
    slug: "deal-stage-kickoff-email",
    name: "Deal stage → kickoff email",
    summary: "When a deal moves to a target stage, email the ops team with the deal info.",
    useCase: "Use for Construction Scheduled, Install Complete, or any stage change that needs a human heads-up.",
    triggerType: "HUBSPOT_PROPERTY_CHANGE",
    triggerConfig: {
      objectType: "deal",
      propertyName: "dealstage",
      propertyValuesIn: [],
    },
    definition: {
      steps: [
        {
          id: "notify",
          kind: "send-email",
          inputs: {
            to: "ops@photonbrothers.com",
            subject: "Deal moved to {{trigger.propertyValue}}",
            body:
              "<p>Deal <strong>{{trigger.objectId}}</strong> just changed <code>{{trigger.propertyName}}</code> to <strong>{{trigger.propertyValue}}</strong>.</p>" +
              "<p>Take a look: https://app.hubspot.com/contacts/21710069/record/0-3/{{trigger.objectId}}</p>",
          },
        },
      ],
    },
  },
  {
    slug: "deal-stage-add-note",
    name: "Deal stage → add HubSpot note",
    summary: "When a deal changes stage, append a note to its timeline for audit.",
    useCase: "Keeps a paper trail of stage transitions on the deal itself; useful for compliance / handoff review.",
    triggerType: "HUBSPOT_PROPERTY_CHANGE",
    triggerConfig: {
      objectType: "deal",
      propertyName: "dealstage",
      propertyValuesIn: [],
    },
    definition: {
      steps: [
        {
          id: "log-stage",
          kind: "add-hubspot-note",
          inputs: {
            dealId: "{{trigger.objectId}}",
            body: "<p>Stage changed to <strong>{{trigger.propertyValue}}</strong> via PB Ops workflow.</p>",
          },
        },
      ],
    },
  },
  {
    slug: "deal-stage-ai-summary-email",
    name: "Deal stage → AI-summary email",
    summary: "Use Claude to write a friendly status update, then email it to the team.",
    useCase: "Demonstrates chaining: AI drafts prose, email action sends it. Customize the prompt for your tone.",
    triggerType: "HUBSPOT_PROPERTY_CHANGE",
    triggerConfig: {
      objectType: "deal",
      propertyName: "dealstage",
      propertyValuesIn: [],
    },
    definition: {
      steps: [
        {
          id: "compose",
          kind: "ai-compose",
          inputs: {
            prompt:
              "Write a 2-3 sentence friendly status update for the install ops team. " +
              "A HubSpot deal (ID {{trigger.objectId}}) just moved to stage {{trigger.propertyValue}}. " +
              "Include a call to action for the team to take the next step. Keep it brief and professional.",
            maxTokens: "300",
          },
        },
        {
          id: "notify",
          kind: "send-email",
          inputs: {
            to: "ops@photonbrothers.com",
            subject: "Deal {{trigger.objectId}} update",
            body: "<p>{{previous.compose.text}}</p>",
          },
        },
      ],
    },
  },
  {
    slug: "zuper-status-back-to-hubspot",
    name: "Zuper job status → HubSpot deal property",
    summary: "When a Zuper job changes status, write that status back to a HubSpot deal property.",
    useCase: "Keep HubSpot as the source of truth for reporting without Zuper <-> HubSpot being hand-maintained.",
    triggerType: "ZUPER_PROPERTY_CHANGE",
    triggerConfig: {
      objectType: "job",
      propertyName: "status",
      propertyValuesIn: [],
    },
    definition: {
      steps: [
        {
          id: "sync-status",
          kind: "update-hubspot-property",
          inputs: {
            // This template assumes you map the Zuper job ID to a HubSpot deal ID
            // elsewhere (e.g. ZuperJobCache). For a simple demo, pass the Zuper
            // job ID through directly — edit this field before activating.
            dealId: "{{trigger.objectId}}",
            propertyName: "zuper_job_status",
            propertyValue: "{{trigger.propertyValue}}",
          },
        },
      ],
    },
  },
  {
    slug: "deal-stage-fetch-and-notify",
    name: "Deal stage → fetch details → AI email",
    summary:
      "Fetch full deal context when stage changes, then generate a tailored email using AI.",
    useCase:
      "3-step chain demonstrating fetch → compose → notify. Swap the email recipient based on pb_location.",
    triggerType: "HUBSPOT_PROPERTY_CHANGE",
    triggerConfig: {
      objectType: "deal",
      propertyName: "dealstage",
      propertyValuesIn: [],
    },
    definition: {
      steps: [
        {
          id: "fetch",
          kind: "fetch-hubspot-deal",
          inputs: {
            dealId: "{{trigger.objectId}}",
            propertyNames: "dealname, pb_location, system_size_kw, amount, project_number",
          },
        },
        {
          id: "compose",
          kind: "ai-compose",
          inputs: {
            prompt:
              "Write a 3-sentence ops kickoff for deal {{previous.fetch.properties.dealname}} " +
              "(project {{previous.fetch.properties.project_number}}, " +
              "{{previous.fetch.properties.system_size_kw}} kW, " +
              "{{previous.fetch.properties.pb_location}}). " +
              "Stage just changed to {{trigger.propertyValue}}. Include a clear next action for the install crew.",
            maxTokens: "400",
          },
        },
        {
          id: "notify",
          kind: "send-email",
          inputs: {
            to: "ops@photonbrothers.com",
            subject: "Kickoff: {{previous.fetch.properties.dealname}} ({{previous.fetch.properties.pb_location}})",
            body: "<p>{{previous.compose.text}}</p><hr><p>Deal: https://app.hubspot.com/contacts/21710069/record/0-3/{{trigger.objectId}}</p>",
          },
        },
      ],
    },
  },
  {
    slug: "ticket-stuck-escalation",
    name: "Ticket stuck → update property + notify",
    summary:
      "When a service ticket's hs_pipeline_stage changes to a 'waiting' state, bump priority and add an audit note.",
    useCase:
      "Pattern for multi-step ticket automation. Customize the trigger's propertyValuesIn to match your stuck-state IDs.",
    triggerType: "HUBSPOT_PROPERTY_CHANGE",
    triggerConfig: {
      objectType: "ticket",
      propertyName: "hs_pipeline_stage",
      propertyValuesIn: [],
    },
    definition: {
      steps: [
        {
          id: "bump-priority",
          kind: "update-hubspot-ticket-property",
          inputs: {
            ticketId: "{{trigger.objectId}}",
            propertyName: "hs_ticket_priority",
            propertyValue: "HIGH",
          },
        },
        {
          id: "log",
          kind: "log-activity",
          inputs: {
            description: "Ticket {{trigger.objectId}} priority bumped to HIGH by admin workflow",
            entityType: "ticket",
            entityId: "{{trigger.objectId}}",
            metadata: "",
          },
        },
      ],
    },
  },
  {
    slug: "weekly-monday-status-email",
    name: "Monday → weekly status email",
    summary:
      "Every Monday at 9am UTC, send a reminder to the ops team.",
    useCase:
      "Simplest possible CRON-triggered workflow. Edit the subject/body or replace with an ai-compose step for dynamic content.",
    triggerType: "CRON",
    triggerConfig: {
      expression: "0 9 * * 1",
    },
    definition: {
      steps: [
        {
          id: "notify",
          kind: "send-email",
          inputs: {
            to: "ops@photonbrothers.com",
            subject: "Weekly ops reminder — Monday {{trigger.firedAt}}",
            body:
              "<p>Reminder: kick off the week with a pipeline sync.</p>" +
              "<p>Fired at {{trigger.firedAt}} via admin workflow cron.</p>",
          },
        },
      ],
    },
  },
  {
    slug: "manual-test-send-email",
    name: "Manual → send test email",
    summary: "Simplest possible workflow — useful for smoke-testing the plumbing.",
    useCase: "Create this, activate it, click Run now. If the email lands, the plumbing works.",
    triggerType: "MANUAL",
    triggerConfig: {},
    definition: {
      steps: [
        {
          id: "hello",
          kind: "send-email",
          inputs: {
            to: "zach@photonbrothers.com",
            subject: "Admin Workflows test",
            body: "<p>If you're reading this, admin workflows are working end-to-end. 🎉</p>",
          },
        },
      ],
    },
  },
];

export function getTemplateBySlug(slug: string): WorkflowTemplate | undefined {
  return TEMPLATES.find((t) => t.slug === slug);
}
