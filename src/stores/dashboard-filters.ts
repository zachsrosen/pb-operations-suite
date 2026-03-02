import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Per-dashboard filter persistence store.
 *
 * Stores raw JSON per dashboard ID. Typed accessor hooks per dashboard
 * provide type safety without forcing all pages into one shape.
 */
interface DashboardFilterStore {
  filters: Record<string, unknown>;
  setFilters: (id: string, value: unknown) => void;
  clearFilters: (id: string) => void;
}

export const useDashboardFilters = create<DashboardFilterStore>()(
  persist(
    (set) => ({
      filters: {},
      setFilters: (id, value) =>
        set((state) => ({
          filters: { ...state.filters, [id]: value },
        })),
      clearFilters: (id) =>
        set((state) => {
          const { [id]: _, ...rest } = state.filters;
          void _;
          return { filters: rest };
        }),
    }),
    {
      name: "pb-dashboard-filters",
    }
  )
);

// ===== Per-dashboard typed accessor hooks =====

export interface DesignFilters {
  locations: string[];
  stages: string[];
  designStatuses: string[];
  designApprovalStatuses: string[];
  search: string;
}

const defaultDesignFilters: DesignFilters = {
  locations: [],
  stages: [],
  designStatuses: [],
  designApprovalStatuses: [],
  search: "",
};

export function useDesignFilters() {
  const raw = useDashboardFilters(
    (s) => s.filters["design"]
  ) as DesignFilters | undefined;
  const setFilters = useDashboardFilters((s) => s.setFilters);
  return {
    filters: raw ?? defaultDesignFilters,
    setFilters: (f: DesignFilters) => setFilters("design", f),
    clearFilters: () =>
      useDashboardFilters.getState().clearFilters("design"),
  };
}

export interface PEFilters {
  view: "overview" | "projects" | "milestones" | "revenue";
  filterStatus: "all" | "overdue" | "soon" | "ontrack";
  filterMilestone: string;
  sortBy: "pto" | "inspection" | "install" | "amount";
  search: string;
}

const defaultPEFilters: PEFilters = {
  view: "overview",
  filterStatus: "all",
  filterMilestone: "all",
  sortBy: "pto",
  search: "",
};

export function usePEFilters() {
  const raw = useDashboardFilters(
    (s) => s.filters["pe"]
  ) as PEFilters | undefined;
  const setFilters = useDashboardFilters((s) => s.setFilters);
  return {
    filters: raw ?? defaultPEFilters,
    setFilters: (f: PEFilters) => setFilters("pe", f),
    clearFilters: () => useDashboardFilters.getState().clearFilters("pe"),
  };
}

export interface ConstructionFilters {
  locations: string[];
  stages: string[];
  constructionStatuses: string[];
  search: string;
}

const defaultConstructionFilters: ConstructionFilters = {
  locations: [],
  stages: [],
  constructionStatuses: [],
  search: "",
};

export function useConstructionFilters() {
  const raw = useDashboardFilters(
    (s) => s.filters["construction"]
  ) as ConstructionFilters | undefined;
  const setFilters = useDashboardFilters((s) => s.setFilters);
  return {
    filters: raw ?? defaultConstructionFilters,
    setFilters: (f: ConstructionFilters) => setFilters("construction", f),
    clearFilters: () =>
      useDashboardFilters.getState().clearFilters("construction"),
  };
}

// ===== Simple dropdown filters (sales, service) =====

export interface SimpleDropdownFilters {
  location: string;
  stage: string;
}

const defaultSimpleFilters: SimpleDropdownFilters = {
  location: "all",
  stage: "all",
};

export function useSalesFilters() {
  const raw = useDashboardFilters(
    (s) => s.filters["sales"]
  ) as SimpleDropdownFilters | undefined;
  const setFilters = useDashboardFilters((s) => s.setFilters);
  return {
    filters: raw ?? defaultSimpleFilters,
    setFilters: (f: SimpleDropdownFilters) => setFilters("sales", f),
    clearFilters: () =>
      useDashboardFilters.getState().clearFilters("sales"),
  };
}

export function useServiceFilters() {
  const raw = useDashboardFilters(
    (s) => s.filters["service"]
  ) as SimpleDropdownFilters | undefined;
  const setFilters = useDashboardFilters((s) => s.setFilters);
  return {
    filters: raw ?? defaultSimpleFilters,
    setFilters: (f: SimpleDropdownFilters) => setFilters("service", f),
    clearFilters: () =>
      useDashboardFilters.getState().clearFilters("service"),
  };
}

// ===== Site Survey filters =====

