"use client";

import { useEffect, useState } from "react";

export default function MaintenancePage() {
  const [dots, setDots] = useState("");

  useEffect(() => {
    const interval = setInterval(() => {
      setDots((prev) => (prev.length >= 3 ? "" : prev + "."));
    }, 500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-4">
      <div className="text-center max-w-md">
        {/* Logo/Icon */}
        <div className="mb-8">
          <div className="w-20 h-20 mx-auto bg-gradient-to-br from-orange-500 to-orange-600 rounded-2xl flex items-center justify-center shadow-lg shadow-orange-500/20">
            <svg
              className="w-10 h-10 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </div>
        </div>

        {/* Title */}
        <h1 className="text-3xl font-bold text-white mb-4">
          Updates in Progress{dots}
        </h1>

        {/* Description */}
        <p className="text-zinc-400 mb-8 text-lg">
          We&apos;re deploying improvements to make your experience better.
          This usually takes less than a minute.
        </p>

        {/* Progress indicator */}
        <div className="mb-8">
          <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-orange-500 to-orange-400 rounded-full animate-pulse w-2/3" />
          </div>
        </div>

        {/* What's happening */}
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4 text-left">
          <h3 className="text-sm font-semibold text-zinc-300 mb-3">
            What&apos;s happening:
          </h3>
          <ul className="space-y-2 text-sm text-zinc-500">
            <li className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 bg-orange-500 rounded-full animate-pulse" />
              Deploying latest updates
            </li>
            <li className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 bg-orange-500 rounded-full animate-pulse" />
              Optimizing performance
            </li>
            <li className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 bg-orange-500 rounded-full animate-pulse" />
              Syncing data connections
            </li>
          </ul>
        </div>

        {/* Auto-refresh notice */}
        <p className="text-xs text-zinc-600 mt-6">
          This page will automatically refresh when updates are complete.
        </p>

        {/* Manual refresh button */}
        <button
          onClick={() => window.location.reload()}
          className="mt-4 px-4 py-2 text-sm text-zinc-400 hover:text-white transition-colors"
        >
          Refresh manually
        </button>
      </div>
    </div>
  );
}
