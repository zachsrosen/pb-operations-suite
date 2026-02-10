"use client";

import React, { useState, useEffect, useCallback } from "react";

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

const LOCATION_TIMEZONES: Record<string, string> = {
  Westminster: "America/Denver",
  DTC: "America/Denver",
  "Colorado Springs": "America/Denver",
  "San Luis Obispo": "America/Los_Angeles",
  Camarillo: "America/Los_Angeles",
};

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

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/zuper/my-availability");
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to fetch");
      }
      const data = await response.json();
      setCrewMember(data.crewMember);
      setRecords(data.records || []);
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

  // Sort records by day of week, then start time
  const sortedRecords = [...records].sort((a, b) => {
    if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
    return a.startTime.localeCompare(b.startTime);
  });

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
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-cyan-500" />
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          ) : sortedRecords.length === 0 ? (
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
            <div className="space-y-2">
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
                        <span className="text-zinc-500 ml-2 font-mono text-xs">
                          {record.startTime} - {record.endTime}
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
        </div>

        {/* Footer */}
        {!loading && !error && sortedRecords.length > 0 && (
          <div className="px-5 py-3 border-t border-zinc-800">
            <button
              onClick={openAddForm}
              className="w-full px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm font-medium transition-colors"
            >
              + Add Slot
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
    </div>
  );
}
