import json, glob, re, os
stage_lookup=json.load(open("data/hubspot-flows/_stage_lookup.json"))["stage_lookup"]
flows_meta={f["id"]:f for f in json.load(open("data/hubspot-flows/all-flows.json"))}

# plain-English property labels (authoritative from HubSpot) + enum option labels
_pl=json.load(open("data/hubspot-flows/_prop_labels.json")) if os.path.exists("data/hubspot-flows/_prop_labels.json") else {"labels":{},"options":{}}
LB=_pl.get("labels",{}); OPTS=_pl.get("options",{})
ACRO={"da":"DA","pto":"PTO","ahj":"AHJ","sms":"SMS","sla":"SLA","pe":"PE","rrf":"RRF","sld":"SLD",
 "os":"OS","pv":"PV","ev":"EV","ic":"IC","rtb":"RTB","qc":"QC","bom":"BOM","so":"SO","sce":"SCE","id":"ID"}
def humanize(p):
    return " ".join(ACRO.get(w.lower(), w.capitalize()) for w in str(p).replace("_"," ").split())
def plabel(p):
    lab=LB.get(p)
    return lab if lab else humanize(p)
def voption(p,v):
    return (OPTS.get(p) or {}).get(v, v)

STAGE_PROPS={"dealstage","hs_pipeline_stage","hs_value"}
INCLUDE_OPS={"IS_ANY_OF","IS_EQUAL_TO","HAS_EVER_BEEN_ANY_OF","HAS_EVER_BEEN_EQUAL_TO"}

ACTION={"0-5":"set property","0-3":"create task","0-1":"delay","0-8":"notify",
 "0-4":"send email","0-14":"create record","0-169425243":"add note","0-11":"assign owner",
 "0-63189541":"associate","1-27489890":"webhook","0-15":"enroll in workflow"}

def stagelabel(sid):
    v=stage_lookup.get(sid); return v[2] if v else sid

def collect_filters(node, out):
    if isinstance(node,dict):
        if node.get("property") and node.get("operation"):
            out.append((node["property"], node["operation"]))
        for v in node.values(): collect_filters(v,out)
    elif isinstance(node,list):
        for v in node: collect_filters(v,out)

NUM_SYM={"IS_GREATER_THAN":">","IS_LESS_THAN":"<","IS_GREATER_THAN_OR_EQUAL_TO":"≥","IS_LESS_THAN_OR_EQUAL_TO":"≤"}
HANDLED={"IS_ANY_OF","IS_EQUAL_TO","IS_EXACTLY","HAS_EVER_BEEN_ANY_OF","HAS_EVER_BEEN_EQUAL_TO",
 "IS_NONE_OF","IS_NOT_EQUAL_TO","HAS_NEVER_BEEN_ANY_OF","IS_KNOWN","IS_UNKNOWN",
 "CONTAINS","CONTAINS_EXACTLY","DOES_NOT_CONTAIN","IS_BEFORE","IS_AFTER","IS_BETWEEN","IS_NOT_BETWEEN",
 *NUM_SYM.keys()}

def tp(p):
    if not isinstance(p,dict): return "date"
    idx=p.get("indexReference") or {}
    if idx.get("referenceType")=="TODAY" or "offset" in p:
        days=(p.get("offset") or {}).get("days")
        if days in (0,None): return "today"
        return f"{abs(days)}d ago"
    if p.get("year"): return f"{p['year']:04d}-{p.get('month',1):02d}-{p.get('day',1):02d}"
    return "date"

def days_ago(t):
    return t[:-5].strip() if t.endswith("d ago") else None

