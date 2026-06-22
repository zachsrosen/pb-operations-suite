import sys, json, os, time, urllib.request, urllib.error
token=sys.argv[1]
flows=json.load(open("data/hubspot-flows/all-flows.json"))
targets=[f for f in flows if f["objectTypeId"] in ("0-3","0-5")]
os.makedirs("data/hubspot-flows/detail", exist_ok=True)
done=set(os.listdir("data/hubspot-flows/detail"))
def fetch(i):
    url=f"https://api.hubapi.com/automation/v4/flows/{i}"
    for attempt in range(6):
        try:
            req=urllib.request.Request(url, headers={"Authorization":f"Bearer {token}"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code==429:
                time.sleep(2*(attempt+1)); continue
            if e.code in (403,404):
                return {"_error":e.code}
            time.sleep(1.5*(attempt+1))
        except Exception:
            time.sleep(1.5*(attempt+1))
    return {"_error":"max_retries"}
n=0; fetched=0
for f in targets:
    n+=1
    fn=f'{f["id"]}.json'
    if fn in done: continue
    d=fetch(f["id"])
    json.dump(d, open(f"data/hubspot-flows/detail/{fn}","w"))
    fetched+=1
    time.sleep(0.11)
    if fetched%50==0:
        print(f"  fetched {fetched} (scanned {n}/{len(targets)})", flush=True)
print(f"DONE. targets={len(targets)} newly_fetched={fetched} cached_total={len(os.listdir('data/hubspot-flows/detail'))}", flush=True)
