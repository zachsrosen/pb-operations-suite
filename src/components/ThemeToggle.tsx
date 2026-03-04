"use client";

import { useTheme } from "@/contexts/ThemeContext";

function MoonIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
      />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 3v1m0 16v1m8-9h1M3 12h1m13.657 5.657l.707.707M5.636 5.636l.707.707m11.314 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
      />
    </svg>
  );
}

function SunsetIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 3v2m0 0a5 5 0 015 5H7a5 5 0 015-5zm-9 7h18M4 15h16M6 19h12"
      />
    </svg>
  );
}

const THEME_LABELS = {
  dark: "Dark mode",
  light: "Light mode",
  sunset: "Sunset mode",
} as const;

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className="p-1.5 rounded-lg border border-t-border hover:border-muted text-muted hover:text-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-1"
      title={THEME_LABELS[theme]}
      aria-label={THEME_LABELS[theme]}
      suppressHydrationWarning
    >
      {theme === "dark" && <MoonIcon />}
      {theme === "light" && <SunIcon />}
      {theme === "sunset" && <SunsetIcon />}
    </button>
  );
}
