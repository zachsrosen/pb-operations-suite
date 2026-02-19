"use client";

import React, { useState, useEffect, useCallback } from "react";
import { formatTimeRange12h } from "@/lib/format";
import { LOCATION_TIMEZONES } from "@/lib/constants";

interface CrewMemberInfo {
  id: string;
  name: string;
  locations: string[];
  role: string;
}

interface AvailabilityRecord {
  id: string;
  crewMemberId: string;
  location: string;
  reportLocation: string | null;
  jobType: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  timezone: string;
  isActive: boolean;
}

interface OverrideRecord {
  id: string;
  crewMemberId: string;
  date: string;
  type: string;
  reason: string | null;
  startTime: string | null;
  endTime: string | null;
  createdAt: string;
}

interface FormData {
  location: string;
  jobType: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  timezone: string;
  isActive: boolean;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_ABBREV = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const ALL_LOCATIONS = [
  "Westminster",
  "DTC",
  "Colorado Springs",
  "San Luis Obispo",
  "Camarillo",
];

// LOCATION_TIMEZONES imported from @/lib/constants (includes Centennial)

const JOB_TYPES = ["survey", "construction", "inspection"];

const DEFAULT_FORM: FormData = {
  location: "",
  jobType: "survey",
  dayOfWeek: 1,
  startTime: "08:00",
  endTime: "12:00",
  timezone: "America/Denver",
  isActive: true,
};

interface MyAvailabilityProps {
  onClose: () => void;
}

type QuickBlockAction = {
  key: string;
  label: string;
  dates: string[];
};

export default function MyAvailability({ onClose }: MyAvailabilityProps) {
  const [crewMember, setCrewMember] = useState<CrewMemberInfo | null>(null);
  const [records, setRecords] = useState<AvailabilityRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Modal form
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormData>(DEFAULT_FORM);

  // Overrides (date-specific blocks)
  const [overrides, setOverrides] = useState<OverrideRecord[]>([]);
  const [showBlockForm, setShowBlockForm] = useState(false);
  const [blockDate, setBlockDate] = useState("");
  const [blockReason, setBlockReason] = useState("");
  const [blockIsFullDay, setBlockIsFullDay] = useState(true);
  const [blockStartTime, setBlockStartTime] = useState("09:00");
  const [blockEndTime, setBlockEndTime] = useState("10:00");
  const [blockCalendarMonth, setBlockCalendarMonth] = useState(() => new Date().getMonth());
  const [blockCalendarYear, setBlockCalendarYear] = useState(() => new Date().getFullYear());
  const [savingBlock, setSavingBlock] = useState(false);
  const [quickBlockingKey, setQuickBlockingKey] = useState<string | null>(null);

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  const toDateStr = (date: Date) => {
    const local = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
  };

  const toLocalDate = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const getDateRange = (startOffsetDays: number, dayCount: number) => {
    const dates: string[] = [];
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() + startOffsetDays);
    for (let i = 0; i < dayCount; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      dates.push(toDateStr(d));
    }
    return dates;
  };

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [availRes, overridesRes] = await Promise.all([
        fetch("/api/zuper/my-availability"),
        fetch("/api/zuper/my-availability/overrides"),
      ]);
      if (!availRes.ok) {
        const data = await availRes.json();
        throw new Error(data.error || "Failed to fetch");
      }
      const data = await availRes.json();
      setCrewMember(data.crewMember);
      setRecords(data.records || []);

      if (overridesRes.ok) {
        const ovData = await overridesRes.json();
        setOverrides(ovData.records || []);
      }

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Determine available locations for this crew member
  const availableLocations = crewMember?.locations?.length
    ? ALL_LOCATIONS.filter(l => crewMember.locations.some(
        cl => cl.toLowerCase() === l.toLowerCase() || (cl === "Centennial" && l === "DTC")
      ))
    : ALL_LOCATIONS;

  const handleLocationChange = (loc: string) => {
    setFormData(prev => ({
      ...prev,
      location: loc,
      timezone: LOCATION_TIMEZONES[loc] || "America/Denver",
    }));
  };