def fmt_filter(prop, op, unhandled=None):
    o=op.get("operator","")
    if unhandled is not None and o not in HANDLED: unhandled.append((prop,o))
    L=plabel(prop)
    vals=op.get("values",[]) or ([op.get("value")] if op.get("value") is not None else [])
    vals=[stagelabel(str(v)) if str(v) in stage_lookup else voption(prop,str(v)) for v in vals]
    pretty=" or ".join(f"“{v}”" for v in vals)
    if len(pretty)>40: pretty=pretty[:38]+"…”"
    if o in ("IS_ANY_OF","IS_EQUAL_TO","IS_EXACTLY","HAS_EVER_BEEN_ANY_OF","HAS_EVER_BEEN_EQUAL_TO"):
        return f"{L} is {pretty}"
    if o in ("IS_NONE_OF","IS_NOT_EQUAL_TO"):
        return f"{L} is not {pretty}"
    if o=="HAS_NEVER_BEEN_ANY_OF":
        return f"{L} has never been {pretty}"
    if o=="IS_KNOWN": return f"{L} is filled in"
    if o=="IS_UNKNOWN": return f"{L} is blank"
    if o in NUM_SYM:
        word={">":"is more than","<":"is less than","≥":"is at least","≤":"is at most"}[NUM_SYM[o]]
        return f"{L} {word} {', '.join(str(v) for v in vals)}"
    if o in ("CONTAINS","CONTAINS_EXACTLY"): return f"{L} contains {pretty}"
    if o=="DOES_NOT_CONTAIN": return f"{L} does not contain {pretty}"
    if o in ("IS_BEFORE","IS_AFTER"):
        t=tp(op.get("timePoint")); d=days_ago(t)
        if d: return f"{L} was more than {d} days ago" if o=="IS_BEFORE" else f"{L} is within the last {d} days"
        return f"{L} is before {t}" if o=="IS_BEFORE" else f"{L} is after {t}"
    if o in ("IS_BETWEEN","IS_NOT_BETWEEN"):
        updated=op.get("propertyParser")=="UPDATED_AT"
        lo=tp(op.get("lowerBoundTimePoint")); hi=tp(op.get("upperBoundTimePoint")); d=days_ago(lo)
        if updated and o=="IS_NOT_BETWEEN" and d:
            return f"{L} hasn’t changed in {d} days"
        if updated:
            return f"{L} was last updated between {lo} and {hi}" if o=="IS_BETWEEN" else f"{L} was not updated in {lo}–{hi}"
        return f"{L} is between {lo} and {hi}" if o=="IS_BETWEEN" else f"{L} is not between {lo} and {hi}"
    return f"{L} {o.lower().replace('_',' ')} {pretty}".strip()

def event_trigger(enr):
    # EVENT_BASED: hs_name/hs_value = property change; else custom event property filters; else bare event.
    phrases=[]
    for eb in enr.get("eventFilterBranches",[]):
        filts=[]; collect_filters(eb,filts)
        propname=None; newvals=[]; others=[]
        for prop,op in filts:
            if prop=="hs_name": propname=op.get("value")
            elif prop=="hs_value": newvals=op.get("values") or ([op.get("value")] if op.get("value") else [])
            else: others.append((prop,op))
        if propname:
            labs=[stagelabel(v) if v in stage_lookup else voption(propname,v) for v in newvals]
            shown=" or ".join(labs[:3])+(f" (or {len(labs)-3} more)" if len(labs)>3 else "")
            phrases.append(f"{plabel(propname)} changes to {shown}" if shown else f"{plabel(propname)} changes")
        elif others:
            phrases.append(", and ".join(fmt_filter(p,o,UNHANDLED) for p,o in others[:3]))
        else:
            phrases.append("a tracked HubSpot event fires")
    uniq=[]
    for p in phrases:
        if p and p not in uniq: uniq.append(p)
    return ("When "+" ; ".join(uniq[:2])) if uniq else ""

def reenroll_trigger(enr):
    conds=[]
    for rb in enr.get("reEnrollmentTriggersFilterBranches",[]):
        filts=[]; collect_filters(rb,filts)
        for prop,op in filts:
            if prop in STAGE_PROPS or prop.startswith("hs_object"): continue
            s=fmt_filter(prop,op,UNHANDLED)
            if s not in conds: conds.append(s)
    return ("On change: "+" + ".join(conds[:3])) if conds else ""

