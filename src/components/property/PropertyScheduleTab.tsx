"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { Skeleton } from "@/components/ui/Skeleton";
import type { ScheduleTabData } from "@/lib/property-hub";

interface Props {
  propertyId: string;
}

function formatTime(time: string): string {
  const [hours, minutes] = time.split(":");
  const h = parseInt(hours, 10);
  const ampm = h >= 12 ? "PM" : "AM";
  const displayHour = h % 12 || 12;
  return `${displayHour}:${minutes} ${ampm}`;
}

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-");
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function isPast(dateStr: string): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [y, m, d] = dateStr.split("-").map(Number);
  const slotDate = new Date(y, m - 1, d);
  return slotDate < today;
}

export default function PropertyScheduleTab({ propertyId }: Props) {
  const { data, isLoading, error } = useQuery<ScheduleTabData>({
    queryKey: queryKeys.propertyHub.tab(propertyId, "schedule"),
    queryFn: async () => {
      const res = await fetch(
        `/api/properties/${propertyId}/hub?tab=schedule`,
      );
      if (!res.ok) throw new Error("Failed to load schedule");
      return res.json();
    },
    staleTime: 60_000,
  });

  if (error) {
    return (
      <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-6 text-red-400">
        Failed to load schedule.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl bg-surface border border-t-border p-4 space-y-2">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        ))}
      </div>
    );
  }

  const slots = data?.slots ?? [];

  if (slots.length === 0) {
    return (
      <div className="text-center py-12 text-muted">
        <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <p className="text-sm">No scheduled slots for this property</p>
      </div>
    );
  }

  // Split into upcoming and past
  const upcoming = slots.filter((s) => !isPast(s.date));
  const past = slots.filter((s) => isPast(s.date));

  return (
    <div className="space-y-6">
      {/* Upcoming */}
      {upcoming.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-foreground mb-3">
            Upcoming ({upcoming.length})
          </h3>
          <div className="space-y-2">
            {upcoming.map((slot) => (
              <SlotCard key={slot.id} slot={slot} />
            ))}
          </div>
        </div>
      )}

      {/* Past */}
      {past.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-muted mb-3">
            Past ({past.length})
          </h3>
          <div className="space-y-2 opacity-60">
            {past.map((slot) => (
              <SlotCard key={slot.id} slot={slot} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SlotCard({
  slot,
}: {
  slot: ScheduleTabData["slots"][number];
}) {
  return (
    <div className="rounded-xl bg-surface border border-t-border p-4 hover:border-blue-500/20 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            {formatDate(slot.date)}
          </p>
          <p className="text-xs text-muted mt-0.5">
            {formatTime(slot.startTime)} &ndash; {formatTime(slot.endTime)}
          </p>
        </div>
        <span className="text-xs text-muted shrink-0">
          {slot.location}
        </span>
      </div>

      <div className="flex items-center gap-4 mt-2 text-xs text-muted">
        <span>Crew: {slot.userName}</span>
        <span className="truncate">Project: {slot.projectName}</span>
        <span className="capitalize">{slot.source}</span>
      </div>
    </div>
  );
}
