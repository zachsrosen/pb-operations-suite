"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useActivityTracking } from "./useActivityTracking";
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
  const [projects, setProjects] = useState<ExecProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>("");

  // Access guard
  useEffect(() => {
    fetch("/api/auth/sync")
      .then((r) => r.json())
      .then((data) => {
        const role = data.role || "TECH_OPS";
        setAccessChecked(true);
        if (role !== "ADMIN" && role !== "OWNER") {
          router.push("/");
        }
      })
      .catch(() => {
        setAccessChecked(true);
        router.push("/");
      });
  }, [router]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/projects?context=executive");
      if (!response.ok) throw new Error("Failed to fetch data");
      const data = await response.json();
      const transformed = data.projects.map(transformProject);
      setProjects(transformed);
      setLastUpdated(new Date().toLocaleString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchData]);

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
    fetchData,
    accessChecked,
  };
}
