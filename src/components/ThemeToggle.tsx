"use client";

import { useTheme } from "@/contexts/ThemeContext";

export function ThemeToggle() {
  const { toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className="p-1.5 rounded-lg border border-t-border hover:border-muted text-muted hover:text-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-1"
      title="Toggle theme"
      aria-label="Toggle theme"
      suppressHydrationWarning
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 3v1m0 16v1m8-9h1M3 12h1m13.657 5.657l.707.707M5.636 5.636l.707.707m11.314 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
        />
      </svg>
    </button>
  );
}