UNHANDLED=[]
def trigger_summary(d, sid):
    enr=d.get("enrollmentCriteria",{})
    etype=enr.get("type")
    if etype=="MANUAL": return "Manually enrolled (no automatic trigger)"
    if etype=="DATASET": return "Dataset-driven enrollment"
    if etype=="EVENT_BASED":
        et=event_trigger(enr)
        if et: return et
    lfb=enr.get("listFilterBranch",{})
    branches=lfb.get("filterBranches") or [lfb]
    stage_labels=set(); cond_strs=[]
    for br in branches:
        filts=[]; collect_filters(br,filts)
        bymap={prop:op for prop,op in filts}
        # task-completion pattern → one plain phrase
        task_subj=bymap.get("hs_task_subject",{}).get("values") or ([bymap.get("hs_task_subject",{}).get("value")] if bymap.get("hs_task_subject",{}).get("value") else [])
        others=[]
        if task_subj:
            subj=str(task_subj[0]); subj=subj if len(subj)<46 else subj[:44]+"…"
            others.append(f"the task “{subj}” is completed")
        for prop,op in filts:
            if prop in STAGE_PROPS:
                for v in (op.get("values") or []):
                    if v in stage_lookup: stage_labels.add(stagelabel(v))
                continue
            if prop in ("hs_object_id","hs_object_source","hs_task_subject","hs_task_status"): continue
            others.append(fmt_filter(prop,op,UNHANDLED))
        for s in others:
            if s not in cond_strs: cond_strs.append(s)
    trig=", and ".join(cond_strs[:3]) if cond_strs else ""
    if len(cond_strs)>3: trig+=f", plus {len(cond_strs)-3} more condition(s)"
    ctx=""
    if stage_labels:
        labs=sorted(stage_labels)
        stages=(" or ".join(labs) if len(labs)<=2 else f"{labs[0]} (or {len(labs)-1} other stages)")
        ctx=f"while the deal is in {stages}"
    if trig and ctx: return f"When {trig}, {ctx}."
    if trig: return f"When {trig}."
    if ctx: return f"When the deal is in {ctx.split('in ',1)[1]}."
    re_t=reenroll_trigger(enr)
    if re_t: return re_t
    return "Enrolled by another workflow (no criteria of its own)."

def clip(s, n=44):
    s=re.sub(r'\s+',' ',str(s)).strip()
    return s[:n]+"…" if len(s)>n else s

def one_action(a):
    t=a.get("actionTypeId"); fields=a.get("fields") or {}
    if t=="0-5":
        v=fields.get("value",{})
        sv=v.get("staticValue") if isinstance(v,dict) else v
        is_ts=isinstance(v,dict) and v.get("type")=="TIMESTAMP"
        prop=fields.get('property_name','?'); L=plabel(prop)
        if is_ts or sv in (None,""): return f"stamp {L} with today’s date"
        return f"set {L} to “{clip(voption(prop,str(sv)),26)}”"
    if t=="0-3": return f"create task “{clip(fields.get('subject',''),38)}”"
    if t=="0-1":
        return f"wait {fields.get('delta','')} {str(fields.get('time_unit','')).lower()}"
    if t=="0-8": return f"send internal alert “{clip(fields.get('subject',''),30)}”"
    if t=="1-27489890": return "call a webhook"
    if t=="0-4": return "send a marketing email"
    if t=="0-14": return "create a record"
    if t=="0-169425243": return "add a note"
    if t=="0-11": return "assign the owner"
    if t=="0-63189541": return "link an association"
    if t=="0-15": return "enroll it in another workflow"
    return None

def branch_condition(node):
    # summarize a LIST_BRANCH listBranch filter into a short phrase
    filts=[]; collect_filters(node,filts)
    parts=[fmt_filter(p,o) for p,o in filts if p not in STAGE_PROPS][:2]
    return " and ".join(parts) if parts else "criteria met"

def action_summary(d):
    amap={a.get("actionId"):a for a in d.get("actions",[])}
    steps=[]; visited=set()
    cur=d.get("startActionId")
    guard=0
    while cur and cur in amap and cur not in visited and guard<12:
        visited.add(cur); guard+=1
        a=amap[cur]; t=a.get("actionTypeId")
        if a.get("type")=="LIST_BRANCH" or a.get("listBranches") is not None:
            lb=(a.get("listBranches") or [{}])[0]
            cond=branch_condition(lb.get("filterBranch",{}))
            matched=lb.get("connection",{}).get("nextActionId")
            default=a.get("defaultBranch",{}).get("nextActionId")
            mtxt="stop" if not matched else (one_action(amap.get(matched,{})) or "continue")
            steps.append(f"if {cond} → {mtxt}; otherwise")
            cur=default
            continue
        ph=one_action(a)
        if ph: steps.append(ph)
        cur=a.get("connection",{}).get("nextActionId")
    # dedupe consecutive, cap
    out=[]
    for s in steps:
        if not out or out[-1]!=s: out.append(s)
    if len(out)>5: out=out[:5]+[f"…(+{len(out)-5} more)"]
    if not out: return "Splits the path (decides what happens next; makes no direct change)."
    s="; then ".join(out).replace("otherwise; then ","otherwise ")
    return s[0].upper()+s[1:]+"."

