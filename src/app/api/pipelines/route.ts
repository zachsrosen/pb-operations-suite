import { NextResponse } from "next/server";
import { Client } from "@hubspot/api-client";

const hubspotClient = new Client({
  accessToken: process.env.HUBSPOT_ACCESS_TOKEN,
});

export async function GET() {
  try {
    // Fetch deal pipelines
    const dealPipelines = await hubspotClient.crm.pipelines.pipelinesApi.getAll("deals");

    // Fetch ticket pipelines (for service)
    let ticketPipelines;
    try {
      ticketPipelines = await hubspotClient.crm.pipelines.pipelinesApi.getAll("tickets");
    } catch {
      ticketPipelines = { results: [] };
    }

    const formatPipeline = (pipeline: { id: string; label: string; stages: Array<{ id: string; label: string }> }) => ({
      id: pipeline.id,
      label: pipeline.label,
      stages: pipeline.stages.map((stage: { id: string; label: string }) => ({
        id: stage.id,
        label: stage.label,
      })),
    });

    return NextResponse.json({
      deals: dealPipelines.results.map(formatPipeline),
      tickets: ticketPipelines.results.map(formatPipeline),
    });
  } catch (error) {
    console.error("Error fetching pipelines:", error);
    return NextResponse.json(
      { error: "Failed to fetch pipelines" },
      { status: 500 }
    );
  }
}
