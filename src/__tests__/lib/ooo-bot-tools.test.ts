import { createOooBotTools } from "@/lib/ooo-bot-tools";

describe("createOooBotTools", () => {
  it("returns 5 tools", () => {
    const tools = createOooBotTools();
    expect(tools).toHaveLength(5);
  });

  it("includes expected tool names", () => {
    const tools = createOooBotTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "get_project_status",
        "get_schedule_overview",
        "get_service_queue",
        "escalate",
        "search_sop",
      ])
    );
  });

  it("all tools have descriptions", () => {
    const tools = createOooBotTools();
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
    }
  });
});
