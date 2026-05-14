/**
 * Inngest function: Property Sync Worker.
 *
 * Receives `property/sync.requested` events from the workflow-sync webhook
 * and calls the appropriate property-sync handler. Global concurrency limit
 * of 3 keeps HubSpot API calls (~2-4 per record) well under the 100/10s
 * private-app rate limit, even when HubSpot re-enrolls thousands of records
 * at once.
 *
 * Retries: 3 attempts with Inngest's default exponential backoff. This
 * handles transient 429s and network errors that the direct webhook path
 * silently swallows.
 */

import {
  inngest,
  propertySyncRequested,
} from "@/lib/inngest-client";
import {
  onContactAddressChange,
  onDealOrTicketCreated,
} from "@/lib/property-sync";

export const propertySyncWorker = inngest.createFunction(
  {
    id: "property-sync-worker",
    name: "Property: Sync from workflow",
    triggers: [propertySyncRequested],
    concurrency: { limit: 3 },
    retries: 3,
  },
  async ({ event, step }) => {
    const { objectType, objectId } = event.data;

    const outcome = await step.run("sync-property", async () => {
      switch (objectType) {
        case "contact":
          return onContactAddressChange(objectId);
        case "deal":
          return onDealOrTicketCreated("deal", objectId);
        case "ticket":
          return onDealOrTicketCreated("ticket", objectId);
      }
    });

    return outcome;
  },
);
