"use client";

import { useState, useEffect, useCallback } from "react";
import { type Project } from "@/lib/hubspot";
import { CACHE_SETTINGS } from "@/lib/config";

export interface ProjectStats {
  totalProjects: number;
  totalValue: number;
  peCount: number;
  peValue: number;
  rtbCount: number;
  blockedCount: number;
  constructionCount: number;
  inspectionBacklog: number;
  ptoBacklog: number;
  locationCounts: Record<string, number>;
  stageCounts: Record<string, number>;
  totalSystemSizeKw: number;
  totalBatteryKwh: number;
  lastUpdated: string;
}

export interface UseProjectsOptions {
  context?: "scheduling" | "equipment" | "pe" | "executive" | "at-risk" | "all";
  includeStats?: boolean;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

export interface UseProjectsReturn {
  projects: Project[];
  stats: ProjectStats | null;
  loading: boolean;
  error: string | null;
  lastUpdated: string | null;
  refresh: () => Promise<void>;
}

export function useProjects(options: UseProjectsOptions = {}): UseProjectsReturn {
  const {
    context = "executive",
    includeStats = true,
    autoRefresh = true,
    refreshInterval = CACHE_SETTINGS.dashboardRefreshInterval,
  } = options;

  const [projects, setProjects] = useState<Project[]>([]);
  const [stats, setStats] = useState<ProjectStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        context,
        ...(includeStats && { stats: "true" }),
      });

      const res = await fetch(`/api/projects?${params}`);
      if (!res.ok) {
        throw new Error(`Failed to fetch: ${res.status}`);
      }

      const data = await res.json();
      setProjects(data.projects || []);
      setStats(data.stats || null);
      setLastUpdated(data.lastUpdated || new Date().toISOString());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
      console.error("Error fetching projects:", err);
    } finally {
      setLoading(false);
    }
  }, [context, includeStats]);

  useEffect(() => {
    fetchData();

    if (autoRefresh && refreshInterval > 0) {
      const interval = setInterval(fetchData, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [fetchData, autoRefresh, refreshInterval]);

  return {
    projects,
    stats,
    loading,
    error,
    lastUpdated,
    refresh: fetchData,
  };
}

// Hook for fetching deals from other pipelines
export interface UseDealsOptions {
  pipeline: "sales" | "dnr" | "service" | "roofing";
  activeOnly?: boolean;
  autoRefresh?: boolean;
}

export interface Deal {
  id: number;
  name: string;
  stage: string;
  stageId: string;
  amount: number;
  closeDate: string | null;
  location: string;
  url: string;
  owner: string;
  daysSinceClose: number;
  properties: Record<string, unknown>;
}

export interface DealStats {
  total: number;
  totalValue: number;
  byStage: Record<string, { count: number; value: number }>;
  byLocation: Record<string, { count: number; value: number }>;
}

export function useDeals(options: UseDealsOptions) {
  const { pipeline, activeOnly = true, autoRefresh = true } = options;

  const [deals, setDeals] = useState<Deal[]>([]);
  const [stats, setStats] = useState<DealStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        pipeline,
        active: String(activeOnly),
      });

      const res = await fetch(`/api/deals?${params}`);
      if (!res.ok) {
        throw new Error(`Failed to fetch: ${res.status}`);
      }

      const data = await res.json();
      setDeals(data.deals || []);
      setStats(data.stats || null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
      console.error("Error fetching deals:", err);
    } finally {
      setLoading(false);
    }
  }, [pipeline, activeOnly]);

  useEffect(() => {
    fetchData();

    if (autoRefresh) {
      const interval = setInterval(fetchData, CACHE_SETTINGS.dealsTTL);
      return () => clearInterval(interval);
    }
  }, [fetchData, autoRefresh]);

  return {
    deals,
    stats,
    loading,
    error,
    refresh: fetchData,
  };
}