export interface SiteSurveyFilters {
  locations: string[];
  stages: string[];
  siteSurveyStatuses: string[];
  search: string;
}

const defaultSiteSurveyFilters: SiteSurveyFilters = {
  locations: [],
  stages: [],
  siteSurveyStatuses: [],
  search: "",
};

export function useSiteSurveyFilters() {
  const raw = useDashboardFilters(
    (s) => s.filters["site-survey"]
  ) as SiteSurveyFilters | undefined;
  const setFilters = useDashboardFilters((s) => s.setFilters);
  return {
    filters: raw ?? defaultSiteSurveyFilters,
    setFilters: (f: SiteSurveyFilters) => setFilters("site-survey", f),
    clearFilters: () =>
      useDashboardFilters.getState().clearFilters("site-survey"),
  };
}

// ===== P&I Suite filters (6 dashboards) =====

export interface PISubFilters {
  locations: string[];
  permitLeads: string[];
  icLeads: string[];
  stages: string[];
}

const defaultPISubFilters: PISubFilters = {
  locations: [],
  permitLeads: [],
  icLeads: [],
  stages: [],
};

function createPIFilterHook(key: string) {
  return function usePISubFilters() {
    const raw = useDashboardFilters(
      (s) => s.filters[key]
    ) as PISubFilters | undefined;
    const setFilters = useDashboardFilters((s) => s.setFilters);
    return {
      filters: raw ? { ...defaultPISubFilters, ...raw } : defaultPISubFilters,
      setFilters: (f: PISubFilters) => setFilters(key, f),
      clearFilters: () =>
        useDashboardFilters.getState().clearFilters(key),
    };
  };
}

export const usePIOverviewFilters = createPIFilterHook("pi-overview");
export const usePIMetricsFilters = createPIFilterHook("pi-metrics");
export const usePITimelineFilters = createPIFilterHook("pi-timeline");
export const usePIActionQueueFilters = createPIFilterHook("pi-action-queue");
export const useAHJTrackerFilters = createPIFilterHook("ahj-tracker");
export const useUtilityTrackerFilters = createPIFilterHook("utility-tracker");
export const usePIRevisionsFilters = createPIFilterHook("pi-revisions");
export const usePIPermitActionQueueFilters = createPIFilterHook("pi-permit-action-queue");
export const usePIICActionQueueFilters = createPIFilterHook("pi-ic-action-queue");
export const usePIPermitRevisionsFilters = createPIFilterHook("pi-permit-revisions");
export const usePIICRevisionsFilters = createPIFilterHook("pi-ic-revisions");

// ===== D&E Suite filters (5 dashboards) =====

export interface DESubFilters {
  locations: string[];
  owners: string[];
  stages: string[];
  surveyors: string[];
  designLeads: string[];
}

const defaultDESubFilters: DESubFilters = {
  locations: [],
  owners: [],
  stages: [],
  surveyors: [],
  designLeads: [],
};

function createDEFilterHook(key: string) {
  return function useDESubFilters() {
    const raw = useDashboardFilters(
      (s) => s.filters[key]
    ) as DESubFilters | undefined;
    const setFilters = useDashboardFilters((s) => s.setFilters);
    return {
      filters: raw ?? defaultDESubFilters,
      setFilters: (f: DESubFilters) => setFilters(key, f),
      clearFilters: () =>
        useDashboardFilters.getState().clearFilters(key),
    };
  };
}

export const useDEOverviewFilters = createDEFilterHook("de-overview");
export const useDEMetricsFilters = createDEFilterHook("de-metrics");
export const usePlanReviewFilters = createDEFilterHook("plan-review");
export const usePendingApprovalFilters = createDEFilterHook("pending-approval");
export const useDesignRevisionsFilters = createDEFilterHook("design-revisions");

// ===== Clipping Analytics filters =====

export interface ClippingAnalyticsFilters {
  locations: string[];
  stages: string[];
}

const defaultClippingAnalyticsFilters: ClippingAnalyticsFilters = {
  locations: [],
  stages: [],
};

export function useClippingAnalyticsFilters() {
  const raw = useDashboardFilters(
    (s) => s.filters["clipping-analytics"]
  ) as ClippingAnalyticsFilters | undefined;
  const setFilters = useDashboardFilters((s) => s.setFilters);
  return {
    filters: raw ?? defaultClippingAnalyticsFilters,
    setFilters: (f: ClippingAnalyticsFilters) => setFilters("clipping-analytics", f),
    clearFilters: () =>
      useDashboardFilters.getState().clearFilters("clipping-analytics"),
  };
}
