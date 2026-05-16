"use client";

import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { queryKeys } from "@/lib/query-keys";

interface Resident {
  id: string;
  name: string | null;
  personalEmail: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  netWorth: string | null;
  incomeRange: string | null;
  isHomeowner: boolean | null;
}

export default function PropertyResidents({ propertyId }: { propertyId: string }) {
  const { data: session } = useSession();
  const userRoles = (session?.user as { roles?: string[] } | undefined)?.roles ?? [];
  const isAllowed = userRoles.some((r) => r === "ADMIN" || r === "OWNER");

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.propertyResidents.list(propertyId),
    queryFn: async () => {
      const res = await fetch(`/api/properties/${propertyId}/residents`);
      if (!res.ok) return { residents: [] };
      return res.json() as Promise<{ residents: Resident[] }>;
    },
    enabled: isAllowed,
    staleTime: 5 * 60 * 1000,
  });

  if (!isAllowed) return null;

  const residents = data?.residents ?? [];
  if (isLoading) {
    return (
      <section>
        <h4 className="text-sm font-semibold text-foreground mb-2">Residents</h4>
        <div className="animate-pulse h-8 bg-surface-2 rounded" />
      </section>
    );
  }

  if (residents.length === 0) return null;

  return (
    <section>
      <h4 className="text-sm font-semibold text-foreground mb-2">
        Residents{" "}
        <span className="text-muted font-normal">({residents.length})</span>
      </h4>
      <div className="space-y-2">
        {residents.map((r) => (
          <div key={r.id} className="p-2.5 rounded-lg border border-t-border bg-surface text-xs">
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">{r.name ?? "Unknown"}</span>
              {r.isHomeowner && (
                <span className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 px-1.5 py-0.5 rounded-full text-[10px] font-medium">
                  Homeowner
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1 text-muted flex-wrap">
              {r.personalEmail && <span>{r.personalEmail}</span>}
              {r.phone && <span>{r.phone}</span>}
              {r.linkedinUrl && (
                <a href={r.linkedinUrl} target="_blank" rel="noopener noreferrer" className="hover:text-foreground">
                  LinkedIn {"↗"}
                </a>
              )}
            </div>
            {(r.netWorth || r.incomeRange) && (
              <div className="flex items-center gap-3 mt-1 text-muted">
                {r.netWorth && <span>Net worth: {r.netWorth}</span>}
                {r.incomeRange && <span>Income: {r.incomeRange}</span>}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
