'use client';

import type { SolarDesignerTab } from './types';
import { TAB_LABELS } from './types';

const TAB_ORDER: SolarDesignerTab[] = [
  'visualizer', 'stringing', 'production', 'timeseries',
  'inverters', 'battery', 'ai', 'scenarios',
];

interface TabBarProps {
  activeTab: SolarDesignerTab;
  onTabChange: (tab: SolarDesignerTab) => void;
  /** Tabs that have real content (not placeholder). Affects styling. */
  enabledTabs?: SolarDesignerTab[];
}

export default function TabBar({ activeTab, onTabChange, enabledTabs }: TabBarProps) {
  return (
    <div className="flex items-center gap-1 border-b border-t-border overflow-x-auto">
      {TAB_ORDER.map((tab) => {
        const isActive = tab === activeTab;
        const isEnabled = !enabledTabs || enabledTabs.includes(tab);
        return (
          <button
            key={tab}
            onClick={() => onTabChange(tab)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
              isActive
                ? 'border-orange-500 text-orange-500'
                : isEnabled
                  ? 'border-transparent text-muted hover:text-foreground'
                  : 'border-transparent text-muted/50 hover:text-muted'
            }`}
          >
            {TAB_LABELS[tab]}
          </button>
        );
      })}
    </div>
  );
}
