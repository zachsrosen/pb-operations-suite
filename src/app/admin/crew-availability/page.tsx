"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";

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

const LOCATION_TIMEZONES: Record<string, string> = {
  Westminster: "America/Denver",
  DTC: "America/Denver",
  "Colorado Springs": "America/Denver",
  "San Luis Obispo": "America/Los_Angeles",
  Camarillo: "America/Los_Angeles",
};

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

  // Filters
  const [filterCrew, setFilterCrew] = useState<string>("All");
  const [filterLocation, setFilterLocation] = useState<string>("All");
  const [filterDay, setFilterDay] = useState<string>("All");

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormData>(DEFAULT_FORM);

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
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
  }, [fetchRecords, fetchCrewMembers]);

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
    if (!confirm("Delete this availability slot?")) return;

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
    if (!confirm("Seed availability from hardcoded schedules? This won't overwrite existing records.")) return;

    setSeeding(true);
    try {
      const response = await fetch("/api/admin/crew-availability/seed", {
        method: "POST",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to seed");
      }

      const data = await response.json();
      showToast(`Seeded: ${data.created} created, ${data.skipped} skipped`);
      fetchRecords();
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSeeding(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 text-xl mb-2">Error</p>
          <p className="text-zinc-500 text-sm mb-4">{error}</p>
          <Link href="/" className="px-4 py-2 bg-zinc-700 rounded-lg hover:bg-zinc-600">
            Go Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 shadow-lg">
          <p className="text-sm">{toast}</p>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link
              href="/admin/users"
              className="text-zinc-500 hover:text-white transition-colors"
            >
              &larr; Admin
            </Link>
            <h1 className="text-2xl font-bold">Crew Availability</h1>
            <span className="text-zinc-500 text-sm">{records.length} slots</span>
          </div>
          <div className="flex items-center gap-3">
            {records.length === 0 && (
              <button
                onClick={handleSeed}
                disabled={seeding}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                {seeding ? "Seeding..." : "Seed from Code"}
              </button>
            )}
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
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
          >
            <option value="All">All Crew</option>
            {uniqueCrewNames.map(n => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <select
            value={filterLocation}
            onChange={e => setFilterLocation(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
          >
            <option value="All">All Locations</option>
            {uniqueLocations.map(l => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
          <select
            value={filterDay}
            onChange={e => setFilterDay(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
          >
            <option value="All">All Days</option>
            {DAYS.map((d, i) => (
              <option key={i} value={i}>{d}</option>
            ))}
          </select>
        </div>

        {/* Table */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900/50">
                  <th className="text-left px-4 py-3 text-zinc-400 font-medium">Crew Member</th>
                  <th className="text-left px-4 py-3 text-zinc-400 font-medium">Location</th>
                  <th className="text-left px-4 py-3 text-zinc-400 font-medium">Day</th>
                  <th className="text-left px-4 py-3 text-zinc-400 font-medium">Time Range</th>
                  <th className="text-left px-4 py-3 text-zinc-400 font-medium">Job Type</th>
                  <th className="text-left px-4 py-3 text-zinc-400 font-medium">TZ</th>
                  <th className="text-center px-4 py-3 text-zinc-400 font-medium">Active</th>
                  <th className="text-right px-4 py-3 text-zinc-400 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-zinc-500">
                      {records.length === 0
                        ? "No availability records. Click \"Seed from Code\" to import existing schedules."
                        : "No records match your filters."}
                    </td>
                  </tr>
                ) : (
                  filteredRecords.map(record => (
                    <tr key={record.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                      <td className="px-4 py-3 font-medium">{record.crewMember.name}</td>
                      <td className="px-4 py-3 text-zinc-300">{record.location}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 bg-zinc-800 rounded text-xs">
                          {DAY_ABBREV[record.dayOfWeek]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-zinc-300 font-mono text-xs">
                        {record.startTime} - {record.endTime}
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
                      <td className="px-4 py-3 text-zinc-500 text-xs">
                        {record.timezone === "America/Los_Angeles" ? "PT" : "MT"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-block w-2 h-2 rounded-full ${
                          record.isActive ? "bg-green-500" : "bg-zinc-600"
                        }`} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => openEditModal(record)}
                          className="text-zinc-400 hover:text-white text-xs mr-3"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(record.id)}
                          className="text-zinc-500 hover:text-red-400 text-xs"
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
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-md mx-4">
            <h2 className="text-lg font-bold mb-4">
              {editingId ? "Edit Availability Slot" : "Add Availability Slot"}
            </h2>

            <div className="space-y-4">
              {/* Crew Member */}
              <div>
                <label className="block text-sm text-zinc-400 mb-1">Crew Member</label>
                <select
                  value={formData.crewMemberId}
                  onChange={e => setFormData(prev => ({ ...prev, crewMemberId: e.target.value }))}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">Select crew member...</option>
                  {crewMembers.filter(c => c.isActive).map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              {/* Location */}
              <div>
                <label className="block text-sm text-zinc-400 mb-1">Location</label>
                <select
                  value={formData.location}
                  onChange={e => handleLocationChange(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">Select location...</option>
                  {LOCATIONS.map(l => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </div>

              {/* Day of Week */}
              <div>
                <label className="block text-sm text-zinc-400 mb-1">Day of Week</label>
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
                  <label className="block text-sm text-zinc-400 mb-1">Start Time</label>
                  <input
                    type="time"
                    value={formData.startTime}
                    onChange={e => setFormData(prev => ({ ...prev, startTime: e.target.value }))}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-sm text-zinc-400 mb-1">End Time</label>
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
                <label className="block text-sm text-zinc-400 mb-1">Job Type</label>
                <div className="flex gap-2">
                  {JOB_TYPES.map(type => (
                    <button
                      key={type}
                      onClick={() => setFormData(prev => ({ ...prev, jobType: type }))}
                      className={`px-3 py-1.5 rounded-lg text-sm capitalize ${
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
                <label className="block text-sm text-zinc-400 mb-1">Timezone</label>
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
              <label className="flex items-center justify-between p-3 bg-zinc-800 rounded-lg cursor-pointer">
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
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm"
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
