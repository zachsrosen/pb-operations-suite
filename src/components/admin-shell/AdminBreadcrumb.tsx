// src/components/admin-shell/AdminBreadcrumb.tsx

export interface AdminBreadcrumbProps {
  segments: string[];
}

export function AdminBreadcrumb({ segments }: AdminBreadcrumbProps) {
  if (segments.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-muted">
      {segments.map((seg, i) => (
        <span key={`${i}-${seg}`} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-muted/50">/</span>}
          <span className={i === segments.length - 1 ? "text-foreground/80" : undefined}>
            {seg}
          </span>
        </span>
      ))}
    </nav>
  );
}
