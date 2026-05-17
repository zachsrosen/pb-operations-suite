'use client';

import { useState, useCallback } from 'react';
import DashboardShell from '@/components/DashboardShell';
import { useSSE } from '@/hooks/useSSE';
import { useShopHealthData } from '@/hooks/useShopHealthData';
import { getWeekStart, formatWeekParam } from '@/lib/shop-health-utils';
import { DASHBOARD_LOCATION_GROUPS } from '@/lib/dashboard-location-groups';

import { WeekSelector } from './WeekSelector';
import { HeroMetrics } from './HeroMetrics';
import { SectionCard } from './SectionCard';
import { PipelineSectionContent } from './PipelineSection';
import { PreconSectionContent } from './PreconSection';
import { SchedulingSectionContent } from './SchedulingSection';
import { OperationsSectionContent } from './OperationsSection';
import { InspectionsSectionContent } from './InspectionsSection';
import { BottleneckSectionContent } from './BottleneckSection';
import { AllLocationsView } from './AllLocationsView';

type TabValue = 'all' | string; // slug or 'all'

const LOCATION_TABS = [
  ...DASHBOARD_LOCATION_GROUPS.map((g) => ({ slug: g.slug, label: g.label })),
  { slug: 'all' as const, label: 'All' },
];

function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Hero skeleton */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="bg-surface rounded-xl border border-border p-4 min-h-[120px]">
            <div className="h-4 w-20 bg-surface-2 rounded mx-auto mb-3" />
            <div className="h-8 w-16 bg-surface-2 rounded mx-auto" />
          </div>
        ))}
      </div>
      {/* Section skeletons */}
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="bg-surface rounded-xl border border-border shadow-card p-6">
          <div className="h-6 w-40 bg-surface-2 rounded mb-4" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((j) => (
              <div key={j} className="h-24 bg-surface-2 rounded-xl" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="bg-surface rounded-xl border border-red-500/30 shadow-card p-8 text-center">
      <div className="text-red-400 text-lg font-semibold mb-2">
        Failed to load shop health data
      </div>
      <div className="text-muted text-sm">{message}</div>
    </div>
  );
}

export default function ShopHealthDashboard() {
  const [weekStart, setWeekStart] = useState<Date>(() => getWeekStart(new Date()));
  const [activeTab, setActiveTab] = useState<TabValue>(DASHBOARD_LOCATION_GROUPS[0].slug);

  const weekParam = formatWeekParam(weekStart);
  const isAllView = activeTab === 'all';

  // Fetch data for single-location view
  const {
    data,
    isLoading,
    error,
    refetch,
  } = useShopHealthData(
    isAllView ? '' : activeTab,
    isAllView ? '' : weekParam
  );

  // SSE for real-time updates
  const onSSEUpdate = useCallback(() => {
    if (!isAllView) refetch();
  }, [isAllView, refetch]);

  useSSE(onSSEUpdate, {
    cacheKeyFilter: 'shop-health',
  });

  const handleWeekChange = useCallback((newWeekStart: Date) => {
    setWeekStart(newWeekStart);
  }, []);

  return (
    <DashboardShell
      title="Weekly Shop Health"
      accentColor="orange"
      lastUpdated={data?.lastUpdated}
      fullWidth
    >
      {/* Controls: Location tabs + Week selector */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        {/* Location tab bar */}
        <div className="flex items-center gap-1 bg-surface-2 rounded-lg p-1">
          {LOCATION_TABS.map((tab) => (
            <button
              key={tab.slug}
              onClick={() => setActiveTab(tab.slug)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                activeTab === tab.slug
                  ? 'bg-surface text-foreground shadow-sm'
                  : 'text-muted hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Week selector */}
        <WeekSelector weekStart={weekStart} onChange={handleWeekChange} />
      </div>

      {/* All locations comparison view */}
      {isAllView && <AllLocationsView weekStart={weekParam} />}

      {/* Single location detail view */}
      {!isAllView && isLoading && <LoadingSkeleton />}

      {!isAllView && error && (
        <ErrorState message={error instanceof Error ? error.message : 'Unknown error'} />
      )}

      {!isAllView && data && (
        <div className="space-y-6">
          {/* Hero metrics */}
          <HeroMetrics heroes={data.heroes} />

          {/* Pipeline */}
          <SectionCard title="Pipeline">
            <PipelineSectionContent data={data.pipeline} />
          </SectionCard>

          {/* Preconstruction */}
          <SectionCard title="Preconstruction">
            <PreconSectionContent data={data.preconstruction} />
          </SectionCard>

          {/* Scheduling */}
          <SectionCard title="Scheduling">
            <SchedulingSectionContent data={data.scheduling} />
          </SectionCard>

          {/* Operations */}
          <SectionCard title="Operations">
            <OperationsSectionContent data={data.operations} />
          </SectionCard>

          {/* Inspections */}
          <SectionCard title="Inspections">
            <InspectionsSectionContent data={data.inspections} />
          </SectionCard>

          {/* Bottleneck */}
          <SectionCard title="Bottleneck of the Week" defaultOpen={true}>
            <BottleneckSectionContent
              key={`${activeTab}-${weekParam}`}
              location={activeTab}
              weekStart={weekParam}
              bottleneck={data.bottleneck}
            />
          </SectionCard>
        </div>
      )}
    </DashboardShell>
  );
}
