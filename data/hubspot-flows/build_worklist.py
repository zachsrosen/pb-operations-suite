import sys, json, os, re, glob, urllib.request
token=sys.argv[1]

def get(url):
    req=urllib.request.Request(url, headers={"Authorization":f"Bearer {token}"})
    with urllib.request.urlopen(req) as r: return json.load(r)

# 1. pipeline/stage defs -> stageId lookup (deals + tickets)
stage_lookup={}  # stageId -> (pipelineLabel, pipelineId, stageLabel, order)
pipelines={}
for obj in ["deals","tickets"]:
    d=get(f"https://api.hubapi.com/crm/v3/pipelines/{obj}")
    for p in d["results"]:
        pipelines.setdefault(p["id"], {"label":p["label"],"obj":obj,"stages":[]})
        for s in p["stages"]:
            stage_lookup[s["id"]]=(p["label"], p["id"], s["label"], s.get("displayOrder",0))
            pipelines[p["id"]]["stages"].append((s["id"], s["label"], s.get("displayOrder",0)))
json.dump({"stage_lookup":stage_lookup}, open("data/hubspot-flows/_stage_lookup.json","w"), indent=1)
stage_ids=set(stage_lookup)

# 2. flow detail -> stage mapping (INCLUSION criteria only)
STAGE_PROPS={"dealstage","hs_pipeline_stage","hs_value"}
INCLUDE_OPS={"IS_ANY_OF","IS_EQUAL_TO","HAS_EVER_BEEN_ANY_OF","HAS_EVER_BEEN_EQUAL_TO"}
def filter_values(node):
    out=[]
    if isinstance(node,dict):
        op=node.get("operation")
        if op and node.get("property") in STAGE_PROPS and op.get("operator") in INCLUDE_OPS:
            out+= op.get("values",[]) or ([op.get("value")] if op.get("value") is not None else [])
        for v in node.values(): out+=filter_values(v)
    elif isinstance(node,list):
        for v in node: out+=filter_values(v)
    return out

flows_meta={f["id"]:f for f in json.load(open("data/hubspot-flows/all-flows.json"))}
stage_flows={}  # stageId -> list of (name, isEnabled, id)
crosscut=[]
detail_files=glob.glob("data/hubspot-flows/detail/*.json")
mapped=0
for fp in detail_files:
    d=json.load(open(fp))
    if d.get("_error"): continue
    fid=d.get("id") or os.path.basename(fp)[:-5]
    meta=flows_meta.get(fid,{})
    vals=set(str(v) for v in filter_values(d.get("enrollmentCriteria",{})))
    hit=vals & stage_ids
    rec=(d.get("name",""), d.get("isEnabled",False), fid)
    if hit:
        mapped+=1
        for sid in hit: stage_flows.setdefault(sid,[]).append(rec)
    else:
        crosscut.append(rec)

# 3. SOP documented workflow names per wf- section
sop=json.load(open("data/hubspot-flows/sop-sections.json"))
def clean(s):
    s=re.sub(r'<[^>]+>',' ',s)
    for a,b in [('&amp;','&'),('&gt;','>'),('&lt;','<'),('&nbsp;',' '),('&#39;',"'"),('&quot;','"')]: s=s.replace(a,b)
    return re.sub(r'\s+',' ',s).strip()
def doc_names_from_section(html):
    names=[]
    for tbl in re.findall(r'<table>(.*?)</table>', html, re.S):
        hdr=re.search(r'<tr>(<th.*?)</tr>', tbl, re.S)
        if not hdr: continue
        hcells=[clean(x) for x in re.findall(r'<th[^>]*>(.*?)</th>', hdr.group(1), re.S)]
        if hcells and hcells[0].lower()=="workflow":
            for m in re.finditer(r'<tr><td>(.*?)</td>', tbl, re.S):
                nm=clean(m.group(1))
                if nm: names.append(nm)
    return names
sec_by_id={s["id"]:s for s in sop["sections"]}

