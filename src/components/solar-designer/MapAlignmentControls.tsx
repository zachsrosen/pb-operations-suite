'use client';

import { useCallback } from 'react';
import type { MapAlignment } from './types';
import { DEFAULT_MAP_ALIGNMENT } from './types';

interface MapAlignmentControlsProps {
  alignment: MapAlignment;
  onChange: (partial: Partial<MapAlignment>) => void;
}

export default function MapAlignmentControls({ alignment, onChange }: MapAlignmentControlsProps) {
  const handleReset = useCallback(() => {
    onChange(DEFAULT_MAP_ALIGNMENT);
  }, [onChange]);

  return (
    <div className="flex items-center gap-4 flex-wrap text-xs">
      {/* Offset X/Y — spec calls for drag-to-reposition on the satellite image,
          but drag-on-SVG is complex. Stage 3 uses sliders as a simpler first pass.
          TODO: Replace with drag interaction in a future polish pass. */}
      <div className="flex items-center gap-2">
        <label htmlFor="map-offset-x" className="text-muted font-semibold uppercase">
          X
        </label>
        <input
          id="map-offset-x"
          aria-label="Offset X"
          type="range"
          min={-50}
          max={50}
          step={0.5}
          value={alignment.offsetX}
          onChange={(e) => onChange({ offsetX: Number(e.target.value) })}
          className="w-20 accent-orange-500"
        />
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor="map-offset-y" className="text-muted font-semibold uppercase">
          Y
        </label>
        <input
          id="map-offset-y"
          aria-label="Offset Y"
          type="range"
          min={-50}
          max={50}
          step={0.5}
          value={alignment.offsetY}
          onChange={(e) => onChange({ offsetY: Number(e.target.value) })}
          className="w-20 accent-orange-500"
        />
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor="map-rotation" className="text-muted font-semibold uppercase">
          Rotation
        </label>
        <input
          id="map-rotation"
          aria-label="Rotation"
          type="range"
          min={-180}
          max={180}
          step={1}
          value={alignment.rotation}
          onChange={(e) => onChange({ rotation: Number(e.target.value) })}
          className="w-24 accent-orange-500"
        />
        <span className="font-mono text-foreground min-w-[3rem]">
          {alignment.rotation}°
        </span>
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor="map-scale" className="text-muted font-semibold uppercase">
          Scale
        </label>
        <input
          id="map-scale"
          aria-label="Scale"
          type="range"
          min={0.5}
          max={3}
          step={0.1}
          value={alignment.scale}
          onChange={(e) => onChange({ scale: Number(e.target.value) })}
          className="w-24 accent-orange-500"
        />
        <span className="font-mono text-foreground min-w-[2rem]">
          {alignment.scale.toFixed(1)}x
        </span>
      </div>
      <button
        type="button"
        aria-label="Reset alignment"
        onClick={handleReset}
        className="px-2 py-1 rounded text-muted hover:text-foreground hover:bg-surface-2 transition-colors"
      >
        Reset
      </button>
    </div>
  );
}
