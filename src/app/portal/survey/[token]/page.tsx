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

function extractFirstName(name: string): string {
  if (name.includes(",")) {
    return name.split(",")[1]?.trim().split(" ")[0] || name;
  }
  return name.split(" ")[0] || name;
}

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

  const idempotencyKey = useRef(crypto.randomUUID());

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

        const avail = data.status === "pending"
          ? data.availability
          : data.availability;
        if (avail && avail.days.length > 0) {
          setSelectedDate(avail.days[0].date);
        }
      } catch {
        setState({ type: "error", message: "Unable to connect. Please check your internet and try again." });
      }
    }
    load();
  }, [token, isReschedule]);

  const handleBook = useCallback(async () => {
    if (!selectedSlot || booking) return;
    setBooking(true);

    try {
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

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const msg = body?.error || "Something went wrong. Please try again.";
        setState({ type: "error", message: msg });
        return;
      }

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
      <div className="py-16 text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-red-50 ring-1 ring-red-100">
          <svg className="h-6 w-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
        </div>
        <h2 className="mb-2 text-lg font-semibold text-gray-900">Something went wrong</h2>
        <p className="text-sm text-gray-500">{state.message}</p>
      </div>
    );
  }

  if (state.type === "expired") {
    return (
      <div className="py-16 text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 ring-1 ring-amber-100">
          <svg className="h-6 w-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h2 className="mb-2 text-lg font-semibold text-gray-900">Link Expired</h2>
        <p className="mx-auto max-w-xs text-sm text-gray-500">
          This scheduling link has expired. Please contact your Photon Brothers representative
          to receive a new one.
        </p>
      </div>
    );
  }

  const { data } = state;

  if (data.status === "scheduled" && !isReschedule) {
    router.replace(`/portal/survey/${token}/confirmation`);
    return <LoadingSkeleton />;
  }

  const availability = data.status === "pending" ? data.availability : data.availability;

  if (!availability) {
    router.replace(`/portal/survey/${token}/confirmation`);
    return <LoadingSkeleton />;
  }

  const selectedDay = availability.days.find((d) => d.date === selectedDate);

  // Progress: 1=date, 2=time, 3=notes
  const step = selectedSlot ? 3 : selectedDate ? 2 : 1;

  return (
    <div className="space-y-7">
      {/* Progress indicator */}
      <div className="flex items-center gap-2">
        {[1, 2, 3].map((s) => (
          <div
            key={s}
            className={`h-1 flex-1 rounded-full transition-all duration-300 ${
              s <= step ? "bg-[#2596be]" : "bg-gray-200"
            }`}
          />
        ))}
      </div>

      {/* Greeting */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-gray-900">
          {isReschedule
            ? "Pick a new time"
            : `Hi ${extractFirstName(data.customerName)},`}
        </h2>
        <p className="mt-1.5 text-[15px] leading-relaxed text-gray-500">
          {isReschedule
            ? "Select a new date and time for your site survey."
            : "Let’s get your site survey scheduled. It takes about 1 hour."}
        </p>
      </div>

      {/* Address card */}
      <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-100">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[#0f1b3d]/5">
            <svg className="h-4 w-4 text-[#0f1b3d]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">
              Survey Location
            </p>
            <p className="mt-1 text-[15px] font-medium text-gray-900">{data.propertyAddress}</p>
          </div>
        </div>
      </div>

      {availability.days.length === 0 ? (
        <div className="rounded-xl bg-white p-8 text-center shadow-sm ring-1 ring-gray-100">
          <p className="text-sm text-gray-500">
            No available times right now. Please check back later or call us to schedule.
          </p>
        </div>
      ) : (
        <>
          {/* Date selector */}
          <div>
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-gray-400">
              Choose a Date
            </p>
            <div className="-mx-5 overflow-x-auto pb-3 pt-1">
              <div className="flex gap-2.5 px-5 snap-x snap-mandatory">
              {availability.days.map((day) => {
                const isSelected = selectedDate === day.date;
                return (
                  <button
                    key={day.date}
                    onClick={() => {
                      setSelectedDate(day.date);
                      setSelectedSlot(null);
                    }}
                    className={`flex-shrink-0 snap-start rounded-xl px-4 py-3 text-center transition-all duration-200 ${
                      isSelected
                        ? "bg-[#2596be] text-white shadow-md shadow-[#2596be]/20"
                        : "bg-white text-gray-700 shadow-sm ring-1 ring-gray-100 hover:ring-[#2596be]/40 hover:shadow-md"
                    }`}
                  >
                    <div className={`text-[11px] font-semibold uppercase tracking-wide ${isSelected ? "text-white/80" : "text-gray-400"}`}>
                      {day.dayLabel.split(",")[0]}
                    </div>
                    <div className="mt-0.5 text-xl font-bold">{day.dayLabel.split(" ").pop()}</div>
                    <div className={`text-[11px] font-medium ${isSelected ? "text-white/70" : "text-gray-400"}`}>
                      {day.dayLabel.split(" ")[1]}
                    </div>
                  </button>
                );
              })}
              </div>
            </div>
          </div>

          {/* Time slots */}
          {selectedDay && (
            <div>
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-gray-400">
                Choose a Time <span className="normal-case tracking-normal text-gray-300">({availability.tzAbbrev})</span>
              </p>
              <div className="grid grid-cols-2 gap-2.5">
                {selectedDay.slots.map((slot) => {
                  const isSelected = selectedSlot?.slotId === slot.slotId;
                  return (
                    <button
                      key={slot.slotId}
                      onClick={() => setSelectedSlot(slot)}
                      className={`rounded-xl px-4 py-3 text-sm font-semibold transition-all duration-200 ${
                        isSelected
                          ? "bg-[#2596be]/10 text-[#2596be] ring-2 ring-[#2596be] shadow-sm"
                          : "bg-white text-gray-700 shadow-sm ring-1 ring-gray-100 hover:ring-[#2596be]/40 hover:shadow-md"
                      }`}
                    >
                      {slot.displayTime}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Access notes */}
          {selectedSlot && (
            <div>
              <label htmlFor="access-notes" className="mb-2 block text-[11px] font-semibold uppercase tracking-widest text-gray-400">
                Access Instructions <span className="normal-case tracking-normal text-gray-300">(optional)</span>
              </label>
              <textarea
                id="access-notes"
                rows={3}
                maxLength={1000}
                placeholder="Gate codes, pets, where to park, side of house to access..."
                value={accessNotes}
                onChange={(e) => setAccessNotes(e.target.value)}
                className="w-full rounded-xl bg-white px-4 py-3 text-sm text-gray-900 shadow-sm ring-1 ring-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#2596be] transition-shadow"
              />
            </div>
          )}

          {/* Confirm button */}
          {selectedSlot && (
            <button
              onClick={handleBook}
              disabled={booking}
              className="w-full rounded-xl bg-gradient-to-r from-[#2596be] to-[#1d7a9a] px-4 py-3.5 text-base font-bold text-white shadow-lg shadow-[#2596be]/20 transition-all duration-200 hover:shadow-xl hover:shadow-[#2596be]/30 hover:brightness-105 active:scale-[0.98] disabled:opacity-50 disabled:shadow-none"
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
    <div className="animate-pulse space-y-7">
      {/* Progress bar */}
      <div className="flex gap-2">
        <div className="h-1 flex-1 rounded-full bg-gray-200" />
        <div className="h-1 flex-1 rounded-full bg-gray-200" />
        <div className="h-1 flex-1 rounded-full bg-gray-200" />
      </div>
      {/* Heading */}
      <div>
        <div className="h-7 w-3/4 rounded-lg bg-gray-200" />
        <div className="mt-3 h-4 w-1/2 rounded-lg bg-gray-200" />
      </div>
      {/* Address card */}
      <div className="h-20 rounded-xl bg-gray-200" />
      {/* Date cards */}
      <div className="flex gap-2.5">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-20 w-16 flex-shrink-0 rounded-xl bg-gray-200" />
        ))}
      </div>
      {/* Time slots */}
      <div className="grid grid-cols-2 gap-2.5">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-12 rounded-xl bg-gray-200" />
        ))}
      </div>
    </div>
  );
}
