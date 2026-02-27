"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { MANUFACTURERS } from "@/lib/catalog-fields";

interface BrandDropdownProps {
  value: string;
  onChange: (brand: string) => void;
}

export default function BrandDropdown({ value, onChange }: BrandDropdownProps) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [customMode, setCustomMode] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Sync external value changes into query
  useEffect(() => {
    setQuery(value);
  }, [value]);

  // Click-outside detection
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        // Reset query to the committed value when closing without selection
        if (!customMode) setQuery(value);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [value, customMode]);

  const filtered = MANUFACTURERS.filter((m) =>
    m.toLowerCase().includes(query.toLowerCase()),
  );

  // "Add new manufacturer" is appended as an extra entry
  const totalItems = filtered.length + 1;

  const scrollToIndex = useCallback(
    (index: number) => {
      if (!listRef.current) return;
      const items = listRef.current.children;
      // index maps to filtered items 0..filtered.length-1, then the add-new item
      if (index >= 0 && index < items.length) {
        items[index].scrollIntoView({ block: "nearest" });
      }
    },
    [],
  );

  function selectBrand(brand: string) {
    setQuery(brand);
    onChange(brand);
    setOpen(false);
    setCustomMode(false);
    setHighlightedIndex(-1);
  }

  function enterCustomMode() {
    setCustomMode(true);
    setQuery("");
    setOpen(false);
    // Focus the input so the user can type
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open && !customMode) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        setOpen(true);
        setHighlightedIndex(0);
        e.preventDefault();
        return;
      }
    }

    if (open) {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setHighlightedIndex((prev) => {
            const next = prev < totalItems - 1 ? prev + 1 : 0;
            scrollToIndex(next);
            return next;
          });
          break;
        case "ArrowUp":
          e.preventDefault();
          setHighlightedIndex((prev) => {
            const next = prev > 0 ? prev - 1 : totalItems - 1;
            scrollToIndex(next);
            return next;
          });
          break;
        case "Enter":
          e.preventDefault();
          if (highlightedIndex >= 0 && highlightedIndex < filtered.length) {
            selectBrand(filtered[highlightedIndex]);
          } else if (highlightedIndex === filtered.length) {
            enterCustomMode();
          }
          break;
        case "Escape":
          e.preventDefault();
          setOpen(false);
          setQuery(value);
          setHighlightedIndex(-1);
          break;
      }
    } else if (customMode && e.key === "Enter") {
      // Commit custom value
      e.preventDefault();
      if (query.trim()) {
        onChange(query.trim());
        setCustomMode(false);
      }
    } else if (customMode && e.key === "Escape") {
      e.preventDefault();
      setCustomMode(false);
      setQuery(value);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        value={query}
        placeholder={customMode ? "Type custom manufacturer..." : "Search manufacturer..."}
        className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
        onFocus={() => {
          if (!customMode) setOpen(true);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          if (!customMode) {
            setOpen(true);
            setHighlightedIndex(-1);
          }
        }}
        onKeyDown={handleKeyDown}
      />

      {open && !customMode && (
        <ul
          ref={listRef}
          role="listbox"
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-t-border bg-surface-elevated shadow-card-lg"
        >
          {filtered.map((m, i) => (
            <li
              key={m}
              role="option"
              aria-selected={m === value}
              className={`px-3 py-2 text-sm cursor-pointer ${
                i === highlightedIndex ? "bg-surface-2" : "hover:bg-surface-2"
              }`}
              onMouseEnter={() => setHighlightedIndex(i)}
              onMouseDown={(e) => {
                e.preventDefault(); // prevent blur
                selectBrand(m);
              }}
            >
              {m}
            </li>
          ))}

          {/* Add new manufacturer option */}
          <li
            role="option"
            aria-selected={false}
            className={`px-3 py-2 text-sm cursor-pointer border-t border-t-border text-muted ${
              highlightedIndex === filtered.length
                ? "bg-surface-2"
                : "hover:bg-surface-2"
            }`}
            onMouseEnter={() => setHighlightedIndex(filtered.length)}
            onMouseDown={(e) => {
              e.preventDefault();
              enterCustomMode();
            }}
          >
            + Add new manufacturer
          </li>
        </ul>
      )}
    </div>
  );
}
