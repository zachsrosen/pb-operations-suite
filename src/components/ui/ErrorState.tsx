"use client";

import { memo } from "react";

interface ErrorStateProps {
  /** Error message to display */
  message: string;
  /** Retry callback */
  onRetry?: () => void;
  /** Button color */
  color?: string;
}

const buttonColors: Record<string, string> = {
  orange: "bg-orange-600 hover:bg-orange-700",
  blue: "bg-blue-600 hover:bg-blue-700",
  red: "bg-red-600 hover:bg-red-700",
  green: "bg-green-600 hover:bg-green-700",
  emerald: "bg-emerald-600 hover:bg-emerald-700",
  purple: "bg-purple-600 hover:bg-purple-700",
};

export const ErrorState = memo(function ErrorState({
  message,
  onRetry,
  color = "orange",
}: ErrorStateProps) {
  return (
    <div className="flex items-center justify-center py-32">
      <div className="text-center bg-[#12121a] rounded-xl p-8 border border-zinc-800 max-w-sm">
        <div className="text-red-500 text-4xl mb-4">!</div>
        <h2 className="text-xl font-bold text-white mb-2">
          Failed to Load Data
        </h2>
        <p className="text-zinc-400 mb-4">{message}</p>
        {onRetry && (
          <button
            onClick={onRetry}
            className={`px-4 py-2 ${buttonColors[color] || buttonColors.orange} text-white rounded-lg transition-colors`}
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
});
