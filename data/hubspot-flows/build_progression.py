import json, glob, re, os
from collections import defaultdict

stage_lookup=json.load(open("data/hubspot-flows/_stage_lookup.json"))["stage_lookup"]
_pl=json.load(open("data/hubspot-flows/_prop_labels.json"))
LB=_pl["labels"]; OPTS=_pl["options"]
ACRO={"da":"DA","pto":"PTO","ahj":"AHJ","sla":"SLA","pe":"PE","ic":"IC","rtb":"RTB","qc":"QC","id":"ID"}
def humanize(p): return " ".join(ACRO.get(w.lower(),w.capitalize()) for w in str(p).replace("_"," ").split())
def plabel(p): return LB.get(p) or humanize(p)
def voption(p,v): return (OPTS.get(p) or {}).get(v,v)
def stagelabel(v): return stage_lookup.get(v,[None,None,v])[2] if v in stage_lookup else v

INCLUDE={"IS_ANY_OF","IS_EQUAL_TO","IS_EXACTLY","HAS_EVER_BEEN_ANY_OF","HAS_EVER_BEEN_EQUAL_TO"}
clone_re=re.compile(r'\s*\(#\d+\)\s*$')
def base(n): return clone_re.sub('', n).strip()

# status-ish properties only: enum/string props that drive flow (skip dates, ids, hs_ internals)
SKIP_PROP=lambda p: (p in ("hs_object_id","hs_object_source","hs_name","hs_value","hs_task_subject",
    "hs_task_status","dealstage","hs_pipeline_stage","closedate") or p.endswith("_date") or p.endswith("date")
    or p.startswith("hs_"))

def collect(node,out):
    if isinstance(node,dict):
        if node.get("property") and node.get("operation"): out.append((node["property"],node["operation"]))
        for v in node.values(): collect(v,out)
    elif isinstance(node,list):
        for v in node: collect(v,out)

setters=defaultdict(set)   # (prop,val) -> {flow base names that SET it}
readers=defaultdict(set)   # (prop,val) -> {flow base names that ENROLL on it}

for fp in glob.glob("data/hubspot-flows/detail/*.json"):
    d=json.load(open(fp))
    if d.get("_error") or not d.get("isEnabled"): continue
    nm=base(d.get("name",""))
    # SETS (0-5 static-value actions)
    for a in d.get("actions",[]):
        if a.get("actionTypeId")=="0-5":
            f=a.get("fields") or {}; v=f.get("value",{})
            if isinstance(v,dict) and v.get("type")=="STATIC_VALUE":
                p=f.get("property_name")
                if p and not SKIP_PROP(p): setters[(p,str(v.get("staticValue")))].add(nm)
    # READS (enrollment inclusion filters + event hs_name/hs_value)
    enr=d.get("enrollmentCriteria",{})
    filts=[]; collect(enr.get("listFilterBranch",{}),filts)
    for p,op in filts:
        if SKIP_PROP(p) or op.get("operator") not in INCLUDE: continue
        for v in (op.get("values") or []): readers[(p,str(v))].add(nm)
    # event-based hs_name/hs_value
    for eb in enr.get("eventFilterBranches",[]):
        ef=[]; collect(eb,ef); pn=None; nv=[]
        for p,op in ef:
            if p=="hs_name": pn=op.get("value")
            elif p=="hs_value": nv=op.get("values") or []
        if pn and not SKIP_PROP(pn):
            for v in nv: readers[(pn,str(v))].add(base(d.get("name","")))

# linking pairs: set AND read by something
links=[k for k in setters if k in readers]
# group by property
byprop=defaultdict(list)
for (p,v) in links: byprop[p].append(v)

out=["# Workflow progression map — status-driven cross-flow chains","",
 "**2026-06-21, from live data.** Each row is a status value that **one flow sets** and **another flow fires on** — i.e. a hand-off between workflows. This is the progression engine: how finishing one step flips a status that triggers the next. ON flows only; clones collapsed.","",
 f"{len(links)} linking (property = value) hand-offs across {len(byprop)} status properties.",""]
# order properties by how many linking values they have
for p in sorted(byprop, key=lambda x:-len(byprop[x])):
    vals=byprop[p]
    out.append(f"## {plabel(p)}  (`{p}`)")
    out.append("")
    out.append("| Status value | Set by (upstream flow) | → Fires (downstream flow) |")
    out.append("|---|---|---|")
    def esc(s): return s.replace("|","\\|")
    for v in sorted(vals, key=lambda x:voption(p,x)):
        sb="; ".join(esc(x) for x in sorted(setters[(p,v)])[:4]) or "—"
        rd="; ".join(esc(x) for x in sorted(readers[(p,v)])[:5]) or "—"
        out.append(f"| “{esc(voption(p,v))}” | {sb} | {rd} |")
    out.append("")
open("docs/hubspot-workflow-progression-map.md","w").write("\n".join(out))
print("wrote docs/hubspot-workflow-progression-map.md")
print("linking hand-offs:", len(links), "| status properties:", len(byprop))
print("top properties:", ", ".join(f"{plabel(p)}({len(byprop[p])})" for p in sorted(byprop,key=lambda x:-len(byprop[x]))[:8]))