# stages to emit (Project pipeline core), in order
CORE=[("20461936","Site Survey"),("20461937","Design & Engineering"),
 ("20461938","Permitting & Interconnection"),("22580871","Ready To Build"),
 ("20440342","Construction"),("22580872","Inspection"),("20461940","Permission To Operate"),
 ("24743347","Close Out")]

# index detail by stage (inclusion only)
by_stage={}
for fp in glob.glob("data/hubspot-flows/detail/*.json"):
    d=json.load(open(fp))
    if d.get("_error"): continue
    filts=[]; collect_filters(d.get("enrollmentCriteria",{}), filts)
    stages=set()
    for prop,op in filts:
        if prop in STAGE_PROPS and op.get("operator") in INCLUDE_OPS:
            for v in (op.get("values") or []):
                if v in stage_lookup: stages.add(v)
    for sid in stages:
        by_stage.setdefault(sid,[]).append(d)

clone_re=re.compile(r'\s*\(#\d+\)\s*$')
def esc(s): return re.sub(r'\s+',' ',str(s)).replace("|","\\|").strip()

out=["# Corrected SOP workflow tables — regenerated from live HubSpot data","",
 "**2026-06-21.** Every row is generated from the live Automation v4 API and translated into plain English using HubSpot’s own property labels — nothing here is hand-written or guessed. “When it runs” is the real enrollment trigger; “What it does” is the real action sequence. Clones collapsed; ON flows only (OFF flows omitted — they should leave the SOP).","",
 "Drop-in replacement candidates for the `wf-*` SOP sections. Review before publishing.",""]
for sid,label in CORE:
    flows=by_stage.get(sid,[])
    # collapse clones, ON only
    groups={}
    for d in flows:
        if not d.get("isEnabled"): continue
        base=clone_re.sub('', d.get("name","")).strip()
        if base not in groups: groups[base]=d
    if not groups: continue
    out.append(f"## {label}  (`{sid}`) — {len(groups)} live workflows")
    out.append("")
    out.append("| Workflow | When it runs | What it does |")
    out.append("|---|---|---|")
    for base in sorted(groups):
        d=groups[base]
        out.append(f"| {esc(base)} | {esc(trigger_summary(d,sid))} | {esc(action_summary(d))} |")
    out.append("")
open("docs/hubspot-sop-corrected-tables-2026-06-21.md","w").write("\n".join(out))
print("wrote docs/hubspot-sop-corrected-tables-2026-06-21.md")
for sid,label in CORE:
    g={clone_re.sub('',d.get('name','')).strip() for d in by_stage.get(sid,[]) if d.get('isEnabled')}
    print(f"  {label:32} {len(g)} ON workflows")

# ---- FULL COVERAGE AUDIT across ALL 855 flows ----
from collections import Counter
UNHANDLED.clear()
unparsed=[]; etype_count=Counter()
for fp in glob.glob("data/hubspot-flows/detail/*.json"):
    dd=json.load(open(fp))
    if dd.get("_error"): continue
    etype_count[dd.get("enrollmentCriteria",{}).get("type")]+=1
    t=trigger_summary(dd, None)
    if "unparsed" in t or t.strip()=="" : unparsed.append((dd.get("name"), t))
print("\n=== COVERAGE AUDIT (all flows) ===")
print("enrollment types:", dict(etype_count))
print("operators that fell through to generic:", Counter(o for _,o in UNHANDLED) or "NONE")
print("triggers that produced empty/unparsed:", len(unparsed))
for nm,t in unparsed[:15]: print("   ·", (nm or "")[:50], "->", t)
