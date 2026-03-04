/**
 * Portal — Survey Self-Scheduling Page
 *
 * Customer-facing page where they select a date and time slot for their
 * site survey. Fetched via the public API using the token from the URL.
 */

"use client";

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

// ---------------------------------------------------------------------------
// Types (matches API response)
// ---------------------------------------------------------------------------

interface PortalSlot {
  slotId: string;
  time: string;
  displayTime: string;
}

interface PortalDay {
  date: string;
  dayLabel: string;
  slots: PortalSlot[];
}

interface PendingData {
  status: "pending";
  customerName: string;
  propertyAddress: string;
  pbLocation: string;
  availability: {
    days: PortalDay[];
    timezone: string;
    tzAbbrev: string;
  };
}

interface ScheduledData {
  status: "scheduled";
  customerName: string;
  propertyAddress: string;
  pbLocation: string;
  booking: {
    date: string;
    time: string;
    accessNotes: string | null;
    canModify: boolean;
  };
  availability?: {
    days: PortalDay[];
    timezone: string;
    tzAbbrev: string;
  };
}

type InviteData = PendingData | ScheduledData;

type PageState =
  | { type: "loading" }
  | { type: "error"; message: string }
  | { type: "expired" }
  | { type: "data"; data: InviteData };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SurveySchedulePage() {
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <SurveyScheduleInner />
    </Suspense>
  );
}

