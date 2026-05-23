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
        <h2 className="mb-2 text-lg font-semibold text-[#323F4D]">Something went wrong</h2>
        <p className="text-sm text-[#6B7280]">{state.message}</p>
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
        <h2 className="mb-2 text-lg font-semibold text-[#323F4D]">Link Expired</h2>
        <p className="mx-auto max-w-xs text-sm text-[#6B7280]">
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

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-[#323F4D]">
          {isReschedule
            ? "Pick a new time"
            : `Hi ${extractFirstName(data.customerName)},`}
        </h2>
        <p className="mt-1.5 text-[15px] leading-relaxed text-[#6B7280]">
          {isReschedule
            ? "Select a new date and time for your site survey."
            : "Let’s get your site survey scheduled. It takes about 1 hour."}
        </p>
      </div>

      {/* Address card */}
      <div className="rounded-lg border border-[#E5E7EB] bg-[#FAFAFA] p-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[#3F4F62]/10">
            <svg className="h-4 w-4 text-[#3F4F62]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-[#6B7280]">
              Survey Location
            </p>
            <p className="mt-1 text-[15px] font-medium text-[#323F4D]">{data.propertyAddress}</p>
          </div>
        </div>
      </div>

      {availability.days.length === 0 ? (
        <div className="rounded-lg border border-[#E5E7EB] bg-[#FAFAFA] p-8 text-center">
          <p className="text-sm text-[#6B7280]">
            No available times right now. Please check back later or call us to schedule.
          </p>
        </div>
      ) : (
        <>
          {/* Date selector */}
          <div>
            <p className="mb-2 text-sm font-medium text-[#323F4D]">Select a date</p>
            <div className="-mx-4 overflow-x-auto pb-3 pt-1">
              <div className="flex gap-2 px-4 snap-x snap-mandatory">
                {availability.days.map((day) => (
                  <button
                    key={day.date}
                    onClick={() => {
                      setSelectedDate(day.date);
                      setSelectedSlot(null);
                    }}
                    className={`flex-shrink-0 snap-start rounded-lg border px-3 py-2 text-center transition-colors ${
                      selectedDate === day.date
                        ? "border-[#FF9E1B] bg-[#FF9E1B] text-white"
                        : "border-[#E5E7EB] bg-white text-[#323F4D] hover:border-[#FF9E1B]"
                    }`}
                  >
                    <div className="text-xs font-medium">{day.dayLabel.split(",")[0]}</div>
                    <div className="text-lg font-semibold">{day.dayLabel.split(" ").pop()}</div>
                    <div className="text-xs opacity-75">{day.dayLabel.split(" ")[1]}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Time slots */}
          {selectedDay && (
            <div>
              <p className="mb-2 text-sm font-medium text-[#323F4D]">
                Select a time ({availability.tzAbbrev})
              </p>
              <div className="grid grid-cols-2 gap-2">
                {selectedDay.slots.map((slot) => (
                  <button
                    key={slot.slotId}
                    onClick={() => setSelectedSlot(slot)}
                    className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                      selectedSlot?.slotId === slot.slotId
                        ? "border-[#FF9E1B] bg-[#FFF4E0] text-[#7C4903]"
                        : "border-[#E5E7EB] bg-white text-[#323F4D] hover:border-[#FF9E1B]"
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
              <label htmlFor="access-notes" className="mb-1 block text-sm font-medium text-[#323F4D]">
                Access instructions <span className="text-[#6B7280] font-normal">(optional)</span>
              </label>
              <textarea
                id="access-notes"
                rows={3}
                maxLength={1000}
                placeholder="Gate codes, pets, where to park, side of house to access..."
                value={accessNotes}
                onChange={(e) => setAccessNotes(e.target.value)}
                className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm text-[#323F4D] placeholder:text-[#9CA3AF] focus:border-[#FF9E1B] focus:outline-none focus:ring-1 focus:ring-[#FF9E1B]"
              />
            </div>
          )}

          {/* Confirm button */}
          {selectedSlot && (
            <button
              onClick={handleBook}
              disabled={booking}
              className="w-full rounded-lg bg-[#FF9E1B] px-4 py-3 text-base font-semibold text-white transition-colors hover:bg-[#DF8407] disabled:opacity-50"
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
      {/* Heading */}
      <div>
        <div className="h-7 w-3/4 rounded-lg bg-gray-200" />
        <div className="mt-3 h-4 w-1/2 rounded-lg bg-gray-200" />
      </div>
      {/* Address card */}
      <div className="h-20 rounded-lg bg-gray-200" />
      {/* Date cards */}
      <div className="flex gap-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-20 w-16 flex-shrink-0 rounded-lg bg-gray-200" />
        ))}
      </div>
      {/* Time slots */}
      <div className="grid grid-cols-2 gap-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-12 rounded-lg bg-gray-200" />
        ))}
      </div>
    </div>
  );
}
