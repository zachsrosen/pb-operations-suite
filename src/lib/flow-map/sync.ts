/* eslint-disable @typescript-eslint/no-explicit-any -- consumes loosely-typed HubSpot Automation v4 JSON; behavior is guarded by the 855-fixture test suite */
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
// Resumable: the per-flow detail cache is persisted INCREMENTALLY during the
// backfill loop (every PERSIST_EVERY newly-fetched flows, and once more before
// the snapshot is assembled). A first backfill is ~870 HubSpot calls / several
// minutes; if the serverless function times out mid-fetch, the entries fetched
// so far are already persisted (keyed by revisionId), so the next run reuses
// them and only fetches the remaining flows.
//
// Quota guard: the SNAPSHOT is still written only at the very end, AFTER all
// flows are gathered and progression is built. If any HubSpot call throws after
// the client's retries are exhausted (e.g. persistent 429), the error
// propagates: the partial detail cache is safe/idempotent, but no partial
// snapshot is ever written, so the last good snapshot stays intact.
// ---------------------------------------------------------------------------

import { listFlows, getFlowDetail, getPipelines, getProperties } from "@/lib/flow-map/client";
import { summarizeFlow } from "@/lib/flow-map/summarize";
import { buildProgression } from "@/lib/flow-map/progression";
import { getDetailCache, writeDetailCache, writeSnapshot, type FlowDetailCache } from "@/lib/flow-map/store";
import type { FlowEntry, FlowMapSnapshot, Pipeline, Stage } from "@/lib/flow-map/types";

const DEAL_OBJECT_TYPE = "0-3";
const TICKET_OBJECT_TYPE = "0-5";

// Flush the detail cache to the store every N newly-fetched flows so a timeout
// mid-backfill leaves recoverable progress behind.
const PERSIST_EVERY = 50;

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
  //
  // `updatedCache` is the cache we'll persist. We seed it from the existing
  // cache so that an incremental flush mid-backfill writes a COMPLETE,
  // consistent cache (reused + already-fetched entries), never a partial one
  // that could drop previously-good renders. Each loop iteration overwrites the
  // flow's entry with the fresh render/metadata.
  const cache = await getDetailCache();
  const updatedCache: FlowDetailCache = { ...cache };
  const flows: Record<string, FlowEntry> = {};
  let changed = 0;
  let fetchedSinceFlush = 0;

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
      // A throw here propagates out of syncFlowMap: the already-flushed detail
      // cache is kept (safe/idempotent — entries are keyed by revisionId), but
      // no snapshot is written, so the quota guard holds.
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

      flows[id] = entry;
      updatedCache[id] = { revisionId, entry };

      // Persist partial progress periodically so a timeout mid-backfill leaves
      // the freshly-fetched renders cached for the next run to reuse.
      if (++fetchedSinceFlush >= PERSIST_EVERY) {
        await writeDetailCache(updatedCache);
        fetchedSinceFlush = 0;
      }
      continue;
    }

    flows[id] = entry;
    updatedCache[id] = { revisionId, entry };
  }

  // Final flush of the complete detail cache before snapshot assembly, so the
  // cache reflects every fetched flow even if fewer than PERSIST_EVERY remained.
  await writeDetailCache(updatedCache);

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

  // 9. Persist the snapshot LAST (= quota guard). The detail cache was already
  // flushed incrementally above; the snapshot needs the complete flow set +
  // progression, so it is only ever written once everything is assembled.
  await writeSnapshot(snapshot);

  return { flowCount: targets.length, changed, generatedAt: snapshot.generatedAt };
}
