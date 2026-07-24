import {
  buildCommentPayload,
  isVishtikWriteEnabled,
  isVishtikDryRun,
} from "@/lib/vishtik-write";

describe("vishtik-write payload", () => {
  it("builds the exact Add-comment form the portal sends", () => {
    expect(buildCommentPayload("7814", "please revise the setback")).toEqual({
      message: "please revise the setback",
      id: "7814",
      ir_replay_to_msg_id: "",
      replay_msg_string: "",
    });
  });

  it("preserves the message verbatim (no trimming/escaping here)", () => {
    const msg = "  line one\nline two  ";
    expect(buildCommentPayload("1", msg).message).toBe(msg);
  });
});

describe("vishtik-write gating", () => {
  const orig = { ...process.env };
  afterEach(() => {
    process.env.VISHTIK_WRITE_ENABLED = orig.VISHTIK_WRITE_ENABLED;
    process.env.VISHTIK_WRITE_DRY_RUN = orig.VISHTIK_WRITE_DRY_RUN;
  });

  it("write is off unless explicitly enabled", () => {
    delete process.env.VISHTIK_WRITE_ENABLED;
    expect(isVishtikWriteEnabled()).toBe(false);
    process.env.VISHTIK_WRITE_ENABLED = "true";
    expect(isVishtikWriteEnabled()).toBe(true);
  });

  it("dry-run is ON by default and only off when explicitly 'false'", () => {
    delete process.env.VISHTIK_WRITE_DRY_RUN;
    expect(isVishtikDryRun()).toBe(true); // safe default
    process.env.VISHTIK_WRITE_DRY_RUN = "true";
    expect(isVishtikDryRun()).toBe(true);
    process.env.VISHTIK_WRITE_DRY_RUN = "false";
    expect(isVishtikDryRun()).toBe(false);
  });
});
