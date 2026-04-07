"use client";

import { useEffect, useRef, useState } from "react";

interface GoalProgressProps {
  current: number;
  goal: number;
  label: string;
  accentColor: string;
}

export default function GoalProgress({
  current,
  goal,
  label,
  accentColor,
}: GoalProgressProps) {
  const percentage = goal > 0 ? Math.min((current / goal) * 100, 100) : 0;
  const isGoalHit = current >= goal && goal > 0;
  const [showCelebration, setShowCelebration] = useState(false);
  const hasCelebrated = useRef(false);

  useEffect(() => {
    if (isGoalHit && !hasCelebrated.current) {
      hasCelebrated.current = true;
      // Use rAF to avoid synchronous setState in effect body
      const raf = requestAnimationFrame(() => setShowCelebration(true));
      const timer = setTimeout(() => setShowCelebration(false), 2000);
      return () => {
        cancelAnimationFrame(raf);
        clearTimeout(timer);
      };
    }
  }, [isGoalHit]);

  return (
    <div className="text-center">
      <div
        className="text-[42px] font-extrabold transition-colors"
        style={{ color: isGoalHit ? "#22c55e" : accentColor }}
        key={String(current)}
      >
        {current}
      </div>
      <div className="text-xs text-slate-400 mt-1">{label}</div>
      {goal > 0 && (
        <>
          <div className="text-xs text-slate-500 mt-1">Goal: {goal}</div>
          <div className="h-1 bg-white/10 rounded-full mt-2 mx-4 relative overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${percentage}%`,
                backgroundColor: isGoalHit ? "#22c55e" : accentColor,
              }}
            />
            {showCelebration && (
              <div className="absolute inset-0 bg-yellow-400/30 animate-pulse rounded-full" />
            )}
          </div>
        </>
      )}
    </div>
  );
}
