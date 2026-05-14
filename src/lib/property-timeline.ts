/**
 * Property-level unified timeline.
 *
 * Aggregates HubSpot engagements (emails, calls, notes, meetings, tasks) from
 * ALL deals, tickets, and contacts linked to a Property address. Deduplicates
 * by engagement ID so the same email seen from a deal and its contact only
 * appears once.
 */
import { prisma } from "@/lib/db";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import { getObjectEngagements } from "@/lib/hubspot-engagements";
import type { Engagement } from "@/components/deal-detail/types";

const DEFAULT_LIMIT = 25;

export interface PropertyTimelinePage {
  engagements: Engagement[];
  total: number;
  hasMore: boolean;
}

export async function getPropertyTimeline(
  hubspotObjectId: string,
  options?: { offset?: number; limit?: number },
): Promise<PropertyTimelinePage> {
  const offset = options?.offset ?? 0;
  const limit = options?.limit ?? DEFAULT_LIMIT;

  const result = await appCache.getOrFetch(
    CACHE_KEYS.PROPERTY_TIMELINE(hubspotObjectId),
    async () => {
      const property = await prisma.hubSpotPropertyCache.findUnique({
        where: { hubspotObjectId },
        include: {
          dealLinks: { select: { dealId: true } },
          ticketLinks: { select: { ticketId: true } },
          contactLinks: { select: { contactId: true } },
        },
      });

      if (!property) return [];

      const dealIds = property.dealLinks.map((l) => l.dealId);
      const ticketIds = property.ticketLinks.map((l) => l.ticketId);
      const contactIds = Array.from(
        new Set(property.contactLinks.map((l) => l.contactId)),
      );

      const fetches: Promise<Engagement[]>[] = [
        ...dealIds.map((id) =>
          getObjectEngagements(id, "deals", { expandContacts: true }),
        ),
        ...ticketIds.map((id) =>
          getObjectEngagements(id, "tickets", { expandContacts: true }),
        ),
        // Direct contact engagements — don't re-expand contacts
        ...contactIds.map((id) =>
          getObjectEngagements(id, "contacts", { expandContacts: false }),
        ),
      ];

      const results = await Promise.all(fetches);
      const all = results.flat();

      // Deduplicate by engagement ID
      const seen = new Set<string>();
      const deduped: Engagement[] = [];
      for (const eng of all) {
        if (seen.has(eng.id)) continue;
        seen.add(eng.id);
        deduped.push(eng);
      }

      return deduped.sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );
    },
  );

  const all = result.data;
  const page = all.slice(offset, offset + limit);

  return {
    engagements: page,
    total: all.length,
    hasMore: offset + limit < all.length,
  };
}
