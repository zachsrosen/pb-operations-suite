"use client";

import { useEffect, useState } from "react";
import CountUp from "./CountUp";

interface ProgressRingProps {
  current: number;
  goal: number;
  label: string;
  accentColor: string;
  size?: number;
  strokeWidth?: number;
}

export default function ProgressRing({
  current,
  goal,
  label,
  accentColor,
  size = 140,
  strokeWidth = 10,
}: ProgressRingProps) {
  const [animatedPct, setAnimatedPct] = useState(0);
  const percentage = goal > 0 ? Math.min((current / goal) * 100, 100) : 0;
  const isGoalHit = current >= goal && goal > 0;
  const displayColor = isGoalHit ? "#22c55e" : accentColor;

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  useEffect(() => {
    const timer = setTimeout(() => setAnimatedPct(percentage), 50);
    return () => clearTimeout(timer);
  }, [percentage]);

  const strokeDashoffset = circumference - (animatedPct / 100) * circumference;

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="transform -rotate-90">
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth={strokeWidth}
          />
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={displayColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            style={{ transition: "stroke-dashoffset 1s cubic-bezier(0.4,0,0.2,1), stroke 0.3s" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <CountUp
            value={current}
            className="text-3xl font-extrabold"
            style={{ color: displayColor }}
          />
          {goal > 0 && (
            <span className="text-[10px] text-slate-500">/ {goal}</span>
          )}
        </div>
      </div>
      <div className="text-xs text-slate-400 mt-2 text-center">{label}</div>
      {isGoalHit && (
        <div className="text-[10px] text-green-400 mt-0.5 animate-pulse">● Goal Hit!</div>
      )}
    </div>
  );
}
