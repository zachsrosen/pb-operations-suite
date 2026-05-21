// src/lib/shop-health-bottleneck.ts
// Database operations for ShopHealthBottleneck entries.

import { prisma } from './db';
import type { ShopHealthBottleneckEntry } from './shop-health-types';

/**
 * Create a new bottleneck entry for a location + week.
 * Multiple entries per location per week are allowed.
 */
export async function createBottleneck(params: {
  location: string;
  weekStart: Date;
  constraint?: string | null;
  rootCause?: string | null;
  actionPlan?: string | null;
  owner?: string | null;
  userId: string;
}): Promise<ShopHealthBottleneckEntry> {
  const entry = await prisma.shopHealthBottleneck.create({
    data: {
      location: params.location,
      weekStart: params.weekStart,
      constraint: params.constraint ?? null,
      rootCause: params.rootCause ?? null,
      actionPlan: params.actionPlan ?? null,
      owner: params.owner ?? null,
      userId: params.userId,
    },
  });

  return serializeBottleneck(entry);
}

/**
 * Update an existing bottleneck entry by ID.
 */
export async function updateBottleneck(params: {
  id: string;
  constraint?: string | null;
  rootCause?: string | null;
  actionPlan?: string | null;
  owner?: string | null;
  userId: string;
}): Promise<ShopHealthBottleneckEntry> {
  const entry = await prisma.shopHealthBottleneck.update({
    where: { id: params.id },
    data: {
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
 * Delete a bottleneck entry by ID.
 */
export async function deleteBottleneck(id: string): Promise<void> {
  await prisma.shopHealthBottleneck.delete({ where: { id } });
}

/**
 * Get all bottleneck entries for a location + specific week.
 */
export async function getBottlenecksForWeek(
  location: string,
  weekStart: Date
): Promise<ShopHealthBottleneckEntry[]> {
  const entries = await prisma.shopHealthBottleneck.findMany({
    where: { location, weekStart },
    orderBy: { createdAt: 'asc' },
  });

  return entries.map(serializeBottleneck);
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
    orderBy: [{ weekStart: 'desc' }, { createdAt: 'asc' }],
    take: weeks * 5, // Allow up to ~5 entries per week
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
