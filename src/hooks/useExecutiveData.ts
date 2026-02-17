"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useActivityTracking } from "./useActivityTracking";
import { queryKeys } from "@/lib/query-keys";
import {
  type ExecProject,
  type CapacityAnalysis,
  type Alert,
  transformProject,
  calculateCapacityAnalysis,
  calculateAlerts,
} from "@/lib/executive-shared";

interface UseExecutiveDataReturn {
  projects: ExecProject[];
  loading: boolean;
  error: string | null;
  lastUpdated: string;
  capacityAnalysis: Record<string, CapacityAnalysis>;
  alerts: Alert[];
  summary: { total_projects: number; total_value: number; pe_projects: number };
  fetchData: () => Promise<void>;
  accessChecked: boolean;
}

/**
 * Shared hook for executive dashboards.
 * Handles auth guard, data fetching, and derived state (capacity, alerts, summary).
 */
export function useExecutiveData(dashboardName: string): UseExecutiveDataReturn {
  const router = useRouter();
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  const [accessChecked, setAccessChecked] = useState(false);

  // Access guard
  const authQuery = useQuery({
    queryKey: queryKeys.auth.sync(),
    queryFn: async () => {
      const res = await fetch("/api/auth/sync");
      if (!res.ok) throw new Error("Auth check failed");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (authQuery.data) {
      const role = authQuery.data.role || "TECH_OPS";
      setAccessChecked(true);
      if (role !== "ADMIN" && role !== "OWNER") {
        router.push("/");
      }
    }
    if (authQuery.error) {
      setAccessChecked(true);
      router.push("/");
    }
  }, [authQuery.data, authQuery.error, router]);

  // Projects data
  const projectsQuery = useQuery({
    queryKey: queryKeys.projects.executive(),
    queryFn: async () => {
      const response = await fetch("/api/projects?context=executive");
      if (!response.ok) throw new Error("Failed to fetch data");
      const data = await response.json();
      return data.projects.map(transformProject) as ExecProject[];
    },
    refetchInterval: 5 * 60 * 1000,
  });

  const projects = projectsQuery.data ?? [];
  const loading = projectsQuery.isLoading;
  const error = projectsQuery.error
    ? (projectsQuery.error as Error).message
    : null;
  const lastUpdated = projectsQuery.dataUpdatedAt
    ? new Date(projectsQuery.dataUpdatedAt).toLocaleString()
    : "";

  // Track view
  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView(dashboardName, { projectCount: projects.length });
    }
  }, [loading, projects.length, trackDashboardView, dashboardName]);

  const capacityAnalysis = useMemo(
    () => calculateCapacityAnalysis(projects),
    [projects]
  );

  const alerts = useMemo(
    () => calculateAlerts(projects, capacityAnalysis),
    [projects, capacityAnalysis]
  );

  const summary = useMemo(
    () => ({
      total_projects: projects.length,
      total_value: projects.reduce((s, p) => s + p.amount, 0),
      pe_projects: projects.filter((p) => p.is_participate_energy).length,
    }),
    [projects]
  );

  return {
    projects,
    loading,
    error,
    lastUpdated,
    capacityAnalysis,
    alerts,
    summary,
    fetchData: async () => {
      await projectsQuery.refetch();
    },
    accessChecked,
  };
}
