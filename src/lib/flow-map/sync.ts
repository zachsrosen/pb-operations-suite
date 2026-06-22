// ---------------------------------------------------------------------------
// Workflow Map incremental sync orchestrator
//
// Pulls HubSpot Automation v4 flows (deals + tickets only), renders each into a
// FlowEntry via summarizeFlow, builds progression links, and persists the whole
// thing as one FlowMapSnapshot in SystemConfig.
//
// Incremental: a per-flow detail cache (keyed by id, holding the flow's
// revisionId + rendered FlowEntry) lets us skip getFlowDetail for any flow whose
// current revisionId matches the cache — only changed/new flows are detail-fetched.
//
// Quota guard: all fetching + assembly completes BEFORE the snapshot is written.
// If any HubSpot call throws after the client's retries are exhausted (e.g.
// persistent 429), the error propagates and the last good snapshot stays intact.
// ---------------------------------------------------------------------------

import { listFlows, getFlowDetail, getPipelines, getProperties } from "@/lib/flow-map/client";
import { summarizeFlow } from "@/lib/flow-map/summarize";
import { buildProgression } from "@/lib/flow-map/progression";
import { getDetailCache, writeDetailCache, writeSnapshot, type FlowDetailCache } from "@/lib/flow-map/store";
import type { FlowEntry, FlowMapSnapshot, Pipeline, Stage } from "@/lib/flow-map/types";

const DEAL_OBJECT_TYPE = "0-3";
const TICKET_OBJECT_TYPE = "0-5";

// Strip a trailing " (#N)" clone suffix from a flow name.
const CLONE_RE = /\s*\(#\d+\)\s*$/;
function baseName(n: string): string {
  return String(n).replace(CLONE_RE, "").trim();
}

type SummarizerStageLookup = Record<string, [string, string, string, number]>;
type PropLabels = { labels: Record<string, string>; options: Record<string, Record<string, string>> };

export async function syncFlowMap(
  token?: string
): Promise<{ flowCount: number; changed: number; generatedAt: string }> {
  // 1–2. List all flows, keep deal + ticket flows only.
  const allFlows = await listFlows(token);
  const targets = allFlows.filter(
    (f) => f?.objectTypeId === DEAL_OBJECT_TYPE || f?.objectTypeId === TICKET_OBJECT_TYPE
  );

  // 4. Pipelines + both stageLookup shapes.
  const [dealPipelinesRaw, ticketPipelinesRaw] = await Promise.all([
    getPipelines("deals", token),
    getPipelines("tickets", token),
  ]);

  const pipelines: Pipeline[] = [];
  const stageLookup: FlowMapSnapshot["stageLookup"] = {};
  const summarizerStageLookup: SummarizerStageLookup = {};

  const ingestPipelines = (raw: any[], objectTypeId: string) => {
    for (const p of raw || []) {
      const stages: Stage[] = (p.stages || []).map((s: any) => ({
        id: String(s.id),
        label: String(s.label ?? s.id),
        order: typeof s.displayOrder === "number" ? s.displayOrder : Number(s.displayOrder ?? 0),
      }));
      pipelines.push({ id: String(p.id), label: String(p.label ?? p.id), objectTypeId, stages });
      for (const s of stages) {
        stageLookup[s.id] = {
          pipelineId: String(p.id),
          pipelineLabel: String(p.label ?? p.id),
          stageLabel: s.label,
          order: s.order,
        };
        summarizerStageLookup[s.id] = [String(p.label ?? p.id), String(p.id), s.label, s.order];
      }
    }
  };
  ingestPipelines(dealPipelinesRaw, DEAL_OBJECT_TYPE);
  ingestPipelines(ticketPipelinesRaw, TICKET_OBJECT_TYPE);

  // 5. Properties → propLabels.
  const [dealProps, ticketProps] = await Promise.all([
    getProperties("deals", token),
    getProperties("tickets", token),
  ]);

  const propLabels: PropLabels = { labels: {}, options: {} };
  const ingestProps = (raw: any[]) => {
    for (const prop of raw || []) {
      const name = prop?.name;
      if (!name) continue;
      if (prop.label) propLabels.labels[name] = String(prop.label);
      const opts = prop.options;
      if (Array.isArray(opts) && opts.length) {
        const map = (propLabels.options[name] ??= {});
        for (const o of opts) {
          if (o && o.value !== undefined && o.value !== null) {
            map[String(o.value)] = String(o.label ?? o.value);
          }
        }
      }
    }
  };
  ingestProps(dealProps);
  ingestProps(ticketProps);

  // clone-base name counts across ALL target flows.
  const cloneCounts = new Map<string, number>();
  for (const f of targets) {
    const b = baseName(f.name);
    cloneCounts.set(b, (cloneCounts.get(b) ?? 0) + 1);
  }

  const portalId = process.env.HUBSPOT_PORTAL_ID ?? "";
  const hubspotUrl = (id: string) =>
    `https://app.hubspot.com/workflows/${portalId}/platform/flow/${id}/edit`;

  // 3. Detail cache: reuse unchanged, detail-fetch + summarize changed/new.
  const cache = await getDetailCache();
  const updatedCache: FlowDetailCache = {};
  const flows: Record<string, FlowEntry> = {};
  let changed = 0;

  for (const f of targets) {
    const id = String(f.id);
    const revisionId = String(f.revisionId ?? "");
    const cached = cache[id];

    let entry: FlowEntry;
    if (cached && cached.revisionId === revisionId) {
      // Reuse cached render, but refresh the cheap metadata that lives on the
      // flow summary (enabled state, name, clone count, url) without re-fetching.
      entry = {
        ...cached.entry,
        name: f.name,
        isEnabled: !!f.isEnabled,
        objectTypeId: f.objectTypeId,
        revisionId,
        cloneCount: cloneCounts.get(baseName(f.name)) ?? 1,
        hubspotUrl: hubspotUrl(id),
      };
    } else {
      changed += 1;
      const detail = await getFlowDetail(id, token);
      const summary = summarizeFlow(detail, propLabels, summarizerStageLookup);
      entry = {
        ...summary,
        id,
        name: f.name,
        isEnabled: !!f.isEnabled,
        objectTypeId: f.objectTypeId,
        revisionId,
        cloneCount: cloneCounts.get(baseName(f.name)) ?? 1,
        hubspotUrl: hubspotUrl(id),
      };
    }

    flows[id] = entry;
    updatedCache[id] = { revisionId, entry };
  }

  // 7. Progression links.
  const links = buildProgression(Object.values(flows), propLabels);

  // 8. Assemble snapshot.
  const snapshot: FlowMapSnapshot = {
    generatedAt: new Date().toISOString(),
    portalId,
    pipelines,
    stageLookup,
    flows,
    links,
  };

  // 9. Persist detail cache, then the snapshot (snapshot last = quota guard).
  await writeDetailCache(updatedCache);
  await writeSnapshot(snapshot);

  return { flowCount: targets.length, changed, generatedAt: snapshot.generatedAt };
}
