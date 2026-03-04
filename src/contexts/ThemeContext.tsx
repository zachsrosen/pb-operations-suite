"use client";

import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";

type Theme = "dark" | "light" | "sunset";

const THEME_ORDER: Theme[] = ["dark", "light", "sunset"];

const THEME_COLORS: Record<Theme, string> = {
  dark: "#0a0a0f",
  light: "#fafaf8",
  sunset: "#fdf6e3",
};

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

/**
 * Read saved theme from localStorage at initialization time.
 * This avoids calling setState in useEffect (which triggers cascading renders).
 * Note: This runs only on the client because the component is "use client".
 */
function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  try {
    const saved = localStorage.getItem("pb-theme");
    if (saved === "light" || saved === "dark" || saved === "sunset") return saved;
  } catch {
    // localStorage may be unavailable
  }
  return "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const mountedRef = useRef(false);

  // On mount, sync DOM class with state.
  // The inline <head> script already handled the initial paint.
  useEffect(() => {
    document.documentElement.classList.remove("light", "dark", "sunset");
    document.documentElement.classList.add(theme);
    mountedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply theme class to <html> on toggle
  useEffect(() => {
    if (!mountedRef.current) return;
    const root = document.documentElement;
    root.classList.remove("light", "dark", "sunset");
    root.classList.add(theme);
    localStorage.setItem("pb-theme", theme);

    // Update theme-color meta tag for mobile browsers
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute("content", THEME_COLORS[theme]);
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => {
      const idx = THEME_ORDER.indexOf(prev);
      return THEME_ORDER[(idx + 1) % THEME_ORDER.length];
    });
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
