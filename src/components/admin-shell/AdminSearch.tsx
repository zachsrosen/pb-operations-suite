"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface SearchUser {
  id: string;
  email: string;
  name: string | null;
}
interface SearchRole {
  role: string;
  label: string;
}
interface SearchActivity {
  id: string;
  type: string;
  description: string;
  userEmail: string | null;
  createdAt: string;
}
interface SearchTicket {
  id: string;
  title: string;
  status: string;
  createdAt: string;
}
interface SearchResponse {
  users: SearchUser[];
  roles: SearchRole[];
  activity: SearchActivity[];
  tickets: SearchTicket[];
}

interface Flattened {
  key: string;
  label: string;
  detail: string;
  href: string;
  group: "Users" | "Roles" | "Activity" | "Tickets";
}

const DEBOUNCE_MS = 200;
const EMPTY_GRACE_MS = 300;

function flatten(r: SearchResponse): Flattened[] {
  const out: Flattened[] = [];
  for (const u of r.users) {
    out.push({
      key: `u-${u.id}`,
      label: u.name || u.email,
      detail: u.email,
      href: `/admin/users?userId=${encodeURIComponent(u.id)}`,
      group: "Users",
    });
  }
  for (const role of r.roles) {
    out.push({
      key: `r-${role.role}`,
      label: role.label,
      detail: role.role,
      href: `/admin/roles?role=${encodeURIComponent(role.role)}`,
      group: "Roles",
    });
  }
  for (const a of r.activity) {
    out.push({
      key: `a-${a.id}`,
      label: a.description,
      detail: `${a.userEmail ?? "system"} · ${a.type}`,
      href: `/admin/activity?type=${encodeURIComponent(a.type)}`,
      group: "Activity",
    });
  }
  for (const t of r.tickets) {
    out.push({
      key: `t-${t.id}`,
      label: t.title,
      detail: t.status,
      href: `/admin/tickets?ticketId=${encodeURIComponent(t.id)}`,
      group: "Tickets",
    });
  }
  return out;
}

/**
 * In-shell admin search. Lives in the AdminShell header. Queries
 * /api/admin/search with debounce + keyboard nav + aria combobox/listbox.
 * On Enter / click, navigates to the appropriate admin URL.
 */
export function AdminSearch() {
  const router = useRouter();
  const listboxId = useId();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Flattened[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showEmpty, setShowEmpty] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounced fetch
  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      setError(null);
      setShowEmpty(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/search?q=${encodeURIComponent(q)}`, {
          credentials: "same-origin",
        });
        if (cancelled) return;
        if (!res.ok) throw new Error(`Search failed (${res.status})`);
        const data = (await res.json()) as SearchResponse;
        if (cancelled) return;
        const flat = flatten(data);
        setResults(flat);
        setError(null);
        setActiveIdx(0);
        if (flat.length === 0) {
          setTimeout(() => !cancelled && setShowEmpty(true), EMPTY_GRACE_MS);
        } else {
          setShowEmpty(false);
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Search failed");
        setResults([]);
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDown = (ev: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(ev.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const showList = open && q.trim().length > 0;

  function handleKeyDown(ev: React.KeyboardEvent<HTMLInputElement>) {
    if (!showList) {
      if (ev.key === "ArrowDown" && results.length > 0) {
        setOpen(true);
      }
      return;
    }
    if (ev.key === "Escape") {
      ev.preventDefault();
      setOpen(false);
      return;
    }
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, results.length - 1));
      return;
    }
    if (ev.key === "ArrowUp") {
      ev.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
      return;
    }
    if (ev.key === "Enter") {
      ev.preventDefault();
      const pick = results[activeIdx];
      if (pick) {
        setOpen(false);
        setQ("");
        router.push(pick.href);
      }
    }
  }

  const activeId = showList && results[activeIdx] ? `${listboxId}-${results[activeIdx].key}` : undefined;

  return (
    <div ref={containerRef} className="relative w-64 shrink-0">
      <input
        type="search"
        role="combobox"
        aria-expanded={showList}
        aria-controls={showList ? listboxId : undefined}
        aria-activedescendant={activeId}
        aria-autocomplete="list"
        placeholder="Search users, roles, activity…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        className="h-8 w-full rounded-lg border border-t-border/60 bg-surface-2 px-3 text-xs text-foreground placeholder:text-muted focus:border-t-border focus:outline-none"
      />
      {showList && (
        <div className="absolute right-0 mt-1 w-96 rounded-lg border border-t-border/60 bg-surface-elevated shadow-xl">
          {error && (
            <p className="px-3 py-2 text-xs text-red-400">{error}</p>
          )}
          {!error && results.length === 0 && showEmpty && (
            <p className="px-3 py-2 text-xs text-muted">No results</p>
          )}
          {results.length > 0 && (
            <ul id={listboxId} role="listbox" className="max-h-80 overflow-y-auto py-1">
              {results.map((r, idx) => (
                <li
                  key={r.key}
                  id={`${listboxId}-${r.key}`}
                  role="option"
                  aria-selected={idx === activeIdx}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => {
                    setOpen(false);
                    setQ("");
                    router.push(r.href);
                  }}
                  className={`cursor-pointer px-3 py-2 text-xs ${
                    idx === activeIdx ? "bg-surface-2" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-foreground">{r.label}</span>
                    <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted">
                      {r.group}
                    </span>
                  </div>
                  <div className="truncate text-[11px] text-muted">{r.detail}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
