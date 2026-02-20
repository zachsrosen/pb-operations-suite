"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { formatTimeRange12h } from "@/lib/format";
import { LOCATION_TIMEZONES } from "@/lib/constants";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

interface CrewMember {
  id: string;
  name: string;
  isActive: boolean;
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
  crewMember: {
    name: string;
    isActive: boolean;
  };
}

interface OverrideRecord {
  id: string;
  crewMemberId: string;
  date: string;
  availabilityId: string | null;
  type: string;
  reason: string | null;
  startTime: string | null;
  endTime: string | null;
  crewMember: { name: string; isActive: boolean };
}

interface FormData {
  crewMemberId: string;
  location: string;
  reportLocation: string;
  jobType: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  timezone: string;
  isActive: boolean;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_ABBREV = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const LOCATIONS = [
  "Westminster",
  "DTC",
  "Colorado Springs",
  "San Luis Obispo",
  "Camarillo",
];

// LOCATION_TIMEZONES imported from @/lib/constants (includes Centennial)

const JOB_TYPES = ["survey", "construction", "inspection"];

const DEFAULT_FORM: FormData = {
  crewMemberId: "",
  location: "",
  reportLocation: "",
  jobType: "survey",
  dayOfWeek: 1,
  startTime: "08:00",
  endTime: "12:00",
  timezone: "America/Denver",
  isActive: true,
};

export default function CrewAvailabilityPage() {
  const [records, setRecords] = useState<AvailabilityRecord[]>([]);
  const [crewMembers, setCrewMembers] = useState<CrewMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [seedingTeams, setSeedingTeams] = useState(false);

  // Filters
  const [filterCrew, setFilterCrew] = useState<string>("All");
  const [filterLocation, setFilterLocation] = useState<string>("All");
  const [filterDay, setFilterDay] = useState<string>("All");

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormData>(DEFAULT_FORM);

  // Overrides (date-specific blocks)
  const [overrides, setOverrides] = useState<OverrideRecord[]>([]);
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [overrideForm, setOverrideForm] = useState({ crewMemberId: "", date: "", reason: "" });

  // Confirm dialog
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; title: string; message: string; variant?: "danger" | "default"; confirmLabel?: string } | null>(null);
  const pendingConfirm = useRef<(() => void) | null>(null);

  const openConfirm = (title: string, message: string, onConfirm: () => void, opts?: { variant?: "danger" | "default"; confirmLabel?: string }) => {
    pendingConfirm.current = onConfirm;
    setConfirmDialog({ open: true, title, message, ...opts });
  };
  const closeConfirm = () => {
    pendingConfirm.current = null;
    setConfirmDialog(null);
  };

  const showToast = (message: string, durationMs = 5000) => {
    setToast(message);
    setTimeout(() => setToast(null), durationMs);
  };

