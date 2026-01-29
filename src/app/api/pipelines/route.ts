import { NextResponse } from "next/server";
import { Client } from "@hubspot/api-client";
import { appCache, CACHE_KEYS } from "@/lib/cache";

const hubspotClient = new Client({
  accessToken: process.env.HUBSPOT_ACCESS_TOKEN,
});

interface PipelineData {
  deals: Array<{ id: string; label: string; stages: Array<{ id: string; label: string }> }>;
  tickets: Array<{ id: string; label: string; stages: Array<{ id: string; label: string }> }>;
}

async function fetchPipelines(): Promise<PipelineData> {
  const formatPipeline = (pipeline: { id: string; label: string; stages: Array<{ id: string; label: string }> }) => ({
    id: pipeline.id,
    label: pipeline.label,
    stages: pipeline.stages.map((stage: { id: string; label: string }) => ({
      id: stage.id,
      label: stage.label,
    })),
  });

  // Fetch both pipeline types in parallel
  const [dealPipelines, ticketPipelines] = await Promise.all([
    hubspotClient.crm.pipelines.pipelinesApi.getAll("deals"),
    hubspotClient.crm.pipelines.pipelinesApi.getAll("tickets").catch(() => ({ results: [] })),
  ]);

  return {
    deals: dealPipelines.results.map(formatPipeline),
    tickets: ticketPipelines.results.map(formatPipeline),
  };
}

export async function GET() {
  try {
    const { data, cached, stale, lastUpdated } = await appCache.getOrFetch<PipelineData>(
      CACHE_KEYS.PIPELINES,
      fetchPipelines
    );

    return NextResponse.json({
      ...data,
      cached,
      stale,
      lastUpdated,
    });
  } catch (error) {
    console.error("Error fetching pipelines:", error);
    return NextResponse.json(
      { error: "Failed to fetch pipelines" },
      { status: 500 }
    );
  }
}