  const openAddForm = () => {
    setEditingId(null);
    const defaultJobType = crewMember?.role === "surveyor" ? "survey"
      : crewMember?.role === "inspector" ? "inspection"
      : "survey";
    setFormData({
      ...DEFAULT_FORM,
      location: availableLocations[0] || "",
      timezone: LOCATION_TIMEZONES[availableLocations[0]] || "America/Denver",
      jobType: defaultJobType,
    });
    setShowForm(true);
  };

  const openEditForm = (record: AvailabilityRecord) => {
    setEditingId(record.id);
    setFormData({
      location: record.location,
      jobType: record.jobType,
      dayOfWeek: record.dayOfWeek,
      startTime: record.startTime,
      endTime: record.endTime,
      timezone: record.timezone,
      isActive: record.isActive,
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!formData.location || !formData.startTime || !formData.endTime) {
      showToast("Please fill in all required fields");
      return;
    }

    setSaving(true);
    try {
      const method = editingId ? "PUT" : "POST";
      const body = editingId ? { id: editingId, ...formData } : formData;

      const response = await fetch("/api/zuper/my-availability", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to save");
      }

      showToast(editingId ? "Slot updated" : "Slot created");
      setShowForm(false);
      fetchData();
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this availability slot?")) return;

    try {
      const response = await fetch("/api/zuper/my-availability", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to delete");
      }

      showToast("Slot deleted");
      fetchData();
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  // --- Override handlers ---
  const openBlockForm = () => {
    // Default to tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setBlockDate(toDateStr(tomorrow));
    setBlockReason("");
    setBlockIsFullDay(true);
    setBlockStartTime("09:00");
    setBlockEndTime("10:00");
    setBlockCalendarMonth(tomorrow.getMonth());
    setBlockCalendarYear(tomorrow.getFullYear());
    setShowBlockForm(true);
  };

  const handleBlockDate = async () => {
    if (!blockDate) {
      showToast("Please select a date");
      return;
    }
    if (!blockIsFullDay && (!blockStartTime || !blockEndTime)) {
      showToast("Please select start and end times");
      return;
    }
    if (!blockIsFullDay && blockStartTime >= blockEndTime) {
      showToast("End time must be after start time");
      return;
    }

    setSavingBlock(true);
    try {
      const response = await fetch("/api/zuper/my-availability/overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: blockDate,
          reason: blockReason || undefined,
          type: blockIsFullDay ? "blocked" : "custom",
          startTime: blockIsFullDay ? undefined : blockStartTime,
          endTime: blockIsFullDay ? undefined : blockEndTime,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to block date");
      }
      const data = await response.json();

      let message = "";
      if (blockIsFullDay) {
        message = `Blocked ${formatDateShort(blockDate)}`;
      } else {
        message = `Blocked ${formatDateShort(blockDate)} ${formatTimeRange12h(blockStartTime, blockEndTime)}`;
      }

      const detectedConflicts = Number(data?.conflictNotifications?.detected || 0);
      const sentNotifications = Number(data?.conflictNotifications?.sent || 0);
      if (detectedConflicts > 0) {
        if (sentNotifications > 0) {
          message += ` · ${sentNotifications} conflict alert${sentNotifications === 1 ? "" : "s"} sent`;
        } else {
          message += " · conflict alerts could not be delivered";
        }
      }

      showToast(message);
      setShowBlockForm(false);
      fetchData();
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSavingBlock(false);
    }
  };

  const handleDeleteOverride = async (id: string) => {
    if (!confirm("Remove this blocked date?")) return;

    try {
      const response = await fetch("/api/zuper/my-availability/overrides", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to remove block");
      }

      showToast("Block removed");
      fetchData();
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const handleQuickBlock = async (action: QuickBlockAction) => {
    const uniqueDates = [...new Set(action.dates)];
    if (uniqueDates.length === 0) {
      showToast("No dates to block");
      return;
    }

    setQuickBlockingKey(action.key);
    try {
      const results = await Promise.allSettled(
        uniqueDates.map((date) =>
          fetch("/api/zuper/my-availability/overrides", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ date, reason: `Quick block: ${action.label}` }),
          })
        )
      );

      let success = 0;
      let failed = 0;

      for (const result of results) {
        if (result.status === "fulfilled" && result.value.ok) {
          success++;
        } else {
          failed++;
        }
      }

      if (success > 0) {
        await fetchData();
      }

      if (failed > 0) {
        showToast(`Blocked ${success}/${uniqueDates.length} date(s)`);
      } else {
        showToast(`Blocked ${success} date(s)`);
      }
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setQuickBlockingKey(null);
    }
  };

  const formatDateShort = (dateStr: string) => {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  };

  const getMonthLabel = (month: number, year: number) =>
    new Date(year, month, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const buildCalendarCells = (month: number, year: number) => {
    const firstDay = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const leadingBlanks = firstDay.getDay();
    const cells: Array<{ dateStr: string | null; isPast: boolean }> = [];
    const today = toLocalDate(new Date());

    for (let i = 0; i < leadingBlanks; i++) {
      cells.push({ dateStr: null, isPast: false });
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const current = new Date(year, month, day);
      const dateStr = toDateStr(current);
      const isPast = current < today;
      cells.push({ dateStr, isPast });
    }

    return cells;
  };

  // Sort records by day of week, then start time
  const sortedRecords = [...records].sort((a, b) => {
    if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
    return a.startTime.localeCompare(b.startTime);
  });

  const quickBlockActions: QuickBlockAction[] = [
    { key: "today", label: "Block Today", dates: getDateRange(0, 1) },
    { key: "tomorrow", label: "Block Tomorrow", dates: getDateRange(1, 1) },
    { key: "next-3", label: "Block Next 3 Days", dates: getDateRange(1, 3) },
    { key: "next-7", label: "Block Next 7 Days", dates: getDateRange(1, 7) },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-lg max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <div>
            <h2 className="text-lg font-bold text-white">My Availability</h2>
            {crewMember && (
              <p className="text-xs text-zinc-400 mt-0.5">
                {crewMember.name} &middot;{" "}
                <span className="capitalize">{crewMember.role}</span>
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white p-1"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Toast */}
        {toast && (
          <div className="mx-5 mt-3 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2">
            <p className="text-xs">{toast}</p>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!loading && !error && (
            <div className="mb-4 rounded-lg border border-amber-900/40 bg-amber-950/20 p-3">
              <p className="text-xs font-semibold text-amber-300 uppercase tracking-wider mb-2">
                Quick Block (All Day)
              </p>
              <div className="grid grid-cols-2 gap-2">
                {quickBlockActions.map((action) => (
                  <button
                    key={action.key}
                    onClick={() => handleQuickBlock(action)}
                    disabled={quickBlockingKey !== null || savingBlock}
                    className="px-2.5 py-2 bg-amber-700/70 hover:bg-amber-600 rounded-md text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {quickBlockingKey === action.key ? "Blocking..." : action.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-zinc-400 mt-2">
                One click adds day blocks to your calendar without editing weekly slots.
              </p>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-cyan-500" />
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          ) : sortedRecords.length === 0 && overrides.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-zinc-500 text-sm mb-3">No availability slots configured</p>
              <button
                onClick={openAddForm}
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm font-medium transition-colors"
              >
                Add Your First Slot
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Recurring Slots */}
              {sortedRecords.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                    Weekly Schedule
                  </h3>
                  {sortedRecords.map(record => (
                    <div
                      key={record.id}
                      className={`flex items-center justify-between p-3 rounded-lg border ${
                        record.isActive
                          ? "bg-zinc-800/50 border-zinc-700/50"
                          : "bg-zinc-900/50 border-zinc-800/30 opacity-60"
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="px-2 py-0.5 bg-zinc-700 rounded text-xs font-medium shrink-0">
                          {DAY_ABBREV[record.dayOfWeek]}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm text-white truncate">
                            {record.location}
                            <span className="text-zinc-500 ml-2 text-xs">
                              {formatTimeRange12h(record.startTime, record.endTime)}
                            </span>
                          </p>
                          <p className="text-xs text-zinc-500">
                            <span className="capitalize">{record.jobType}</span>
                            {record.timezone === "America/Los_Angeles" ? " · PT" : " · MT"}
                            {!record.isActive && " · Inactive"}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0 ml-2">
                        <button
                          onClick={() => openEditForm(record)}
                          className="text-zinc-400 hover:text-white text-xs px-2 py-1"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(record.id)}
                          className="text-zinc-500 hover:text-red-400 text-xs px-2 py-1"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Date Overrides */}
              {overrides.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                    Date Overrides
                  </h3>
                  {overrides.map(ov => (
                    <div
                      key={ov.id}
                      className="flex items-center justify-between p-3 rounded-lg border border-amber-900/30 bg-amber-950/20"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {ov.type === "custom" ? (
                          <span className="px-2 py-0.5 bg-amber-800/60 text-amber-200 rounded text-xs font-medium shrink-0">
                            Time Block
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 bg-amber-900/50 text-amber-300 rounded text-xs font-medium shrink-0">
                            Full Day
                          </span>
                        )}
                        <div className="min-w-0">
                          <p className="text-sm text-white">
                            {formatDateShort(ov.date)}
                          </p>
                          {ov.type === "custom" && ov.startTime && ov.endTime && (
                            <p className="text-xs text-amber-300/80">
                              {formatTimeRange12h(ov.startTime, ov.endTime)}
                            </p>
                          )}
                          {ov.reason && (
                            <p className="text-xs text-zinc-500">{ov.reason}</p>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteOverride(ov.id)}
                        className="text-zinc-500 hover:text-red-400 text-xs px-2 py-1 shrink-0 ml-2"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {!loading && !error && (sortedRecords.length > 0 || overrides.length > 0) && (
          <div className="px-5 py-3 border-t border-zinc-800 flex gap-2">
            <button
              onClick={openAddForm}
              className="flex-1 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm font-medium transition-colors"
            >
              + Add Slot
            </button>
            <button
              onClick={openBlockForm}
              className="flex-1 px-4 py-2 bg-amber-700 hover:bg-amber-600 rounded-lg text-sm font-medium transition-colors"
            >
              Block a Date
            </button>
          </div>
        )}
      </div>

      {/* Add/Edit Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 w-full max-w-sm">
            <h3 className="text-base font-bold mb-4">
              {editingId ? "Edit Slot" : "Add Availability Slot"}
            </h3>

            <div className="space-y-3">
              {/* Location */}
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Location</label>
                <select
                  value={formData.location}
                  onChange={e => handleLocationChange(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">Select location...</option>
                  {availableLocations.map(l => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </div>

              {/* Day of Week */}
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Day of Week</label>
                <select
                  value={formData.dayOfWeek}
                  onChange={e => setFormData(prev => ({ ...prev, dayOfWeek: parseInt(e.target.value) }))}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                >
                  {DAYS.map((d, i) => (
                    <option key={i} value={i}>{d}</option>
                  ))}
                </select>
              </div>

              {/* Time Range */}
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs text-zinc-400 mb-1">Start</label>
                  <input
                    type="time"
                    value={formData.startTime}
                    onChange={e => setFormData(prev => ({ ...prev, startTime: e.target.value }))}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-zinc-400 mb-1">End</label>
                  <input
                    type="time"
                    value={formData.endTime}
                    onChange={e => setFormData(prev => ({ ...prev, endTime: e.target.value }))}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>

              {/* Job Type */}
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Job Type</label>
                <div className="flex gap-2">
                  {JOB_TYPES.map(type => (
                    <button
                      key={type}
                      onClick={() => setFormData(prev => ({ ...prev, jobType: type }))}
                      className={`px-3 py-1.5 rounded-lg text-xs capitalize ${
                        formData.jobType === type
                          ? "bg-cyan-600 text-white"
                          : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              {/* Timezone */}
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Timezone</label>
                <select
                  value={formData.timezone}
                  onChange={e => setFormData(prev => ({ ...prev, timezone: e.target.value }))}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="America/Denver">Mountain Time (MT)</option>
                  <option value="America/Los_Angeles">Pacific Time (PT)</option>
                </select>
              </div>

              {/* Active Toggle */}
              <label className="flex items-center justify-between p-2 bg-zinc-800 rounded-lg cursor-pointer">
                <span className="text-xs">Active</span>
                <button
                  type="button"
                  onClick={() => setFormData(prev => ({ ...prev, isActive: !prev.isActive }))}
                  className={`relative w-10 h-5 rounded-full transition-colors ${
                    formData.isActive ? "bg-cyan-500" : "bg-zinc-600"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                      formData.isActive ? "translate-x-5" : ""
                    }`}
                  />
                </button>
              </label>
            </div>

            {/* Form Actions */}
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setShowForm(false)}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-xs font-medium disabled:opacity-50"
              >
                {saving ? "Saving..." : editingId ? "Update" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Block Date Modal */}
      {showBlockForm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 w-full max-w-md">
            <h3 className="text-base font-bold mb-1">Add Date Override</h3>
            <p className="text-xs text-zinc-400 mb-4">
              Select a date, then choose full day or a time range. Your weekly schedule remains unchanged.
            </p>

            <div className="space-y-3">
              <div className="rounded-lg border border-zinc-700 bg-zinc-800/40 p-3">
                <div className="flex items-center justify-between mb-2">
                  <button
                    type="button"
                    onClick={() => {
                      const prev = new Date(blockCalendarYear, blockCalendarMonth - 1, 1);
                      setBlockCalendarMonth(prev.getMonth());
                      setBlockCalendarYear(prev.getFullYear());
                    }}
                    className="px-2 py-1 text-xs rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                  >
                    Prev
                  </button>
                  <p className="text-xs font-semibold text-zinc-200">
                    {getMonthLabel(blockCalendarMonth, blockCalendarYear)}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      const next = new Date(blockCalendarYear, blockCalendarMonth + 1, 1);
                      setBlockCalendarMonth(next.getMonth());
                      setBlockCalendarYear(next.getFullYear());
                    }}
                    className="px-2 py-1 text-xs rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                  >
                    Next
                  </button>
                </div>

                <div className="grid grid-cols-7 gap-1 mb-1">
                  {DAY_ABBREV.map((day) => (
                    <div key={day} className="text-[10px] text-zinc-500 text-center py-1">
                      {day}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {buildCalendarCells(blockCalendarMonth, blockCalendarYear).map((cell, idx) => (
                    <button
                      key={`${cell.dateStr || "blank"}-${idx}`}
                      type="button"
                      disabled={!cell.dateStr || cell.isPast}
                      onClick={() => {
                        if (cell.dateStr) setBlockDate(cell.dateStr);
                      }}
                      className={`h-8 rounded text-xs transition-colors ${
                        !cell.dateStr
                          ? "opacity-0 cursor-default"
                          : cell.isPast
                            ? "text-zinc-600 cursor-not-allowed bg-zinc-900/40"
                            : blockDate === cell.dateStr
                              ? "bg-amber-600 text-white"
                              : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                      }`}
                    >
                      {cell.dateStr ? Number(cell.dateStr.slice(8, 10)) : ""}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1">Override Type</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setBlockIsFullDay(true)}
                    className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                      blockIsFullDay ? "bg-amber-700 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                    }`}
                  >
                    Full Day
                  </button>
                  <button
                    type="button"
                    onClick={() => setBlockIsFullDay(false)}
                    className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                      !blockIsFullDay ? "bg-amber-700 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                    }`}
                  >
                    Time Range
                  </button>
                </div>
              </div>

              {!blockIsFullDay && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">Start</label>
                    <input
                      type="time"
                      value={blockStartTime}
                      onChange={e => setBlockStartTime(e.target.value)}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">End</label>
                    <input
                      type="time"
                      value={blockEndTime}
                      onChange={e => setBlockEndTime(e.target.value)}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs text-zinc-400 mb-1">Reason (optional)</label>
                <input
                  type="text"
                  value={blockReason}
                  onChange={e => setBlockReason(e.target.value)}
                  placeholder="PTO, Appointment, Training..."
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm placeholder:text-zinc-600"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setShowBlockForm(false)}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs"
              >
                Cancel
              </button>
              <button
                onClick={handleBlockDate}
                disabled={savingBlock}
                className="px-4 py-2 bg-amber-700 hover:bg-amber-600 rounded-lg text-xs font-medium disabled:opacity-50"
              >
                {savingBlock ? "Saving..." : "Save Override"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
