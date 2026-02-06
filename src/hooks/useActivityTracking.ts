"use client";

import { useCallback, useEffect, useRef } from "react";

// Generate a session ID that persists for the browser session
const getSessionId = () => {
  if (typeof window === "undefined") return null;

  let sessionId = sessionStorage.getItem("pb_session_id");
  if (!sessionId) {
    sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    sessionStorage.setItem("pb_session_id", sessionId);
  }
  return sessionId;
};

interface ActivityTracker {
  trackDashboardView: (dashboard: string, options?: {
    filters?: Record<string, unknown>;
    projectCount?: number;
    pbLocation?: string;
  }) => void;
  trackProjectView: (projectId: string, projectName: string, source?: string) => void;
  trackSearch: (searchTerm: string, resultCount: number, dashboard?: string) => void;
  trackFilter: (dashboard: string, filters: Record<string, unknown>) => void;
  trackExport: (exportType: string, recordCount: number, dashboard?: string, filters?: Record<string, unknown>) => void;
  trackFeature: (feature: string, description?: string, metadata?: Record<string, unknown>) => void;
}

/**
 * Hook for tracking user activity in dashboards
 *
 * Usage:
 * ```tsx
 * const { trackDashboardView, trackSearch, trackFilter } = useActivityTracking();
 *
 * useEffect(() => {
 *   trackDashboardView("site-survey", { projectCount: projects.length });
 * }, []);
 *
 * const handleSearch = (term: string) => {
 *   const results = search(term);
 *   trackSearch(term, results.length, "site-survey");
 * };
 * ```
 */
export function useActivityTracking(): ActivityTracker {
  const sessionId = useRef<string | null>(null);

  useEffect(() => {
    sessionId.current = getSessionId();
  }, []);

  const logActivity = useCallback(async (action: string, data: Record<string, unknown>) => {
    try {
      await fetch("/api/activity/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          sessionId: sessionId.current,
          ...data,
        }),
      });
    } catch (error) {
      // Silently fail - don't break the app for analytics
      console.debug("Activity tracking failed:", error);
    }
  }, []);

  const trackDashboardView = useCallback((
    dashboard: string,
    options?: {
      filters?: Record<string, unknown>;
      projectCount?: number;
      pbLocation?: string;
    }
  ) => {
    logActivity("dashboard_view", {
      dashboard,
      filters: options?.filters,
      projectCount: options?.projectCount,
      pbLocation: options?.pbLocation,
    });
  }, [logActivity]);

  const trackProjectView = useCallback((
    projectId: string,
    projectName: string,
    source?: string
  ) => {
    logActivity("project_view", {
      projectId,
      projectName,
      source: source || "dashboard",
    });
  }, [logActivity]);

  const trackSearch = useCallback((
    searchTerm: string,
    resultCount: number,
    dashboard?: string
  ) => {
    // Debounce search tracking - don't track every keystroke
    if (searchTerm.length < 2) return;

    logActivity("search", {
      searchTerm,
      resultCount,
      dashboard,
    });
  }, [logActivity]);

  const trackFilter = useCallback((
    dashboard: string,
    filters: Record<string, unknown>
  ) => {
    logActivity("filter", {
      dashboard,
      filters,
    });
  }, [logActivity]);

  const trackExport = useCallback((
    exportType: string,
    recordCount: number,
    dashboard?: string,
    filters?: Record<string, unknown>
  ) => {
    logActivity("export", {
      exportType,
      recordCount,
      dashboard,
      filters,
    });
  }, [logActivity]);

  const trackFeature = useCallback((
    feature: string,
    description?: string,
    metadata?: Record<string, unknown>
  ) => {
    logActivity("feature_used", {
      feature,
      description,
      metadata,
    });
  }, [logActivity]);

  return {
    trackDashboardView,
    trackProjectView,
    trackSearch,
    trackFilter,
    trackExport,
    trackFeature,
  };
}

/**
 * Debounced version of trackSearch for use with search inputs
 */
export function useDebouncedSearch(tracker: ActivityTracker, delay: number = 500) {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  return useCallback((searchTerm: string, resultCount: number, dashboard?: string) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      tracker.trackSearch(searchTerm, resultCount, dashboard);
    }, delay);
  }, [tracker, delay]);
}
