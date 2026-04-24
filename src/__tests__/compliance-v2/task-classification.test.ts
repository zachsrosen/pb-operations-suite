import { classifyTaskTitle, isScoredTaskTitle } from "@/lib/compliance-v2/task-classification";

describe("classifyTaskTitle", () => {
  it("classifies PV Install - Colorado as work", () => {
    expect(classifyTaskTitle("PV Install - Colorado")).toBe("work");
  });
  it("classifies Electrical Install - California as work", () => {
    expect(classifyTaskTitle("Electrical Install - California")).toBe("work");
  });
  it("classifies Loose Ends as work", () => {
    expect(classifyTaskTitle("Loose Ends")).toBe("work");
  });
  it("classifies JHA Form as paperwork", () => {
    expect(classifyTaskTitle("JHA Form")).toBe("paperwork");
  });
  it("classifies Xcel PTO as paperwork", () => {
    expect(classifyTaskTitle("Xcel PTO")).toBe("paperwork");
  });
  it("classifies unknown title as unknown", () => {
    expect(classifyTaskTitle("Floofy Reticulation")).toBe("unknown");
  });
  it("handles case insensitivity", () => {
    expect(classifyTaskTitle("pv install - colorado")).toBe("work");
  });

  // Prefix matching — regional variants
  it("matches unsuffixed PV Install via prefix", () => {
    expect(classifyTaskTitle("PV Install")).toBe("work");
  });
  it("matches unsuffixed Electrical Install via prefix", () => {
    expect(classifyTaskTitle("Electrical Install")).toBe("work");
  });
  it("matches Site Survey - Colorado via prefix", () => {
    expect(classifyTaskTitle("Site Survey - Colorado")).toBe("work");
  });
  it("matches unsuffixed Site Survey via prefix", () => {
    expect(classifyTaskTitle("Site Survey")).toBe("work");
  });
  it("matches Inspection - Colorado via prefix", () => {
    expect(classifyTaskTitle("Inspection - Colorado")).toBe("work");
  });
  it("matches Inspection - D&R via prefix", () => {
    expect(classifyTaskTitle("Inspection - D&R")).toBe("work");
  });

  // Additional exact-match work tasks
  it("classifies Service as work", () => {
    expect(classifyTaskTitle("Service")).toBe("work");
  });
  it("classifies Roof Check - Service as work", () => {
    expect(classifyTaskTitle("Roof Check - Service")).toBe("work");
  });
  it("classifies Pre-wire as work", () => {
    expect(classifyTaskTitle("Pre-wire")).toBe("work");
  });
  it("classifies Walk Roof as work", () => {
    expect(classifyTaskTitle("Walk Roof")).toBe("work");
  });
  it("classifies Detach as work", () => {
    expect(classifyTaskTitle("Detach")).toBe("work");
  });

  // Test/garbage titles explicitly excluded
  it("classifies inventory test as paperwork (test data, should not be scored)", () => {
    expect(classifyTaskTitle("inventory test")).toBe("paperwork");
  });
});

describe("isScoredTaskTitle", () => {
  it("is true for work tasks", () => {
    expect(isScoredTaskTitle("PV Install - Colorado")).toBe(true);
  });
  it("is false for paperwork", () => {
    expect(isScoredTaskTitle("JHA Form")).toBe(false);
  });
  it("is false for unknown (safe default — don't score what we can't classify)", () => {
    expect(isScoredTaskTitle("Floofy Reticulation")).toBe(false);
  });
});
