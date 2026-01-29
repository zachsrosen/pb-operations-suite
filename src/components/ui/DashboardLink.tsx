"use client";

import Link from "next/link";
import { getTagColorClasses, type DashboardConfig } from "@/lib/config";

export interface DashboardLinkProps {
  href: string;
  title: string;
  description: string;
  tag?: string;
  tagColor?: "orange" | "purple" | "blue" | "red" | "emerald" | "green" | "cyan";
}

export function DashboardLink({ href, title, description, tag, tagColor = "blue" }: DashboardLinkProps) {
  const tagClasses = getTagColorClasses(tagColor);

  return (
    <Link
      href={href}
      className="block bg-zinc-900/50 border border-zinc-800 rounded-xl p-5 hover:border-orange-500/50 hover:bg-zinc-900 transition-all group"
    >
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-semibold text-white group-hover:text-orange-400 transition-colors">
          {title}
        </h3>
        {tag && (
          <span className={`text-xs font-medium px-2 py-0.5 rounded border ${tagClasses}`}>
            {tag}
          </span>
        )}
      </div>
      <p className="text-sm text-zinc-500">{description}</p>
    </Link>
  );
}

export function DashboardLinkFromConfig({ config }: { config: DashboardConfig }) {
  return (
    <DashboardLink
      href={config.path}
      title={config.title}
      description={config.description}
      tag={config.tag}
      tagColor={config.tagColor}
    />
  );
}

export interface DashboardGridProps {
  children: React.ReactNode;
  title?: string;
}

export function DashboardGrid({ children, title }: DashboardGridProps) {
  return (
    <div className="mb-8">
      {title && (
        <h2 className="text-lg font-semibold text-zinc-300 mb-4">{title}</h2>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {children}
      </div>
    </div>
  );
}

export function ApiEndpointLink({ href, method, title, description }: {
  href: string;
  method: string;
  title: string;
  description: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="block bg-zinc-900/50 border border-zinc-800 rounded-xl p-5 hover:border-green-500/50 transition-all"
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-green-500 font-mono text-sm">{method}</span>
        <span className="font-semibold text-white">{title}</span>
      </div>
      <p className="text-sm text-zinc-500">{description}</p>
    </a>
  );
}