function SurveyScheduleInner() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isReschedule = searchParams.get("reschedule") === "1";

  const [state, setState] = useState<PageState>({ type: "loading" });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<PortalSlot | null>(null);
  const [accessNotes, setAccessNotes] = useState("");
  const [booking, setBooking] = useState(false);

  // Generate idempotency key once per mount
  const idempotencyKey = useRef(crypto.randomUUID());

  // Fetch invite data
  useEffect(() => {
    async function load() {
      try {
        const url = isReschedule
          ? `/api/portal/survey/${token}?reschedule=1`
          : `/api/portal/survey/${token}`;
        const res = await fetch(url);
        if (res.status === 404) {
          setState({ type: "error", message: "This link is not valid. Please check the URL from your email." });
          return;
        }
        if (res.status === 410) {
          setState({ type: "expired" });
          return;
        }
        if (!res.ok) {
          setState({ type: "error", message: "Something went wrong. Please try again later." });
          return;
        }
        const data: InviteData = await res.json();
        setState({ type: "data", data });

        // Auto-select first available date
        const avail = data.status === "pending"
          ? data.availability
          : data.availability; // reschedule mode also has availability
        if (avail && avail.days.length > 0) {
          setSelectedDate(avail.days[0].date);
        }
      } catch {
        setState({ type: "error", message: "Unable to connect. Please check your internet and try again." });
      }
    }
    load();
  }, [token, isReschedule]);

  // Book or reschedule the slot
  const handleBook = useCallback(async () => {
    if (!selectedSlot || booking) return;
    setBooking(true);

    try {
      // Use reschedule endpoint if rescheduling, book endpoint otherwise
      const endpoint = isReschedule
        ? `/api/portal/survey/${token}/reschedule`
        : `/api/portal/survey/${token}/book`;
      const method = isReschedule ? "PUT" : "POST";

      const res = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slotId: selectedSlot.slotId,
          ...(isReschedule ? {} : { accessNotes: accessNotes.trim() || undefined }),
          idempotencyKey: idempotencyKey.current,
        }),
      });

      if (res.status === 409) {
        const body = await res.json();
        setState({ type: "error", message: body.error || "This time slot was just taken." });
        return;
      }

      if (!res.ok) {
        setState({ type: "error", message: "Something went wrong. Please try again." });
        return;
      }

      // Navigate to confirmation
      router.push(`/portal/survey/${token}/confirmation`);
    } catch {
      setState({ type: "error", message: "Unable to connect. Please try again." });
    } finally {
      setBooking(false);
    }
  }, [selectedSlot, accessNotes, booking, token, router, isReschedule]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (state.type === "loading") {
    return <LoadingSkeleton />;
  }

  if (state.type === "error") {
    return (
      <div className="py-12 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
          <svg className="h-6 w-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
        </div>
        <h2 className="mb-2 text-lg font-semibold text-foreground">Something went wrong</h2>
        <p className="text-sm text-muted">{state.message}</p>
      </div>
    );
  }

  if (state.type === "expired") {
    return (
      <div className="py-12 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-yellow-100">
          <svg className="h-6 w-6 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h2 className="mb-2 text-lg font-semibold text-foreground">Link Expired</h2>
        <p className="text-sm text-muted">
          This scheduling link has expired. Please contact your Photon Brothers representative
          to receive a new one.
        </p>
      </div>
    );
  }

  const { data } = state;

  // Already scheduled — redirect to confirmation (unless rescheduling)
  if (data.status === "scheduled" && !isReschedule) {
    router.replace(`/portal/survey/${token}/confirmation`);
    return <LoadingSkeleton />;
  }

  // Get availability from either pending data or reschedule response
  const availability = data.status === "pending" ? data.availability : data.availability;

  // If rescheduling but no availability (shouldn't happen, but guard)
  if (!availability) {
    router.replace(`/portal/survey/${token}/confirmation`);
    return <LoadingSkeleton />;
  }

  const selectedDay = availability.days.find((d) => d.date === selectedDate);

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div>
        <h2 className="text-xl font-semibold text-foreground">
          {isReschedule
            ? `Pick a new time for your site survey`
            : `Hi ${data.customerName.split(" ")[0]}, let\u2019s schedule your site survey`}
        </h2>
        <p className="mt-1 text-sm text-muted">
          Select a date and time that works for you. The survey takes about 1 hour.
        </p>
      </div>

      {/* Address */}
      <div className="rounded-lg border border-t-border bg-surface p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Survey Location</p>
        <p className="mt-1 text-sm text-foreground">{data.propertyAddress}</p>
      </div>

      {availability.days.length === 0 ? (
        <div className="rounded-lg border border-t-border bg-surface p-6 text-center">
          <p className="text-sm text-muted">
            No available times right now. Please check back later or call us to schedule.
          </p>
        </div>
      ) : (
        <>
          {/* Date selector */}
          <div>
            <p className="mb-2 text-sm font-medium text-foreground">Select a date</p>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {availability.days.map((day) => (
                <button
                  key={day.date}
                  onClick={() => {
                    setSelectedDate(day.date);
                    setSelectedSlot(null);
                  }}
                  className={`flex-shrink-0 rounded-lg border px-3 py-2 text-center transition-colors ${
                    selectedDate === day.date
                      ? "border-orange-500 bg-orange-500 text-white"
                      : "border-t-border bg-surface text-foreground hover:border-orange-300"
                  }`}
                >
                  <div className="text-xs font-medium">{day.dayLabel.split(",")[0]}</div>
                  <div className="text-lg font-semibold">{day.dayLabel.split(" ").pop()}</div>
                  <div className="text-xs opacity-75">{day.dayLabel.split(" ")[1]}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Time slots */}
          {selectedDay && (
            <div>
              <p className="mb-2 text-sm font-medium text-foreground">
                Select a time ({availability.tzAbbrev})
              </p>
              <div className="grid grid-cols-2 gap-2">
                {selectedDay.slots.map((slot) => (
                  <button
                    key={slot.slotId}
                    onClick={() => setSelectedSlot(slot)}
                    className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                      selectedSlot?.slotId === slot.slotId
                        ? "border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400"
                        : "border-t-border bg-surface text-foreground hover:border-orange-300"
                    }`}
                  >
                    {slot.displayTime}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Access notes */}
          {selectedSlot && (
            <div>
              <label htmlFor="access-notes" className="mb-1 block text-sm font-medium text-foreground">
                Access instructions <span className="text-muted">(optional)</span>
              </label>
              <textarea
                id="access-notes"
                rows={3}
                maxLength={1000}
                placeholder="Gate codes, pets, where to park, side of house to access..."
                value={accessNotes}
                onChange={(e) => setAccessNotes(e.target.value)}
                className="w-full rounded-lg border border-t-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
              />
            </div>
          )}

          {/* Confirm button */}
          {selectedSlot && (
            <button
              onClick={handleBook}
              disabled={booking}
              className="w-full rounded-lg bg-orange-500 px-4 py-3 text-base font-semibold text-white transition-colors hover:bg-orange-600 disabled:opacity-50"
            >
              {booking ? "Scheduling..." : isReschedule ? "Confirm New Time" : "Confirm Survey"}
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div>
        <div className="h-6 w-3/4 rounded bg-skeleton" />
        <div className="mt-2 h-4 w-1/2 rounded bg-skeleton" />
      </div>
      <div className="h-16 rounded-lg bg-skeleton" />
      <div className="flex gap-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-16 w-14 flex-shrink-0 rounded-lg bg-skeleton" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-10 rounded-lg bg-skeleton" />
        ))}
      </div>
    </div>
  );
}
