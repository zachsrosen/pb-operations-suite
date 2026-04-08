"use client";

import { useEffect, useState } from "react";
import CountUp from "./CountUp";

interface AnimatedBarProps {
  count: number;
  maxCount: number;
  label: string;
  color: string;
  delay?: number;
}

export default function AnimatedBar({
  count,
  maxCount,
  label,
  color,
  delay = 0,
}: AnimatedBarProps) {
  const [width, setWidth] = useState(0);
  const targetWidth = maxCount > 0 ? Math.max((count / maxCount) * 100, 8) : 8;

  useEffect(() => {
    const timer = setTimeout(() => setWidth(targetWidth), delay + 50);
    return () => clearTimeout(timer);
  }, [targetWidth, delay]);

  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="text-xs text-slate-400 w-14 text-right font-medium shrink-0">
        {label}
      </span>
      <div className="flex-1 h-8 bg-white/5 rounded-md overflow-hidden relative">
        <div
          className="h-full rounded-md flex items-center px-3 transition-all duration-700 ease-out"
          style={{
            width: `${width}%`,
            backgroundColor: color,
          }}
        >
          {count > 0 && (
            <CountUp
              value={count}
              className="text-sm font-bold text-white"
              duration={600}
            />
          )}
        </div>
      </div>
    </div>
  );
}
