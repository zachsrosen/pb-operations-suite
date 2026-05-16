// src/lib/shop-health-bottleneck.ts
// Database operations for ShopHealthBottleneck entries.

import { prisma } from './db';
import type { ShopHealthBottleneckEntry } from './shop-health-types';

/**
 * Upsert a bottleneck entry for a location + week.
 * Uses the unique constraint on (location, weekStart).
 */
export async function upsertBottleneck(params: {
  location: string;
  weekStart: Date;
  constraint?: string | null;
  rootCause?: string | null;
  actionPlan?: string | null;
  owner?: string | null;
  userId: string;
}): Promise<ShopHealthBottleneckEntry> {
  const entry = await prisma.shopHealthBottleneck.upsert({
    where: {
      location_weekStart: {
        location: params.location,
        weekStart: params.weekStart,
      },
    },
    create: {
      location: params.location,
      weekStart: params.weekStart,
      constraint: params.constraint ?? null,
      rootCause: params.rootCause ?? null,
      actionPlan: params.actionPlan ?? null,
      owner: params.owner ?? null,
      userId: params.userId,
    },
    update: {
      constraint: params.constraint ?? undefined,
      rootCause: params.rootCause ?? undefined,
      actionPlan: params.actionPlan ?? undefined,
      owner: params.owner ?? undefined,
      userId: params.userId,
    },
  });

  return serializeBottleneck(entry);
}

/**
 * Get bottleneck history for a location (last N weeks).
 */
export async function getBottleneckHistory(
  location: string,
  weeks: number = 4
): Promise<ShopHealthBottleneckEntry[]> {
  const entries = await prisma.shopHealthBottleneck.findMany({
    where: { location },
    orderBy: { weekStart: 'desc' },
    take: weeks,
  });

  return entries.map(serializeBottleneck);
}

function serializeBottleneck(entry: {
  id: string;
  location: string;
  weekStart: Date;
  constraint: string | null;
  rootCause: string | null;
  actionPlan: string | null;
  owner: string | null;
  userId: string;
  updatedAt: Date;
}): ShopHealthBottleneckEntry {
  return {
    id: entry.id,
    location: entry.location,
    weekStart: entry.weekStart.toISOString(),
    constraint: entry.constraint,
    rootCause: entry.rootCause,
    actionPlan: entry.actionPlan,
    owner: entry.owner,
    userId: entry.userId,
    updatedAt: entry.updatedAt.toISOString(),
  };
}
