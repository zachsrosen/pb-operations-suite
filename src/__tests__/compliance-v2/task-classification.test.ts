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
