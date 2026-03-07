"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useActivityTracking } from "@/hooks/useActivityTracking";

/**
 * Global click tracker — captures meaningful user interactions via event delegation.
 *
 * Tracks clicks on: buttons, links, inputs (submit), [role="button"], [data-track].
 * Extracts: element text, element type, closest section heading, current page path.
 * Debounces rapid clicks on the same element (300ms).
 * Sends as FEATURE_USED with rich metadata.
 *
 * Mount once in root layout — covers all pages automatically.
 */
export default function ClickTracker() {
  const pathname = usePathname();
  const { trackFeature } = useActivityTracking();
  const lastClickRef = useRef<{ key: string; time: number }>({ key: "", time: 0 });
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  useEffect(() => {
    function getClickTarget(e: MouseEvent): HTMLElement | null {
      const target = e.target as HTMLElement;
      if (!target?.closest) return null;

      // Walk up to find the nearest interactive element
      return (
        target.closest("button") ||
        target.closest("a") ||
        target.closest("[role='button']") ||
        target.closest("[data-track]") ||
        target.closest("input[type='submit']") ||
        target.closest("select") ||
        target.closest("summary") ||
        null
      );
    }

    function getElementLabel(el: HTMLElement): string {
      // Priority: data-track label > aria-label > text content > title > placeholder
      const dataTrack = el.getAttribute("data-track");
      if (dataTrack) return dataTrack;

      const ariaLabel = el.getAttribute("aria-label");
      if (ariaLabel) return ariaLabel;

      // Get visible text, truncated
      const text = (el.textContent || "").trim().replace(/\s+/g, " ");
      if (text && text.length <= 80) return text;
      if (text) return text.slice(0, 77) + "...";

      const title = el.getAttribute("title");
      if (title) return title;

      const placeholder = el.getAttribute("placeholder");
      if (placeholder) return placeholder;

      return el.tagName.toLowerCase();
    }

    function getElementType(el: HTMLElement): string {
      const tag = el.tagName.toLowerCase();
      if (tag === "a") return "link";
      if (tag === "button") {
        const type = el.getAttribute("type");
        return type === "submit" ? "submit-button" : "button";
      }
      if (tag === "input") return `input-${el.getAttribute("type") || "text"}`;
      if (tag === "select") return "select";
      if (tag === "summary") return "disclosure";
      if (el.getAttribute("role") === "button") return "role-button";
      if (el.hasAttribute("data-track")) return "tracked-element";
      return tag;
    }

    function getContext(el: HTMLElement): string | undefined {
      // Find the closest section/card/heading for context
      const section = el.closest("[data-section]");
      if (section) return section.getAttribute("data-section") || undefined;

      const heading = el.closest("section")?.querySelector("h1, h2, h3, h4");
      if (heading) {
        const text = (heading.textContent || "").trim();
        if (text.length <= 60) return text;
      }

      return undefined;
    }

    function handleClick(e: MouseEvent) {
      const el = getClickTarget(e);
      if (!el) return;

      // Skip internal navigation handled by PageViewTracker
      // and skip elements explicitly opted out
      if (el.hasAttribute("data-no-track")) return;

      const label = getElementLabel(el);
      const elementType = getElementType(el);

      // Dedup rapid clicks on the same element (300ms)
      const clickKey = `${elementType}:${label}`;
      const now = Date.now();
      if (clickKey === lastClickRef.current.key && now - lastClickRef.current.time < 300) {
        return;
      }
      lastClickRef.current = { key: clickKey, time: now };

      // Sanitize href: log only the pathname for same-origin links to avoid
      // leaking tokens, PII, or session data from query strings / fragments.
      let href: string | undefined;
      if (el instanceof HTMLAnchorElement) {
        try {
          const url = new URL(el.href, window.location.origin);
          href = url.origin === window.location.origin ? url.pathname : url.hostname;
        } catch {
          // Malformed href — skip it
        }
      }
      const context = getContext(el);

      trackFeature(`click:${elementType}`, label, {
        elementType,
        label,
        href,
        context,
        page: pathnameRef.current,
      });
    }

    document.addEventListener("click", handleClick, { capture: true, passive: true });
    return () => document.removeEventListener("click", handleClick, true);
  }, [trackFeature]);

  return null;
}
