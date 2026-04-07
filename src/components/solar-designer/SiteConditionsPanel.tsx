'use client';

import { useState } from 'react';
import type { SiteConditions, LossProfile } from '@/lib/solar/v12-engine';
import type { SolarDesignerAction } from './types';

interface SiteConditionsPanelProps {
  siteConditions: SiteConditions;
  lossProfile: LossProfile;
  dispatch: (action: SolarDesignerAction) => void;
}

export default function SiteConditionsPanel({ siteConditions, lossProfile, dispatch }: SiteConditionsPanelProps) {
  const [expanded, setExpanded] = useState(true);

  const handleSiteChange = (field: keyof SiteConditions, value: number) => {
    dispatch({ type: 'SET_SITE_CONDITIONS', conditions: { [field]: value } });
  };

  const handleLossChange = (field: keyof LossProfile, value: number) => {
    dispatch({ type: 'SET_LOSS_PROFILE', profile: { [field]: value } });
  };

  return (
    <div className="rounded-xl bg-surface p-4 shadow-card space-y-3">
      <button onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full text-sm font-semibold text-foreground">
        <span>Site Conditions</span>
        <span className="text-xs text-muted">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="temp-min" className="block text-xs text-muted mb-1">Min Temp (°C)</label>
              <input id="temp-min" type="number" value={siteConditions.tempMin}
                onChange={(e) => handleSiteChange('tempMin', Number(e.target.value))}
                className="w-full rounded-lg border border-t-border bg-surface-2 px-2 py-1.5 text-sm text-foreground" />
            </div>
            <div>
              <label htmlFor="temp-max" className="block text-xs text-muted mb-1">Max Temp (°C)</label>
              <input id="temp-max" type="number" value={siteConditions.tempMax}
                onChange={(e) => handleSiteChange('tempMax', Number(e.target.value))}
                className="w-full rounded-lg border border-t-border bg-surface-2 px-2 py-1.5 text-sm text-foreground" />
            </div>
          </div>
          <div>
            <label htmlFor="albedo" className="block text-xs text-muted mb-1">Ground Albedo</label>
            <input id="albedo" type="number" step="0.05" min="0" max="1" value={siteConditions.groundAlbedo}
              onChange={(e) => handleSiteChange('groundAlbedo', Number(e.target.value))}
              className="w-full rounded-lg border border-t-border bg-surface-2 px-2 py-1.5 text-sm text-foreground" />
          </div>
          <div className="pt-2 border-t border-t-border">
            <p className="text-xs font-medium text-muted mb-2">Loss Profile (%)</p>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(lossProfile) as (keyof LossProfile)[]).map((key) => (
                <div key={key}>
                  <label htmlFor={`loss-${key}`} className="block text-xs text-muted mb-0.5 capitalize">
                    {key === 'dcWiring' ? 'DC Wiring' : key === 'acWiring' ? 'AC Wiring' : key === 'lid' ? 'LID' : key}
                  </label>
                  <input id={`loss-${key}`} type="number" step="0.5" min="0" max="100" value={lossProfile[key]}
                    onChange={(e) => handleLossChange(key, Number(e.target.value))}
                    className="w-full rounded-lg border border-t-border bg-surface-2 px-2 py-1.5 text-sm text-foreground" />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {!expanded && (
        <p className="text-xs text-muted">
          {siteConditions.tempMin}°C / {siteConditions.tempMax}°C, albedo {siteConditions.groundAlbedo}
        </p>
      )}
    </div>
  );
}
