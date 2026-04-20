import type { ReactNode } from "react";

export interface KeyValueItem {
  label: string;
  value: ReactNode;
  mono?: boolean;
}
export interface AdminKeyValueGridProps {
  items: KeyValueItem[];
  columns?: 1 | 2;
}

export function AdminKeyValueGrid({ items, columns = 2 }: AdminKeyValueGridProps) {
  const gridClass = columns === 1 ? "grid-cols-1" : "grid-cols-[auto_1fr]";
  return (
    <dl className={`grid gap-x-4 gap-y-2 text-sm ${gridClass}`}>
      {items.map((item) => (
        <div key={item.label} className="contents">
          <dt className="text-xs font-medium uppercase tracking-wider text-muted">{item.label}</dt>
          <dd className="min-w-0 break-words text-foreground">
            {item.mono ? (
              <code className="rounded bg-surface-2 px-1 py-0.5 text-xs">{item.value}</code>
            ) : (
              item.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
