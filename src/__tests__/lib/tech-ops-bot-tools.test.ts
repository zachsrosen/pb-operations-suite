import { createTechOpsBotTools } from "@/lib/tech-ops-bot-tools";

describe("createTechOpsBotTools", () => {
  it("returns 6 tools", () => {
    const tools = createTechOpsBotTools();
    expect(tools).toHaveLength(6);
  });

  it("includes expected tool names", () => {
    const tools = createTechOpsBotTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "get_project_status",
        "get_schedule_overview",
        "get_service_queue",
        "escalate",
        "search_sop",
        "submit_process_request",
      ])
    );
  });

  it("all tools have descriptions", () => {
    const tools = createTechOpsBotTools();
    for (const tool of tools) {
      expect((tool as { description?: string }).description).toBeTruthy();
    }
  });
});
