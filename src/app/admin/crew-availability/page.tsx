"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { formatTimeRange12h } from "@/lib/format";
import { LOCATION_TIMEZONES } from "@/lib/constants";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";
import { AdminPageHeader } from "@/components/admin-shell/AdminPageHeader";
import { AdminFilterBar, FilterSearch, DateRangeChip } from "@/components/admin-shell/AdminFilterBar";
import { AdminTable, type AdminTableColumn } from "@/components/admin-shell/AdminTable";
import { AdminDetailDrawer } from "@/components/admin-shell/AdminDetailDrawer";
import { AdminDetailHeader } from "@/components/admin-shell/AdminDetailHeader";
import { AdminEmpty } from "@/components/admin-shell/AdminEmpty";
import { AdminError } from "@/components/admin-shell/AdminError";
import { FormField, FormSelect, FormToggle } from "@/components/admin-shell/AdminForm";

// ── Types ─────────────────────────────────────────────────────────────────

interface CrewMember { id: string; name: string; isActive: boolean; }

interface AvailabilityRecord {
  id: string; crewMemberId: string; location: string; reportLocation: string | null;
  jobType: string; dayOfWeek: number; startTime: string; endTime: string;
  timezone: string; isActive: boolean; crewMember: { name: string; isActive: boolean };
}

interface OverrideRecord {
  id: string; crewMemberId: string; date: string; availabilityId: string | null;
  type: string; reason: string | null; startTime: string | null; endTime: string | null;
  crewMember: { name: string; isActive: boolean };
}

interface SlotForm {
  crewMemberId: string; location: string; reportLocation: string;
  jobType: string; dayOfWeek: string; startTime: string; endTime: string;
  timezone: string; isActive: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────

const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const DAY_ABBREV = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const LOCATIONS = ["Westminster","DTC","Colorado Springs","San Luis Obispo","Camarillo"];
const JOB_TYPES = ["survey","construction","inspection"];
const LOCATION_OPTIONS = LOCATIONS.map((l) => ({ value: l, label: l }));
const DAY_OPTS = [
  { value: "all", label: "All" },
  ...DAYS.map((d, i) => ({ value: String(i), label: d.slice(0,3) })),
] as const;
const JOB_COLORS: Record<string, string> = {
  survey: "bg-blue-900/50 text-blue-300",
  construction: "bg-orange-900/50 text-orange-300",
  inspection: "bg-green-900/50 text-green-300",
};
const DEFAULT_FORM: SlotForm = {
  crewMemberId:"", location:"", reportLocation:"", jobType:"survey",
  dayOfWeek:"1", startTime:"08:00", endTime:"12:00", timezone:"America/Denver", isActive:true,
};
const TIME_INPUT_CLS = "rounded-md border border-t-border/60 bg-surface-2 px-3 py-1.5 text-sm text-foreground focus:border-t-border focus:outline-none w-full";

// ── Helpers ───────────────────────────────────────────────────────────────

function nextDateForDay(dow: number): string {
  const today = new Date();
  let d = dow - today.getDay();
  if (d <= 0) d += 7;
  const next = new Date(today);
  next.setDate(today.getDate() + d);
  return next.toISOString().split("T")[0];
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function CrewAvailabilityPage() {
  const [records, setRecords] = useState<AvailabilityRecord[]>([]);
  const [crew, setCrew] = useState<CrewMember[]>([]);
  const [overrides, setOverrides] = useState<OverrideRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [seedingTeams, setSeedingTeams] = useState(false);

  // Drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SlotForm>(DEFAULT_FORM);
  const [drawerKey, setDrawerKey] = useState(0);

  // Override modal
  const [showOvModal, setShowOvModal] = useState(false);
  const [ovForm, setOvForm] = useState({ crewMemberId:"", date:"", reason:"" });

  // Confirm
  const [confirm, setConfirm] = useState<{ open:boolean; title:string; message:string; variant?:"danger"|"default"; confirmLabel?:string } | null>(null);
  const pendingConfirm = useRef<(()=>void)|null>(null);

  // Filters
  const [filterLocs, setFilterLocs] = useState<string[]>([]);
  const [filterCrew, setFilterCrew] = useState("");
  const [filterDay, setFilterDay] = useState("all");

  // ── Utils ─────────────────────────────────────────────────────────────────

  const toast$ = (msg: string, ms = 5000) => { setToast(msg); setTimeout(() => setToast(null), ms); };

  const openConfirm = (title: string, msg: string, cb: ()=>void, opts?: { variant?:"danger"|"default"; confirmLabel?:string }) => {
    pendingConfirm.current = cb;
    setConfirm({ open:true, title, message:msg, ...opts });
  };
  const closeConfirm = () => { pendingConfirm.current = null; setConfirm(null); };

  // ── Fetch ─────────────────────────────────────────────────────────────────

  const fetchRecords = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/admin/crew-availability");
      if (!res.ok) throw new Error((await res.json()).error || "Failed to fetch");
      setRecords((await res.json()).records || []);
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Unknown error"); }
    finally { setLoading(false); }
  }, []);

