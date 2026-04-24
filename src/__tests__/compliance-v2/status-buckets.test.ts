import {
  classifyJobStatus,
  classifyTaskStatus,
  JOB_BUCKET,
  TASK_BUCKET,
} from "@/lib/compliance-v2/status-buckets";

describe("classifyJobStatus", () => {
  // Existing buckets stay correct
  it("classifies Completed as completed-full", () => {
    expect(classifyJobStatus("Completed")).toBe("completed-full");
  });
  it("classifies On Our Way as stuck", () => {
    expect(classifyJobStatus("On Our Way")).toBe("stuck");
  });

  // Bug fixes from spec §3.1
  it("classifies On My Way (variant) as stuck", () => {
    expect(classifyJobStatus("On My Way")).toBe("stuck");
  });
  it("classifies On My Way - AV as stuck", () => {
    expect(classifyJobStatus("On My Way - AV")).toBe("stuck");
  });
  it("classifies Started - AV as stuck", () => {
    expect(classifyJobStatus("Started - AV")).toBe("stuck");
  });
  it("classifies Completed - AV as completed-full", () => {
    expect(classifyJobStatus("Completed - AV")).toBe("completed-full");
  });
  it("classifies Scheduled - AV as never-started", () => {
    expect(classifyJobStatus("Scheduled - AV")).toBe("never-started");
  });

  // Follow-up closures
  it("classifies Return Visit Required as completed-follow-up", () => {
    expect(classifyJobStatus("Return Visit Required")).toBe("completed-follow-up");
  });
  it("classifies Loose Ends Remaining as completed-follow-up", () => {
    expect(classifyJobStatus("Loose Ends Remaining")).toBe("completed-follow-up");
  });
  it("classifies Needs Revisit as completed-follow-up", () => {
    expect(classifyJobStatus("Needs Revisit")).toBe("completed-follow-up");
  });

  // Failed bucket
  it("classifies Failed as completed-failed", () => {
    expect(classifyJobStatus("Failed")).toBe("completed-failed");
  });

  // Excluded
  it("classifies On Hold as excluded", () => {
    expect(classifyJobStatus("On Hold")).toBe("excluded");
  });
  it("classifies Scheduling On-Hold as excluded", () => {
    expect(classifyJobStatus("Scheduling On-Hold")).toBe("excluded");
  });
  it("classifies Ready To Forecast as excluded", () => {
    expect(classifyJobStatus("Ready To Forecast")).toBe("excluded");
  });

  // Case insensitivity
  it("handles upper-case SCHEDULED", () => {
    expect(classifyJobStatus("SCHEDULED")).toBe("never-started");
  });
  it("handles 'Ready to Build' case variant", () => {
    expect(classifyJobStatus("Ready to Build")).toBe("never-started");
  });

  // Unknown status defaults to excluded (safer than picking a bucket)
  it("classifies unknown as excluded", () => {
    expect(classifyJobStatus("Martian Landing")).toBe("excluded");
  });
});

describe("classifyTaskStatus", () => {
  it("classifies COMPLETED as completed-full", () => {
    expect(classifyTaskStatus("COMPLETED")).toBe("completed-full");
  });
  it("classifies lower-case 'completed' as completed-full", () => {
    expect(classifyTaskStatus("completed")).toBe("completed-full");
  });
});
