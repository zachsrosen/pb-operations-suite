"use client";

import { useState, useRef, useEffect } from "react";
import { useSession, signOut } from "next-auth/react";
import Link from "next/link";

export function UserMenu() {
  const { data: session } = useSession();
  const [isOpen, setIsOpen] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Fetch user role from DB
  useEffect(() => {
    if (session?.user?.email) {
      fetch("/api/auth/sync")
        .then(res => res.json())
        .then(data => {
          if (data.role) {
            setUserRole(data.role);
          }
        })
        .catch(() => {});
    }
  }, [session]);

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!session?.user) {
    return (
      <Link
        href="/login"
        className="text-xs text-muted border border-t-border rounded-lg px-3 py-1.5 hover:border-muted hover:text-foreground/80 transition-colors"
      >
        Sign In
      </Link>
    );
  }

  const initials = session.user.name
    ?.split(" ")
    .map(n => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "?";

  const isAdmin = userRole === "ADMIN";
  const isOwner = userRole === "OWNER";
  const isAdminOrOwner = isAdmin || isOwner;
  const roleLabel =
    userRole === "OWNER" ? "EXECUTIVE" :
    userRole === "VIEWER" ? "UNASSIGNED" :
    userRole;

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 text-xs text-muted border border-t-border rounded-lg px-2 py-1.5 hover:border-muted hover:text-foreground/80 transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-1"
        aria-label="User menu"
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center text-white text-[10px] font-medium">
          {initials}
        </div>
        <span className="hidden sm:inline max-w-[100px] truncate">
          {session.user.name?.split(" ")[0] || session.user.email?.split("@")[0]}
        </span>
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-56 bg-surface-elevated border border-t-border rounded-lg shadow-card-lg z-50 overflow-hidden" role="menu" aria-label="User actions">
          <div className="p-3 border-b border-t-border">
            <p className="text-sm font-medium text-foreground truncate">{session.user.name}</p>
            <p className="text-xs text-muted truncate">{session.user.email}</p>
            {userRole && (
              <span className={`inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded ${
                userRole === "ADMIN" ? "bg-red-500/20 text-red-400" :
                userRole === "OWNER" ? "bg-amber-500/20 text-amber-400" :
                userRole === "SALES" ? "bg-cyan-500/20 text-cyan-400" :
                "bg-zinc-500/20 text-muted"
              }`}>
                {roleLabel}
              </span>
            )}
          </div>

          <div className="py-1">
            {isAdminOrOwner && (
              <Link
                href="/suites/admin"
                onClick={() => setIsOpen(false)}
                className="flex items-center gap-2 px-3 py-2 text-sm text-foreground/80 hover:bg-surface-2 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Admin Suite
              </Link>
            )}
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm text-foreground/80 hover:bg-surface-2 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
