"use client";

import { memo } from "react";

interface LiveIndicatorProps {
  /** Label text (default: "Live") */
  label?: string;
  /** Whether connection is active */
  connected?: boolean;
  /** Whether attempting to reconnect */
  reconnecting?: boolean;
}

export const LiveIndicator = memo(function LiveIndicator({
  label = "Live",
  connected = true,
  reconnecting = false,
}: LiveIndicatorProps) {
  if (reconnecting) {
    return (
      <div className="inline-flex items-center px-3 py-1 bg-yellow-900/50 text-yellow-400 rounded-full text-sm border border-yellow-500/20">
        <span className="w-2 h-2 bg-yellow-500 rounded-full mr-2 animate-pulse" />
        Reconnecting...
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="inline-flex items-center px-3 py-1 bg-zinc-800 text-zinc-400 rounded-full text-sm border border-zinc-700">
        <span className="w-2 h-2 bg-zinc-500 rounded-full mr-2" />
        Offline
      </div>
    );
  }

  return (
    <div className="inline-flex items-center px-3 py-1 bg-green-900/50 text-green-400 rounded-full text-sm border border-green-500/20">
      <span className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse" />
      {label}
    </div>
  );
});
