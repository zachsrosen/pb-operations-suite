'use client';

import { useState, useCallback } from 'react';

interface ShadeSliderProps {
  onTimestepChange: (timestep: number) => void;
}

/** Map day-of-year (1–365) to a formatted date string like "Jun 21" */
function formatDayOfYear(day: number): string {
  const date = new Date(2025, 0, day);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Map half-hour slot (0–47) to formatted 12-hour time like "2:00 PM" */
function formatTimeSlot(slot: number): string {
  const hours = Math.floor(slot / 2);
  const minutes = (slot % 2) * 30;
  const date = new Date(2025, 0, 1, hours, minutes);
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

const DEFAULT_DAY = 172;     // June 21 (summer solstice)
const DEFAULT_TIME_SLOT = 28; // 2:00 PM

export default function ShadeSlider({ onTimestepChange }: ShadeSliderProps) {
  const [day, setDay] = useState(DEFAULT_DAY);
  const [timeSlot, setTimeSlot] = useState(DEFAULT_TIME_SLOT);

  const computeTimestep = useCallback((d: number, t: number) => {
    return (d - 1) * 48 + t;
  }, []);

  const handleDayChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const d = Number(e.target.value);
    setDay(d);
    onTimestepChange(computeTimestep(d, timeSlot));
  }, [timeSlot, onTimestepChange, computeTimestep]);

  const handleTimeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const t = Number(e.target.value);
    setTimeSlot(t);
    onTimestepChange(computeTimestep(day, t));
  }, [day, onTimestepChange, computeTimestep]);

  return (
    <div className="flex items-center gap-4 flex-wrap">
      <div className="flex items-center gap-2">
        <label htmlFor="shade-day-slider" className="text-xs font-semibold uppercase text-muted">
          Day
        </label>
        <input
          id="shade-day-slider"
          aria-label="Day"
          type="range"
          min={1}
          max={365}
          value={day}
          onChange={handleDayChange}
          className="w-40 accent-orange-500"
        />
        <span className="text-xs font-mono text-foreground min-w-[4rem]">
          {formatDayOfYear(day)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor="shade-time-slider" className="text-xs font-semibold uppercase text-muted">
          Time
        </label>
        <input
          id="shade-time-slider"
          aria-label="Time"
          type="range"
          min={0}
          max={47}
          value={timeSlot}
          onChange={handleTimeChange}
          className="w-32 accent-orange-500"
        />
        <span className="text-xs font-mono text-foreground min-w-[4rem]">
          {formatTimeSlot(timeSlot)}
        </span>
      </div>
    </div>
  );
}
