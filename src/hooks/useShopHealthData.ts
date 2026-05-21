'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import type {
  ShopHealthData,
  ShopHealthOverviewData,
  ShopHealthBottleneckEntry,
} from '@/lib/shop-health-types';

async function fetchShopHealthData(location: string, weekStart: string): Promise<ShopHealthData> {
  const res = await fetch(`/api/shop-health/${location}?week=${weekStart}`);
  if (!res.ok) throw new Error(`Shop health fetch failed: ${res.status}`);
  return res.json();
}

async function fetchOverviewData(weekStart: string): Promise<ShopHealthOverviewData> {
  const res = await fetch(`/api/shop-health/overview?week=${weekStart}`);
  if (!res.ok) throw new Error(`Overview fetch failed: ${res.status}`);
  return res.json();
}

async function createBottleneckReq(params: {
  location: string;
  weekStart: string;
  constraint?: string | null;
  rootCause?: string | null;
  actionPlan?: string | null;
  owner?: string | null;
}): Promise<ShopHealthBottleneckEntry> {
  const res = await fetch('/api/shop-health/bottleneck', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`Bottleneck create failed: ${res.status}`);
  return res.json();
}

async function updateBottleneckReq(params: {
  id: string;
  constraint?: string | null;
  rootCause?: string | null;
  actionPlan?: string | null;
  owner?: string | null;
}): Promise<ShopHealthBottleneckEntry> {
  const res = await fetch('/api/shop-health/bottleneck', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`Bottleneck update failed: ${res.status}`);
  return res.json();
}

async function deleteBottleneckReq(id: string): Promise<void> {
  const res = await fetch(`/api/shop-health/bottleneck?id=${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`Bottleneck delete failed: ${res.status}`);
}

export function useShopHealthData(location: string, weekStart: string) {
  return useQuery({
    queryKey: queryKeys.shopHealth.location(location, weekStart),
    queryFn: () => fetchShopHealthData(location, weekStart),
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: true,
    enabled: !!location && !!weekStart,
  });
}

export function useShopHealthOverview(weekStart: string) {
  return useQuery({
    queryKey: queryKeys.shopHealth.overview(weekStart),
    queryFn: () => fetchOverviewData(weekStart),
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

function useInvalidateShopHealth(location: string, weekStart: string) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({
      queryKey: queryKeys.shopHealth.location(location, weekStart),
    });
  };
}

export function useBottleneckCreate(location: string, weekStart: string) {
  const invalidate = useInvalidateShopHealth(location, weekStart);
  return useMutation({
    mutationFn: createBottleneckReq,
    onSuccess: invalidate,
  });
}

export function useBottleneckUpdate(location: string, weekStart: string) {
  const invalidate = useInvalidateShopHealth(location, weekStart);
  return useMutation({
    mutationFn: updateBottleneckReq,
    onSuccess: invalidate,
  });
}

export function useBottleneckDelete(location: string, weekStart: string) {
  const invalidate = useInvalidateShopHealth(location, weekStart);
  return useMutation({
    mutationFn: deleteBottleneckReq,
    onSuccess: invalidate,
  });
}

/**
 * @deprecated Use useBottleneckCreate instead. Kept for backward compat.
 */
export function useBottleneckMutation(location: string, weekStart: string) {
  return useBottleneckCreate(location, weekStart);
}