# 4. SOP section -> stage(s)
SEC2STAGE={
 "wf-survey":["20461936"],
 "wf-design":["20461937"], "wf-da":["20461937"], "wf-qr":["20461937"],
 "wf-rev-da":["20461937"], "wf-rev-ab":["20461937"],
 "wf-permit":["20461938"], "wf-ic":["20461938"], "wf-rev-permit":["20461938"], "wf-rev-ic":["20461938"],
 "wf-con":["20440342"], "wf-insp":["22580872"], "wf-pto":["20461940"],
}
def norm(s):
    s=s.lower()
    s=re.sub(r'\(#\d+\)','',s)
    s=re.sub(r'\b(zrs|wms)\b','',s)
    s=re.sub(r'^\s*\d{1,2}[a-z]?\s*[.\-]\s*','',s)
    s=re.sub(r'[|]',' ',s); s=re.sub(r'[^a-z0-9 ]',' ',s)
    return re.sub(r'\s+',' ',s).strip()

# aggregate documented names per stage
stage_doc={}
for secid,stages in SEC2STAGE.items():
    sec=sec_by_id.get(secid)
    if not sec: continue
    for nm in doc_names_from_section(sec["content"]):
        for st in stages: stage_doc.setdefault(st,[]).append(nm)

# 5. build worklist
clone_re=re.compile(r'\s*\(#\d+\)\s*$')
def collapse(rows):
    g={}
    for nm,on,fid in rows:
        base=clone_re.sub('',nm).strip()
        e=g.setdefault(base,{"on":False,"n":0}); e["n"]+=1; e["on"]=e["on"] or on
    return g

out=["# Per-stage SOP ↔ automation mismatch worklist","",
 "Generated from live HubSpot flow detail + live SOP sections. Every flag is evidence-backed (name/ID match), not inferred.","",
 f"Flows mapped to a stage: {mapped} · cross-cutting (no stage): {len(crosscut)}",""]
# order stages by project pipeline then others
ordered=sorted(set(list(stage_doc)+list(stage_flows)), key=lambda s:(stage_lookup.get(s,('zzz','','',999))[0], stage_lookup.get(s,('','','',999))[3]))
summary=[]
for sid in ordered:
    plabel,pid,slabel,order=stage_lookup.get(sid,("?","?",sid,0))
    live=collapse(stage_flows.get(sid,[]))
    doc=stage_doc.get(sid,[])
    live_norm={norm(b):b for b in live}
    doc_set={}
    for dn in doc: doc_set[norm(dn)]=dn
    # documented but OFF or missing
    doc_off=[]; doc_missing=[]
    for dnorm,draw in doc_set.items():
        match=None
        for lnorm,lraw in live_norm.items():
            if dnorm and (dnorm==lnorm or dnorm in lnorm or lnorm in dnorm):
                match=lraw; break
        if match is None: doc_missing.append(draw)
        elif not live[match]["on"]: doc_off.append((draw,match))
    # live but undocumented (ON only)
    live_undoc=[b for b,info in live.items() if info["on"] and not any(
        (norm(b)==dn or norm(b) in dn or dn in norm(b)) for dn in doc_set)]
    if not (doc_off or doc_missing or live_undoc) and not live: continue
    out.append(f"## {plabel} → {slabel}  (`{sid}`)")
    out.append(f"Live flows here: {len(live)} ({sum(1 for i in live.values() if i['on'])} ON) · documented names: {len(doc_set)}")
    out.append("")
    if doc_off:
        out.append("**Documented but the live flow is OFF — SOP likely stale:**")
        for draw,m in doc_off: out.append(f"- SOP: `{draw}` → live `{m}` is OFF")
        out.append("")
    if doc_missing:
        out.append("**Documented but no live match — renamed or deleted:**")
        for draw in doc_missing: out.append(f"- `{draw}`")
        out.append("")
    if live_undoc:
        out.append(f"**Live & ON but undocumented ({len(live_undoc)}):**")
        for b in sorted(live_undoc)[:40]: out.append(f"- `{b}`")
        if len(live_undoc)>40: out.append(f"- …and {len(live_undoc)-40} more")
        out.append("")
    summary.append((f"{plabel} → {slabel}", len(doc_off), len(doc_missing), len(live_undoc)))

out.insert(5,"## Summary\n\n| Stage | doc→OFF | doc→missing | live-undoc |\n|---|---|---|---|")
for i,(st,a,b,c) in enumerate(summary):
    out.insert(6+i, f"| {st} | {a} | {b} | {c} |")
out.insert(6+len(summary),"")
open("docs/hubspot-stage-mismatch-worklist.md","w").write("\n".join(out))
print("wrote docs/hubspot-stage-mismatch-worklist.md")
print("stages with content:", len(summary), "| mapped flows:", mapped, "| crosscut:", len(crosscut))
