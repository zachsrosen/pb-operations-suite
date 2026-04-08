"use client";

import ProgressRing from "./ProgressRing";

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
  return (
    <ProgressRing
      current={current}
      goal={goal}
      label={label}
      accentColor={accentColor}
      size={130}
      strokeWidth={8}
    />
  );
}
