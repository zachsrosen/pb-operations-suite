describe("pe-audit-orchestrator types", () => {
  it("imports without error", async () => {
    const mod = await import("@/lib/pe-audit-orchestrator");
    expect(typeof mod.runPeAudit).toBe("function");
  });
});