  const fetchCrew = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/crew");
      if (res.ok) setCrew((await res.json()).crew || []);
    } catch { /* non-critical */ }
  }, []);

  const fetchOverrides = useCallback(async () => {
    try {
      const today = new Date().toISOString().split("T")[0];
      const res = await fetch(`/api/admin/crew-availability/overrides?dateFrom=${today}`);
      if (res.ok) setOverrides((await res.json()).records || []);
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => { fetchRecords(); fetchCrew(); fetchOverrides(); }, [fetchRecords, fetchCrew, fetchOverrides]);

  // ── Filters ───────────────────────────────────────────────────────────────

  const filtered = records.filter((r) => {
    if (filterLocs.length > 0 && !filterLocs.includes(r.location)) return false;
    if (filterCrew.trim() && !r.crewMember.name.toLowerCase().includes(filterCrew.toLowerCase())) return false;
    if (filterDay !== "all" && r.dayOfWeek !== parseInt(filterDay)) return false;
    return true;
  });
  const hasFilters = filterLocs.length > 0 || filterCrew.trim() !== "" || filterDay !== "all";

  // ── Slot CRUD ─────────────────────────────────────────────────────────────

  const openAdd = () => { setEditingId(null); setForm(DEFAULT_FORM); setDrawerKey(k=>k+1); setDrawerOpen(true); };
  const openEdit = (r: AvailabilityRecord) => {
    setEditingId(r.id);
    setForm({ crewMemberId:r.crewMemberId, location:r.location, reportLocation:r.reportLocation||r.location,
      jobType:r.jobType, dayOfWeek:String(r.dayOfWeek), startTime:r.startTime, endTime:r.endTime,
      timezone:r.timezone, isActive:r.isActive });
    setDrawerKey(k=>k+1);
    setDrawerOpen(true);
  };

  const handleSave = async () => {
    if (!form.crewMemberId || !form.location || !form.startTime || !form.endTime) { toast$("Please fill in all required fields"); return; }
    setSaving(true);
    try {
      const payload = { ...form, dayOfWeek: parseInt(form.dayOfWeek) };
      const res = await fetch("/api/admin/crew-availability", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify(editingId ? { id:editingId, ...payload } : payload),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to save");
      toast$(editingId ? "Slot updated" : "Slot created");
      setDrawerOpen(false);
      fetchRecords();
    } catch (e) { toast$(`Error: ${e instanceof Error ? e.message : "Unknown error"}`); }
    finally { setSaving(false); }
  };

  const handleDelete = (id: string) =>
    openConfirm("Delete slot","Delete this availability slot?", async () => {
      try {
        const res = await fetch("/api/admin/crew-availability", { method:"DELETE", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ id }) });
        if (!res.ok) throw new Error((await res.json()).error || "Failed to delete");
        toast$("Slot deleted"); fetchRecords();
      } catch (e) { toast$(`Error: ${e instanceof Error ? e.message : "Unknown error"}`); }
    }, { variant:"danger", confirmLabel:"Delete" });

  // ── Seed actions ──────────────────────────────────────────────────────────

  const handleSeed = () =>
    openConfirm("Seed schedules","Seed crew members and availability from hardcoded schedules? This won't overwrite existing records.", async () => {
      setSeeding(true);
      try {
        const crewRes = await fetch("/api/admin/crew?action=seed", { method:"POST" });
        let crewData; try { crewData = await crewRes.json(); } catch { crewData = null; }
        if (!crewRes.ok) throw new Error(crewData?.error || `Crew seed failed (${crewRes.status})`);
        const res = await fetch("/api/admin/crew-availability/seed", { method:"POST" });
        let data; try { data = await res.json(); } catch { data = null; }
        if (!res.ok) throw new Error(data?.error || `Availability seed failed (${res.status})`);
        const errMsg = data?.errors?.length ? ` (${data.errors.join(", ")})` : "";
        toast$(`${crewData?.results?.length||0} crew synced, ${data?.created||0} slots created, ${data?.skipped||0} skipped${errMsg}`, 8000);
        fetchRecords(); fetchCrew();
      } catch (e) { toast$(`Error: ${e instanceof Error ? e.message : "Unknown error"}`, 10000); }
      finally { setSeeding(false); }
    });

  const handleSeedTeams = () =>
    openConfirm("Seed teams","Seed DTC & Westminster crew teams from Zuper? This will resolve Zuper UIDs and create user accounts.", async () => {
      setSeedingTeams(true);
      try {
        const res = await fetch("/api/admin/crew?action=seed-teams", { method:"POST" });
        let data; try { data = await res.json(); } catch { throw new Error(`Server returned ${res.status}: ${res.statusText}`); }
        if (!res.ok) throw new Error(data.error || data.details || `Failed (${res.status})`);
        toast$(data.message || "Teams seeded successfully", 8000);
        fetchRecords(); fetchCrew();
      } catch (e) { toast$(`Error: ${e instanceof Error ? e.message : "Unknown error"}`, 10000); }
      finally { setSeedingTeams(false); }
    });

  // ── Override CRUD ─────────────────────────────────────────────────────────

  const openBlockNext = (r: AvailabilityRecord) => {
    setOvForm({ crewMemberId:r.crewMemberId, date:nextDateForDay(r.dayOfWeek), reason:"" });
    setShowOvModal(true);
  };

  const handleCreateOverride = async () => {
    if (!ovForm.crewMemberId || !ovForm.date) { toast$("Crew member and date are required"); return; }
    try {
      const res = await fetch("/api/admin/crew-availability/overrides", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ crewMemberId:ovForm.crewMemberId, date:ovForm.date, type:"blocked", reason:ovForm.reason||null }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to create");
      toast$("Date blocked"); setShowOvModal(false); setOvForm({ crewMemberId:"", date:"", reason:"" }); fetchOverrides();
    } catch (e) { toast$(`Error: ${e instanceof Error ? e.message : "Unknown error"}`); }
  };

  const handleDeleteOverride = (id: string) =>
    openConfirm("Remove block","Remove this date block?", async () => {
      try {
        const res = await fetch("/api/admin/crew-availability/overrides", { method:"DELETE", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ id }) });
        if (!res.ok) throw new Error((await res.json()).error || "Failed to delete");
        toast$("Block removed"); fetchOverrides();
      } catch (e) { toast$(`Error: ${e instanceof Error ? e.message : "Unknown error"}`); }
    }, { variant:"danger", confirmLabel:"Remove" });

  // ── Table columns ─────────────────────────────────────────────────────────

  const slotCols: AdminTableColumn<AvailabilityRecord>[] = [
    { key:"name", label:"Crew Member", render:(r) => <span className="font-medium">{r.crewMember.name}</span> },
    { key:"location", label:"Location", render:(r) => <span className="text-xs text-foreground/80">{r.location}</span> },
    { key:"jobType", label:"Job Type", render:(r) => (
      <span className={`px-2 py-0.5 rounded text-xs capitalize ${JOB_COLORS[r.jobType]??"bg-surface-2 text-muted"}`}>{r.jobType}</span>
    )},
    { key:"dayTime", label:"Days & Hours", render:(r) => (
      <span className="text-xs text-muted whitespace-nowrap">
        <span className="px-1.5 py-0.5 bg-surface-2 rounded mr-1.5">{DAY_ABBREV[r.dayOfWeek]}</span>
        {formatTimeRange12h(r.startTime, r.endTime)}
        <span className="ml-1.5 text-muted/60">{r.timezone==="America/Los_Angeles"?"PT":"MT"}</span>
      </span>
    )},
    { key:"active", label:"Active", align:"center", width:"w-16", render:(r) => (
      <span className={`inline-block w-2 h-2 rounded-full ${r.isActive?"bg-green-500":"bg-zinc-600"}`} />
    )},
    { key:"actions", label:"", align:"right", width:"w-44", render:(r) => (
      <div className="flex items-center justify-end gap-3" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={() => openBlockNext(r)} className="text-amber-400 hover:text-amber-300 text-xs" title={`Block next ${DAYS[r.dayOfWeek]}`}>Block Next</button>
        <button type="button" onClick={() => openEdit(r)} className="text-muted hover:text-foreground text-xs">Edit</button>
        <button type="button" onClick={() => handleDelete(r.id)} className="text-muted hover:text-red-400 text-xs">Delete</button>
      </div>
    )},
  ];

  const overrideCols: AdminTableColumn<OverrideRecord>[] = [
    { key:"name", label:"Crew Member", render:(r) => <span className="font-medium">{r.crewMember.name}</span> },
    { key:"date", label:"Date", render:(r) => <span className="text-xs text-foreground/80">{r.date}</span> },
    { key:"day", label:"Day", width:"w-16", render:(r) => {
      const d = new Date(r.date+"T12:00:00");
      return <span className="px-2 py-0.5 bg-amber-900/30 text-amber-300 rounded text-xs">{DAY_ABBREV[d.getDay()]}</span>;
    }},
    { key:"reason", label:"Reason", render:(r) => <span className="text-xs text-muted">{r.reason??"—"}</span> },
    { key:"rm", label:"", align:"right", width:"w-20", render:(r) => (
      <button type="button" onClick={(e)=>{e.stopPropagation();handleDeleteOverride(r.id);}} className="text-muted hover:text-red-400 text-xs">Remove</button>
    )},
  ];

  // ── Drawer form helpers ───────────────────────────────────────────────────

  const crewOpts = [{ value:"", label:"Select crew member..." }, ...crew.filter(c=>c.isActive).map(c=>({ value:c.id, label:c.name }))];
  const locationOpts = [{ value:"", label:"Select location..." }, ...LOCATION_OPTIONS];
  const dayOpts = DAYS.map((d,i)=>({ value:String(i), label:d }));
  const tzOpts = [{ value:"America/Denver", label:"Mountain Time (MT)" }, { value:"America/Los_Angeles", label:"Pacific Time (PT)" }];

  const handleLocChange = (loc: string) =>
    setForm(p => ({ ...p, location:loc, reportLocation:loc, timezone:LOCATION_TIMEZONES[loc]??"America/Denver" }));

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      {confirm && (
        <ConfirmDialog
          open={confirm.open} title={confirm.title} message={confirm.message}
          variant={confirm.variant} confirmLabel={confirm.confirmLabel}
          onConfirm={()=>{ pendingConfirm.current?.(); closeConfirm(); }} onCancel={closeConfirm}
        />
      )}

      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-surface-2 border border-t-border rounded-lg px-4 py-3 shadow-lg">
          <p className="text-sm">{toast}</p>
        </div>
      )}

      <AdminPageHeader
        title="Crew Availability"
        breadcrumb={["Admin","Operations","Crew availability"]}
        subtitle={`${records.length} slots`}
        actions={
          <>
            <button type="button" onClick={handleSeed} disabled={seeding}
              className="px-4 py-2 bg-surface-2 hover:bg-surface-elevated rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
              {seeding ? "Seeding..." : "Sync from Code"}
            </button>
            <button type="button" onClick={handleSeedTeams} disabled={seedingTeams}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
              {seedingTeams ? "Seeding Teams..." : "Seed Teams"}
            </button>
            <button type="button" onClick={()=>{ setOvForm({ crewMemberId:"", date:"", reason:"" }); setShowOvModal(true); }}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-500 rounded-lg text-sm font-medium transition-colors">
              Block Date
            </button>
            <button type="button" onClick={openAdd}
              className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm font-medium transition-colors">
              + Add Slot
            </button>
          </>
        }
      />

      <div className="mb-4">
        <AdminFilterBar hasActiveFilters={hasFilters} onClearAll={()=>{ setFilterLocs([]); setFilterCrew(""); setFilterDay("all"); }}>
          <MultiSelectFilter label="Location" options={LOCATION_OPTIONS} selected={filterLocs} onChange={setFilterLocs} placeholder="All Locations" accentColor="cyan" />
          <DateRangeChip label="Day" selected={filterDay} options={DAY_OPTS} onChange={setFilterDay} />
          <FilterSearch value={filterCrew} onChange={setFilterCrew} placeholder="Search crew…" widthClass="w-40" />
        </AdminFilterBar>
      </div>

      <AdminTable<AvailabilityRecord>
        caption="Crew availability slots"
        rows={filtered}
        rowKey={(r)=>r.id}
        columns={slotCols}
        loading={loading}
        error={error ? <AdminError error={error} onRetry={fetchRecords} /> : undefined}
        empty={
          <AdminEmpty
            label={records.length===0 ? "No availability records" : "No records match your filters"}
            description={records.length===0 ? 'Click "Sync from Code" to import schedules' : "Try adjusting your filters"}
          />
        }
        onRowClick={openEdit}
      />

      {overrides.length > 0 && (
        <div className="mt-8">
          <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
            <span className="text-amber-400">Blocked Dates</span>
            <span className="text-muted text-sm font-normal">{overrides.length} upcoming</span>
          </h2>
          <AdminTable<OverrideRecord>
            caption="Upcoming blocked dates"
            rows={overrides} rowKey={(r)=>r.id} columns={overrideCols}
            empty={<AdminEmpty label="No blocked dates" />}
          />
        </div>
      )}

      {/* Slot drawer */}
      <AdminDetailDrawer open={drawerOpen} onClose={()=>setDrawerOpen(false)} title="" wide>
        <div key={drawerKey} className="space-y-4">
          <AdminDetailHeader
            title={editingId ? "Edit Availability Slot" : "New Availability Slot"}
            subtitle={editingId ? "Update recurring schedule" : "Add a recurring weekly slot"}
          />

          <FormSelect label="Crew Member" value={form.crewMemberId} onChange={(v)=>setForm(p=>({...p,crewMemberId:v}))} options={crewOpts} />
          <FormSelect label="Location" value={form.location} onChange={handleLocChange} options={locationOpts} />
          <FormSelect label="Day of Week" value={form.dayOfWeek} onChange={(v)=>setForm(p=>({...p,dayOfWeek:v}))} options={dayOpts} />

          <div className="flex gap-3">
            <FormField label="Start Time" required>
              <input type="time" value={form.startTime} onChange={(e)=>setForm(p=>({...p,startTime:e.target.value}))} className={TIME_INPUT_CLS} />
            </FormField>
            <FormField label="End Time" required>
              <input type="time" value={form.endTime} onChange={(e)=>setForm(p=>({...p,endTime:e.target.value}))} className={TIME_INPUT_CLS} />
            </FormField>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-foreground">Job Type</span>
            <div className="flex gap-2">
              {JOB_TYPES.map((t) => (
                <button key={t} type="button" onClick={()=>setForm(p=>({...p,jobType:t}))}
                  className={`px-3 py-1.5 rounded-lg text-sm capitalize ${form.jobType===t?"bg-cyan-600 text-white":"bg-surface-2 text-muted hover:text-foreground"}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          <FormSelect label="Timezone" value={form.timezone} onChange={(v)=>setForm(p=>({...p,timezone:v}))} options={tzOpts} />
          <FormToggle label="Active" checked={form.isActive} onChange={(v)=>setForm(p=>({...p,isActive:v}))} />

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={()=>setDrawerOpen(false)} className="px-4 py-2 bg-surface-2 hover:bg-surface-elevated rounded-lg text-sm">Cancel</button>
            <button type="button" onClick={handleSave} disabled={saving} className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm font-medium disabled:opacity-50">
              {saving ? "Saving..." : editingId ? "Update" : "Create"}
            </button>
          </div>
        </div>
      </AdminDetailDrawer>

      {/* Block Date modal */}
      {showOvModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-surface border border-t-border rounded-xl p-6 w-full max-w-md mx-4">
            <h2 className="text-lg font-bold mb-2">Block a Date</h2>
            <p className="text-sm text-muted mb-4">Block a crew member from being scheduled on a specific date without affecting their recurring weekly schedule.</p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">Crew Member</label>
                <select value={ovForm.crewMemberId} onChange={(e)=>setOvForm(p=>({...p,crewMemberId:e.target.value}))}
                  className="w-full rounded-md border border-t-border/60 bg-surface-2 px-3 py-1.5 text-sm text-foreground focus:outline-none">
                  <option value="">Select crew member...</option>
                  {crew.filter(c=>c.isActive).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">Date</label>
                <input type="date" value={ovForm.date} onChange={(e)=>setOvForm(p=>({...p,date:e.target.value}))}
                  className="w-full rounded-md border border-t-border/60 bg-surface-2 px-3 py-1.5 text-sm text-foreground focus:outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">Reason (optional)</label>
                <input type="text" value={ovForm.reason} onChange={(e)=>setOvForm(p=>({...p,reason:e.target.value}))}
                  placeholder="PTO, training, appointment..."
                  className="w-full rounded-md border border-t-border/60 bg-surface-2 px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none" />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button type="button" onClick={()=>setShowOvModal(false)} className="px-4 py-2 bg-surface-2 hover:bg-surface-elevated rounded-lg text-sm">Cancel</button>
              <button type="button" onClick={handleCreateOverride} className="px-4 py-2 bg-amber-600 hover:bg-amber-500 rounded-lg text-sm font-medium">Block Date</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
