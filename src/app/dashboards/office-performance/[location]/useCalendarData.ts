"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import {
  generateProjectEvents,
  generateZuperEvents,
  buildAssigneeLookup,
  expandToDayPills,
  toCalendarProject,
  PROJECT_CATEGORY_UIDS,
  SERVICE_CATEGORY_UIDS,
  DNR_CATEGORY_UIDS,
  ROOFING_CATEGORY_UIDS,
  EXCLUDE_OTHER_CATEGORY_UIDS,
  type RawApiProject,
  type ZuperCategoryJob,
  type DayPill,
} from "@/lib/calendar-events";
import type { CanonicalLocation } from "@/lib/locations";
import { DASHBOARD_LOCATION_GROUPS } from "@/lib/dashboard-location-groups";

/**
 * Shared data-fetching hook for all calendar views (month, week, day).
 * Returns the full month's pills map plus temporal metadata.
 */
export function useCalendarData(location: string) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-indexed

  // Buffered date range for Zuper: prev month start → next month end
  const fromDate = new Date(year, month - 2, 1);
  const toDate = new Date(year, month + 1, 0);
  const fromStr = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, "0")}-01`;
  const toStr = `${toDate.getFullYear()}-${String(toDate.getMonth() + 1).padStart(2, "0")}-${String(toDate.getDate()).padStart(2, "0")}`;

  const projectsQuery = useQuery<{ projects?: RawApiProject[] }>({
    queryKey: queryKeys.officeCalendar.projects(location, month, year),
    queryFn: async () => {
      const res = await fetch("/api/projects?context=scheduling&refresh=true");
      if (!res.ok) throw new Error("Failed to fetch projects");
      return res.json();
    },
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  // Fetch Zuper survey/construction/inspection jobs for assignee enrichment
  const projectJobsQuery = useQuery<{ jobs: ZuperCategoryJob[] }>({
    queryKey: queryKeys.officeCalendar.projectJobs(location, fromStr, toStr),
    queryFn: async () => {
      const params = new URLSearchParams({
        categories: PROJECT_CATEGORY_UIDS,
        from_date: fromStr,
        to_date: toStr,
      });
      const res = await fetch(`/api/zuper/jobs/by-category?${params}`);
      if (!res.ok) return { jobs: [] };
      return res.json();
    },
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  const serviceQuery = useQuery<{ jobs: ZuperCategoryJob[] }>({
    queryKey: queryKeys.officeCalendar.serviceJobs(location, fromStr, toStr),
    queryFn: async () => {
      const params = new URLSearchParams({
        categories: SERVICE_CATEGORY_UIDS,
        from_date: fromStr,
        to_date: toStr,
      });
      const res = await fetch(`/api/zuper/jobs/by-category?${params}`);
      if (!res.ok) return { jobs: [] };
      return res.json();
    },
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  const dnrQuery = useQuery<{ jobs: ZuperCategoryJob[] }>({
    queryKey: queryKeys.officeCalendar.dnrJobs(location, fromStr, toStr),
    queryFn: async () => {
      const params = new URLSearchParams({
        categories: DNR_CATEGORY_UIDS,
        from_date: fromStr,
        to_date: toStr,
      });
      const res = await fetch(`/api/zuper/jobs/by-category?${params}`);
      if (!res.ok) return { jobs: [] };
      return res.json();
    },
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  const roofingQuery = useQuery<{ jobs: ZuperCategoryJob[] }>({
    queryKey: queryKeys.officeCalendar.roofingJobs(location, fromStr, toStr),
    queryFn: async () => {
      const params = new URLSearchParams({
        categories: ROOFING_CATEGORY_UIDS,
        from_date: fromStr,
        to_date: toStr,
      });
      const res = await fetch(`/api/zuper/jobs/by-category?${params}`);
      if (!res.ok) return { jobs: [] };
      return res.json();
    },
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  const otherQuery = useQuery<{ jobs: ZuperCategoryJob[] }>({
    queryKey: queryKeys.officeCalendar.otherJobs(location, fromStr, toStr),
    queryFn: async () => {
      const params = new URLSearchParams({
        exclude: EXCLUDE_OTHER_CATEGORY_UIDS,
        from_date: fromStr,
        to_date: toStr,
      });
      const res = await fetch(`/api/zuper/jobs/by-category?${params}`);
      if (!res.ok) return { jobs: [] };
      return res.json();
    },
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  const isLoading = projectsQuery.isLoading;

  // Generate all events → day pills for the month
  const allPills = useMemo(() => {
    const rawProjects = projectsQuery.data?.projects || [];
    const projects = rawProjects.map(toCalendarProject);
    const projectJobs = projectJobsQuery.data?.jobs || [];
    const serviceJobs = serviceQuery.data?.jobs || [];
    const dnrJobs = dnrQuery.data?.jobs || [];
    const roofingJobs = roofingQuery.data?.jobs || [];
    const otherJobs = otherQuery.data?.jobs || [];

    // Build assignee lookup from Zuper project-category jobs (survey/construction/inspection)
    const assigneeLookup = buildAssigneeLookup(projectJobs);

    const group = DASHBOARD_LOCATION_GROUPS.find((g) => g.label === location);
    const canonicals: CanonicalLocation[] = group
      ? (group.canonicals as unknown as CanonicalLocation[])
      : [location as CanonicalLocation];
    const projectEvents = generateProjectEvents(projects, canonicals, assigneeLookup);
    const serviceEvents = generateZuperEvents(serviceJobs, "service", canonicals);
    const dnrEvents = generateZuperEvents(dnrJobs, "dnr", canonicals);
    const roofingEvents = generateZuperEvents(roofingJobs, "roofing", canonicals);
    const otherEvents = generateZuperEvents(otherJobs, "other", canonicals);

    const allEvents = [...projectEvents, ...serviceEvents, ...dnrEvents, ...roofingEvents, ...otherEvents];
    return expandToDayPills(allEvents, year, month);
  }, [projectsQuery.data, projectJobsQuery.data, serviceQuery.data, dnrQuery.data, roofingQuery.data, otherQuery.data, location, year, month]);

  return { allPills, isLoading, year, month };
}

export type { DayPill };