  const fetchRecords = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/admin/crew-availability");
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to fetch");
      }
      const data = await response.json();
      setRecords(data.records || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchOverrides = useCallback(async () => {
    try {
      // Fetch overrides from today onwards
      const today = new Date().toISOString().split("T")[0];
      const response = await fetch(`/api/admin/crew-availability/overrides?dateFrom=${today}`);
      if (response.ok) {
        const data = await response.json();
        setOverrides(data.records || []);
      }
    } catch {
      // Non-critical
    }
  }, []);

  const fetchCrewMembers = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/crew");
      if (response.ok) {
        const data = await response.json();
        setCrewMembers(data.crew || []);
      }
    } catch {
      // Non-critical
    }
  }, []);

  useEffect(() => {
    fetchRecords();
    fetchCrewMembers();
    fetchOverrides();
  }, [fetchRecords, fetchCrewMembers, fetchOverrides]);

  const filteredRecords = records.filter(r => {
    if (filterCrew !== "All" && r.crewMember.name !== filterCrew) return false;
    if (filterLocation !== "All" && r.location !== filterLocation) return false;
    if (filterDay !== "All" && r.dayOfWeek !== parseInt(filterDay)) return false;
    return true;
  });

  const uniqueCrewNames = [...new Set(records.map(r => r.crewMember.name))].sort();
  const uniqueLocations = [...new Set(records.map(r => r.location))].sort();

  const openAddModal = () => {
    setEditingId(null);
    setFormData(DEFAULT_FORM);
    setShowModal(true);
  };

  const openEditModal = (record: AvailabilityRecord) => {
    setEditingId(record.id);
    setFormData({
      crewMemberId: record.crewMemberId,
      location: record.location,
      reportLocation: record.reportLocation || record.location,
      jobType: record.jobType,
      dayOfWeek: record.dayOfWeek,
      startTime: record.startTime,
      endTime: record.endTime,
      timezone: record.timezone,
      isActive: record.isActive,
    });
    setShowModal(true);
  };

  const handleLocationChange = (loc: string) => {
    setFormData(prev => ({
      ...prev,
      location: loc,
      reportLocation: loc,
      timezone: LOCATION_TIMEZONES[loc] || "America/Denver",
    }));
  };

  const handleSave = async () => {
    if (!formData.crewMemberId || !formData.location || !formData.startTime || !formData.endTime) {
      showToast("Please fill in all required fields");
      return;
    }

    setSaving(true);
    try {
      const method = editingId ? "PUT" : "POST";
      const body = editingId ? { id: editingId, ...formData } : formData;

      const response = await fetch("/api/admin/crew-availability", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to save");
      }

      showToast(editingId ? "Slot updated" : "Slot created");
      setShowModal(false);
      fetchRecords();
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    openConfirm("Delete slot", "Delete this availability slot?", () => _handleDelete(id), { variant: "danger", confirmLabel: "Delete" });
  };

  const _handleDelete = async (id: string) => {

    try {
      const response = await fetch("/api/admin/crew-availability", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to delete");
      }

      showToast("Slot deleted");
      fetchRecords();
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const handleSeed = async () => {
    openConfirm("Seed schedules", "Seed crew members and availability from hardcoded schedules? This won't overwrite existing records.", () => _handleSeed());
  };

  const _handleSeed = async () => {

    setSeeding(true);
    try {
      // Step 1: Ensure crew members exist (required before availability can be seeded)
      const crewResponse = await fetch("/api/admin/crew?action=seed", {
        method: "POST",
      });
      let crewData;
      try { crewData = await crewResponse.json(); } catch { crewData = null; }
      if (!crewResponse.ok) {
        throw new Error(crewData?.error || `Crew seed failed (${crewResponse.status})`);
      }

      // Step 2: Seed availability schedules
      const response = await fetch("/api/admin/crew-availability/seed", {
        method: "POST",
      });

      let data;
      try { data = await response.json(); } catch { data = null; }
      if (!response.ok) {
        throw new Error(data?.error || `Availability seed failed (${response.status})`);
      }

      const crewCount = crewData?.results?.length || 0;
      const errMsg = data?.errors?.length ? ` (${data.errors.join(", ")})` : "";
      showToast(`${crewCount} crew synced, ${data?.created || 0} slots created, ${data?.skipped || 0} skipped${errMsg}`, 8000);
      fetchRecords();
      fetchCrewMembers();
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : "Unknown error"}`, 10000);
    } finally {
      setSeeding(false);
    }
  };

  const handleSeedTeams = async () => {
    openConfirm("Seed teams", "Seed DTC & Westminster crew teams from Zuper? This will resolve Zuper UIDs and create user accounts.", () => _handleSeedTeams());
  };

  const _handleSeedTeams = async () => {

    setSeedingTeams(true);
    try {
      const response = await fetch("/api/admin/crew?action=seed-teams", {
        method: "POST",
      });

      let data;
      try {
        data = await response.json();
      } catch {
        throw new Error(`Server returned ${response.status}: ${response.statusText}`);
      }

      if (!response.ok) {
        throw new Error(data.error || data.details || `Failed (${response.status})`);
      }

      showToast(data.message || "Teams seeded successfully", 8000);
      fetchRecords();
      fetchCrewMembers();
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : "Unknown error"}`, 10000);
    } finally {
      setSeedingTeams(false);
    }
  };

  const handleCreateOverride = async () => {
    if (!overrideForm.crewMemberId || !overrideForm.date) {
      showToast("Crew member and date are required");
      return;
    }
    try {
      const response = await fetch("/api/admin/crew-availability/overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          crewMemberId: overrideForm.crewMemberId,
          date: overrideForm.date,
          type: "blocked",
          reason: overrideForm.reason || null,
        }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to create");
      }
      showToast("Date blocked");
      setShowOverrideModal(false);
      setOverrideForm({ crewMemberId: "", date: "", reason: "" });
      fetchOverrides();
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const handleDeleteOverride = async (id: string) => {
    openConfirm("Remove block", "Remove this date block?", () => _handleDeleteOverride(id), { variant: "danger", confirmLabel: "Remove" });
  };

  const _handleDeleteOverride = async (id: string) => {
    try {
      const response = await fetch("/api/admin/crew-availability/overrides", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to delete");
      }
      showToast("Block removed");
      fetchOverrides();
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  // Helper to compute the next occurrence of a dayOfWeek
  const getNextDateForDay = (dayOfWeek: number): string => {
    const today = new Date();
    const currentDay = today.getDay();
    let daysUntil = dayOfWeek - currentDay;
    if (daysUntil <= 0) daysUntil += 7;
    const next = new Date(today);
    next.setDate(today.getDate() + daysUntil);
    return next.toISOString().split("T")[0];
  };

  const openBlockNextModal = (record: AvailabilityRecord) => {
    setOverrideForm({
      crewMemberId: record.crewMemberId,
      date: getNextDateForDay(record.dayOfWeek),
      reason: "",
    });
    setShowOverrideModal(true);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 text-xl mb-2">Error</p>
          <p className="text-muted text-sm mb-4">{error}</p>
          <Link href="/" className="px-4 py-2 bg-surface-2 rounded-lg hover:bg-zinc-600">
            Go Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {confirmDialog && (
        <ConfirmDialog
          open={confirmDialog.open}
          title={confirmDialog.title}
          message={confirmDialog.message}
          variant={confirmDialog.variant}
          confirmLabel={confirmDialog.confirmLabel}
          onConfirm={() => { pendingConfirm.current?.(); closeConfirm(); }}
          onCancel={closeConfirm}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-surface-2 border border-t-border rounded-lg px-4 py-3 shadow-lg">
          <p className="text-sm">{toast}</p>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link
              href="/admin/users"
              className="text-muted hover:text-foreground transition-colors"
            >
              &larr; Admin
            </Link>
            <h1 className="text-2xl font-bold">Crew Availability</h1>
            <span className="text-muted text-sm">{records.length} slots</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSeed}
              disabled={seeding}
              className="px-4 py-2 bg-surface-2 hover:bg-zinc-600 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              {seeding ? "Seeding..." : "Sync from Code"}
            </button>
            <button
              onClick={handleSeedTeams}
              disabled={seedingTeams}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              {seedingTeams ? "Seeding Teams..." : "Seed Teams"}
            </button>
            <button
              onClick={() => {
                setOverrideForm({ crewMemberId: "", date: "", reason: "" });
                setShowOverrideModal(true);
              }}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-500 rounded-lg text-sm font-medium transition-colors"
            >
              Block Date
            </button>
            <button
              onClick={openAddModal}
              className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm font-medium transition-colors"
            >
              + Add Slot
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-3 mb-6">
          <select
            value={filterCrew}
            onChange={e => setFilterCrew(e.target.value)}
            className="bg-surface-2 border border-t-border rounded-lg px-3 py-2 text-sm"
          >
            <option value="All">All Crew</option>
            {uniqueCrewNames.map(n => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <select
            value={filterLocation}
            onChange={e => setFilterLocation(e.target.value)}
            className="bg-surface-2 border border-t-border rounded-lg px-3 py-2 text-sm"
          >
            <option value="All">All Locations</option>
            {uniqueLocations.map(l => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
          <select
            value={filterDay}
            onChange={e => setFilterDay(e.target.value)}
            className="bg-surface-2 border border-t-border rounded-lg px-3 py-2 text-sm"
          >
            <option value="All">All Days</option>
            {DAYS.map((d, i) => (
              <option key={i} value={i}>{d}</option>
            ))}
          </select>
        </div>

        {/* Table */}
        <div className="bg-surface border border-t-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-t-border bg-surface/50">
                  <th className="text-left px-4 py-3 text-muted font-medium">Crew Member</th>
                  <th className="text-left px-4 py-3 text-muted font-medium">Location</th>
                  <th className="text-left px-4 py-3 text-muted font-medium">Day</th>
                  <th className="text-left px-4 py-3 text-muted font-medium">Time Range</th>
                  <th className="text-left px-4 py-3 text-muted font-medium">Job Type</th>
                  <th className="text-left px-4 py-3 text-muted font-medium">TZ</th>
                  <th className="text-center px-4 py-3 text-muted font-medium">Active</th>
                  <th className="text-right px-4 py-3 text-muted font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-muted">
                      {records.length === 0
                        ? "No availability records. Click \"Sync from Code\" to import existing schedules."
                        : "No records match your filters."}
                    </td>
                  </tr>
                ) : (
                  filteredRecords.map(record => (
                    <tr key={record.id} className="border-b border-t-border/50 hover:bg-surface-2/30">
                      <td className="px-4 py-3 font-medium">{record.crewMember.name}</td>
                      <td className="px-4 py-3 text-foreground/80">{record.location}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 bg-surface-2 rounded text-xs">
                          {DAY_ABBREV[record.dayOfWeek]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-foreground/80 text-xs">
                        {formatTimeRange12h(record.startTime, record.endTime)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs ${
                          record.jobType === "survey"
                            ? "bg-blue-900/50 text-blue-300"
                            : record.jobType === "construction"
                            ? "bg-orange-900/50 text-orange-300"
                            : "bg-green-900/50 text-green-300"
                        }`}>
                          {record.jobType}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted text-xs">
                        {record.timezone === "America/Los_Angeles" ? "PT" : "MT"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-block w-2 h-2 rounded-full ${
                          record.isActive ? "bg-green-500" : "bg-zinc-600"
                        }`} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => openBlockNextModal(record)}
                          className="text-amber-400 hover:text-amber-300 text-xs mr-3"
                          title={`Block next ${DAYS[record.dayOfWeek]}`}
                        >
                          Block Next
                        </button>
                        <button
                          onClick={() => openEditModal(record)}
                          className="text-muted hover:text-foreground text-xs mr-3"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(record.id)}
                          className="text-muted hover:text-red-400 text-xs"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Date Overrides Section */}
        {overrides.length > 0 && (
          <div className="mt-8">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <span className="text-amber-400">Blocked Dates</span>
              <span className="text-muted text-sm font-normal">{overrides.length} upcoming</span>
            </h2>
            <div className="bg-surface border border-t-border rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-t-border bg-surface/50">
                      <th className="text-left px-4 py-3 text-muted font-medium">Crew Member</th>
                      <th className="text-left px-4 py-3 text-muted font-medium">Date</th>
                      <th className="text-left px-4 py-3 text-muted font-medium">Day</th>
                      <th className="text-left px-4 py-3 text-muted font-medium">Reason</th>
                      <th className="text-right px-4 py-3 text-muted font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overrides.map(ov => {
                      const d = new Date(ov.date + "T12:00:00");
                      return (
                        <tr key={ov.id} className="border-b border-t-border/50 hover:bg-surface-2/30">
                          <td className="px-4 py-3 font-medium">{ov.crewMember.name}</td>
                          <td className="px-4 py-3 text-foreground/80">{ov.date}</td>
                          <td className="px-4 py-3">
                            <span className="px-2 py-0.5 bg-amber-900/30 text-amber-300 rounded text-xs">
                              {DAY_ABBREV[d.getDay()]}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-muted text-xs">{ov.reason || "—"}</td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => handleDeleteOverride(ov.id)}
                              className="text-muted hover:text-red-400 text-xs"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Block Date Modal */}
      {showOverrideModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-surface border border-t-border rounded-xl p-6 w-full max-w-md mx-4">
            <h2 className="text-lg font-bold mb-4">Block a Date</h2>
            <p className="text-sm text-muted mb-4">
              Block a crew member from being scheduled on a specific date without affecting their recurring weekly schedule.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-muted mb-1">Crew Member</label>
                <select
                  value={overrideForm.crewMemberId}
                  onChange={e => setOverrideForm(prev => ({ ...prev, crewMemberId: e.target.value }))}
                  className="w-full bg-surface-2 border border-t-border rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">Select crew member...</option>
                  {crewMembers.filter(c => c.isActive).map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm text-muted mb-1">Date</label>
                <input
                  type="date"
                  value={overrideForm.date}
                  onChange={e => setOverrideForm(prev => ({ ...prev, date: e.target.value }))}
                  className="w-full bg-surface-2 border border-t-border rounded-lg px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-sm text-muted mb-1">Reason (optional)</label>
                <input
                  type="text"
                  value={overrideForm.reason}
                  onChange={e => setOverrideForm(prev => ({ ...prev, reason: e.target.value }))}
                  placeholder="PTO, training, appointment..."
                  className="w-full bg-surface-2 border border-t-border rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowOverrideModal(false)}
                className="px-4 py-2 bg-surface-2 hover:bg-surface-2 rounded-lg text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateOverride}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 rounded-lg text-sm font-medium"
              >
                Block Date
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-surface border border-t-border rounded-xl p-6 w-full max-w-md mx-4">
            <h2 className="text-lg font-bold mb-4">
              {editingId ? "Edit Availability Slot" : "Add Availability Slot"}
            </h2>

            <div className="space-y-4">
              {/* Crew Member */}
              <div>
                <label className="block text-sm text-muted mb-1">Crew Member</label>
                <select
                  value={formData.crewMemberId}
                  onChange={e => setFormData(prev => ({ ...prev, crewMemberId: e.target.value }))}
                  className="w-full bg-surface-2 border border-t-border rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">Select crew member...</option>
                  {crewMembers.filter(c => c.isActive).map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              {/* Location */}
              <div>
                <label className="block text-sm text-muted mb-1">Location</label>
                <select
                  value={formData.location}
                  onChange={e => handleLocationChange(e.target.value)}
                  className="w-full bg-surface-2 border border-t-border rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">Select location...</option>
                  {LOCATIONS.map(l => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </div>

              {/* Day of Week */}
              <div>
                <label className="block text-sm text-muted mb-1">Day of Week</label>
                <select
                  value={formData.dayOfWeek}
                  onChange={e => setFormData(prev => ({ ...prev, dayOfWeek: parseInt(e.target.value) }))}
                  className="w-full bg-surface-2 border border-t-border rounded-lg px-3 py-2 text-sm"
                >
                  {DAYS.map((d, i) => (
                    <option key={i} value={i}>{d}</option>
                  ))}
                </select>
              </div>

              {/* Time Range */}
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-sm text-muted mb-1">Start Time</label>
                  <input
                    type="time"
                    value={formData.startTime}
                    onChange={e => setFormData(prev => ({ ...prev, startTime: e.target.value }))}
                    className="w-full bg-surface-2 border border-t-border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-sm text-muted mb-1">End Time</label>
                  <input
                    type="time"
                    value={formData.endTime}
                    onChange={e => setFormData(prev => ({ ...prev, endTime: e.target.value }))}
                    className="w-full bg-surface-2 border border-t-border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>

              {/* Job Type */}
              <div>
                <label className="block text-sm text-muted mb-1">Job Type</label>
                <div className="flex gap-2">
                  {JOB_TYPES.map(type => (
                    <button
                      key={type}
                      onClick={() => setFormData(prev => ({ ...prev, jobType: type }))}
                      className={`px-3 py-1.5 rounded-lg text-sm capitalize ${
                        formData.jobType === type
                          ? "bg-cyan-600 text-white"
                          : "bg-surface-2 text-muted hover:bg-surface-2"
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              {/* Timezone */}
              <div>
                <label className="block text-sm text-muted mb-1">Timezone</label>
                <select
                  value={formData.timezone}
                  onChange={e => setFormData(prev => ({ ...prev, timezone: e.target.value }))}
                  className="w-full bg-surface-2 border border-t-border rounded-lg px-3 py-2 text-sm"
                >
                  <option value="America/Denver">Mountain Time (MT)</option>
                  <option value="America/Los_Angeles">Pacific Time (PT)</option>
                </select>
              </div>

              {/* Active Toggle */}
              <label className="flex items-center justify-between p-3 bg-surface-2 rounded-lg cursor-pointer">
                <span className="text-sm">Active</span>
                <button
                  type="button"
                  onClick={() => setFormData(prev => ({ ...prev, isActive: !prev.isActive }))}
                  className={`relative w-11 h-6 rounded-full transition-colors ${
                    formData.isActive ? "bg-cyan-500" : "bg-zinc-600"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                      formData.isActive ? "translate-x-5" : ""
                    }`}
                  />
                </button>
              </label>
            </div>

            {/* Modal Actions */}
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 bg-surface-2 hover:bg-surface-2 rounded-lg text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {saving ? "Saving..." : editingId ? "Update" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
