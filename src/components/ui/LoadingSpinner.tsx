"use client";

import { memo } from "react";

interface LoadingSpinnerProps {
  /** Accent color for the spinner border */
  color?: string;
  /** Text to display below the spinner */
  message?: string;
  /** Size variant */
  size?: "sm" | "md" | "lg";
}

const sizeClasses = {
  sm: "h-6 w-6",
  md: "h-12 w-12",
  lg: "h-16 w-16",
};

const colorClasses: Record<string, string> = {
  orange: "border-orange-500",
  blue: "border-blue-500",
  red: "border-red-500",
  green: "border-green-500",
  emerald: "border-emerald-500",
  purple: "border-purple-500",
  cyan: "border-cyan-500",
  white: "border-white",
};

export const LoadingSpinner = memo(function LoadingSpinner({
  color = "orange",
  message,
  size = "md",
}: LoadingSpinnerProps) {
  return (
    <div className="flex items-center justify-center py-32">
      <div className="text-center">
        <div
          className={`animate-spin rounded-full ${sizeClasses[size]} border-b-2 ${colorClasses[color] || colorClasses.orange} mx-auto mb-4`}
        />
        {message && <p className="text-zinc-400">{message}</p>}
      </div>
    </div>
  );
});
