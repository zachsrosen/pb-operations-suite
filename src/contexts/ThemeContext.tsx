"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";

type Theme = "dark" | "light";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  toggleTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

/* ------------------------------------------------------------------ */
/*  Runtime light-theme overrides.                                     */
/*  Tailwind v4's PostCSS strips attribute selectors like              */
/*  [class*="bg-zinc-900"] from globals.css, so we inject them at      */
/*  runtime where PostCSS can't touch them.                            */
/* ------------------------------------------------------------------ */
const LIGHT_STYLE_ID = "pb-light-overrides";

const LIGHT_CSS = `
/* ---- backgrounds ---- */
html.light .dashboard-bg [class*="bg-[#0a0a0"] { background-color: #f8fafc !important; }
html.light .dashboard-bg [class*="bg-[#12121"] { background-color: #ffffff !important; }
html.light .dashboard-bg [class*="bg-[#1a1a2"] { background-color: #ffffff !important; }
html.light .dashboard-bg [class*="bg-zinc-900"] { background-color: #f4f4f5 !important; }
html.light .dashboard-bg [class*="bg-zinc-800"] { background-color: #e4e4e7 !important; }
html.light [class*="bg-[#0a0a0"] { background-color: #f8fafc !important; }
html.light [class*="bg-[#12121"] { background-color: #ffffff !important; }
html.light [class*="bg-[#1a1a2"] { background-color: #ffffff !important; }

/* gradients */
html.light .dashboard-bg [class*="from-[#12121"] { --tw-gradient-from: #f4f4f5 !important; background-image: none !important; background-color: #f4f4f5 !important; }
html.light .dashboard-bg [class*="from-[#0a0a0"] { --tw-gradient-from: #f8fafc !important; background-image: none !important; background-color: #f8fafc !important; }
html.light .dashboard-bg [class*="from-[#1a1a2"] { --tw-gradient-from: #ffffff !important; background-image: none !important; background-color: #ffffff !important; }

/* fractional opacity dark backgrounds */
html.light .dashboard-bg [class*="bg-zinc-900/"] { background-color: rgba(244,244,245,0.5) !important; }
html.light .dashboard-bg [class*="bg-zinc-800/"] { background-color: rgba(228,228,231,0.5) !important; }
html.light .dashboard-bg [class*="bg-black/"] { background-color: rgba(0,0,0,0.05) !important; }

/* ---- borders ---- */
html.light .dashboard-bg [class*="border-zinc-800"] { border-color: #e4e4e7 !important; }
html.light .dashboard-bg [class*="border-zinc-700"] { border-color: #d4d4d8 !important; }
html.light .dashboard-bg [class*="border-zinc-600"] { border-color: #d4d4d8 !important; }
html.light [class*="border-zinc-800"] { border-color: #e4e4e7 !important; }
html.light [class*="border-zinc-700"] { border-color: #d4d4d8 !important; }

/* ---- text ---- */
html.light .dashboard-bg [class*="text-white"] { color: #18181b !important; }
html.light .dashboard-bg [class*="text-zinc-100"] { color: #18181b !important; }
html.light .dashboard-bg [class*="text-zinc-200"] { color: #27272a !important; }
html.light .dashboard-bg [class*="text-zinc-300"] { color: #3f3f46 !important; }
html.light .dashboard-bg [class*="text-zinc-400"] { color: #52525b !important; }
html.light .dashboard-bg [class*="text-zinc-500"] { color: #71717a !important; }

/* ---- form inputs ---- */
html.light .dashboard-bg input,
html.light .dashboard-bg select,
html.light .dashboard-bg textarea { background-color: #ffffff !important; border-color: #d4d4d8 !important; color: #18181b !important; }

/* ---- hover states ---- */
html.light .dashboard-bg [class*="hover:bg-zinc-800"]:hover { background-color: #e4e4e7 !important; }
html.light .dashboard-bg [class*="hover:bg-zinc-700"]:hover { background-color: #d4d4d8 !important; }
html.light .dashboard-bg [class*="hover:bg-[#1a1a2"]:hover { background-color: #f4f4f5 !important; }

/* ---- modals & overlays ---- */
html.light [class*="bg-black/80"] { background-color: rgba(0,0,0,0.4) !important; }
html.light [class*="bg-black/50"] { background-color: rgba(0,0,0,0.3) !important; }

/* ---- ring/outline ---- */
html.light .dashboard-bg [class*="ring-zinc"] { --tw-ring-color: #d4d4d8 !important; }

/* ---- divide ---- */
html.light .dashboard-bg [class*="divide-zinc"] > * + * { border-color: #e4e4e7 !important; }

/* ---- placeholder ---- */
html.light .dashboard-bg input::placeholder,
html.light .dashboard-bg textarea::placeholder { color: #a1a1aa !important; }
`;

function injectLightStyles() {
  if (document.getElementById(LIGHT_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = LIGHT_STYLE_ID;
  style.textContent = LIGHT_CSS;
  document.head.appendChild(style);
}

function removeLightStyles() {
  document.getElementById(LIGHT_STYLE_ID)?.remove();
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("dark");
  const [mounted, setMounted] = useState(false);

  // Read saved preference on mount
  useEffect(() => {
    const saved = localStorage.getItem("pb-theme") as Theme | null;
    if (saved === "light" || saved === "dark") {
      setTheme(saved);
    }
    setMounted(true);
  }, []);

  // Apply theme class to <html> and inject/remove runtime styles
  useEffect(() => {
    if (!mounted) return;
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);
    localStorage.setItem("pb-theme", theme);

    if (theme === "light") {
      injectLightStyles();
    } else {
      removeLightStyles();
    }

    // Update theme-color meta tag for mobile browsers
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute("content", theme === "dark" ? "#0a0a0f" : "#ffffff");
    }
  }, [theme, mounted]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
