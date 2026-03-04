import { extractInstallerNote, upsertInstallerNoteInBlob } from "@/lib/schedule-notes";

describe("extractInstallerNote", () => {
  it("returns empty string for null/undefined/empty", () => {
    expect(extractInstallerNote(null)).toBe("");
    expect(extractInstallerNote(undefined)).toBe("");
    expect(extractInstallerNote("")).toBe("");
    expect(extractInstallerNote("   ")).toBe("");
  });

  it("extracts note from simple blob", () => {
    expect(
      extractInstallerNote("Scheduled via Master Schedule\n\nInstaller Notes: Customer prefers morning")
    ).toBe("Customer prefers morning");
  });

  it("extracts note preserving multiline content", () => {
    const blob = "Scheduled via Master Schedule\n\nInstaller Notes: Line 1\nLine 2\nLine 3";
    expect(extractInstallerNote(blob)).toBe("Line 1\nLine 2\nLine 3");
  });

  it("strips [TENTATIVE] before parsing", () => {
    const blob = "[TENTATIVE] Tentatively scheduled — Crew A\n\nInstaller Notes: Park on street";
    expect(extractInstallerNote(blob)).toBe("Park on street");
  });

  it("strips [CONFIRMED] before parsing", () => {
    const blob = "[CONFIRMED] Scheduled — Crew B\n\nInstaller Notes: Gate code 1234";
    expect(extractInstallerNote(blob)).toBe("Gate code 1234");
  });

  it("strips [TZ:...] before parsing", () => {
    const blob = "[TENTATIVE] Scheduled [TZ:America/Denver]\n\nInstaller Notes: AM arrival";
    expect(extractInstallerNote(blob)).toBe("AM arrival");
  });

  it("strips [AUTO_OPTIMIZED] before parsing", () => {
    const blob = "[TENTATIVE] Scheduled [AUTO_OPTIMIZED]\n\nInstaller Notes: Big dog in yard";
    expect(extractInstallerNote(blob)).toBe("Big dog in yard");
  });

  it("strips all tags combined", () => {
    const blob = "[CONFIRMED] Scheduled — Crew A [TZ:America/Denver] [AUTO_OPTIMIZED]\n\nInstaller Notes: Call ahead";
    expect(extractInstallerNote(blob)).toBe("Call ahead");
  });

  it("returns empty when no marker present", () => {
    expect(extractInstallerNote("[TENTATIVE] Scheduled — Crew A [TZ:America/Denver]")).toBe("");
  });

  it("handles case-insensitive marker", () => {
    expect(extractInstallerNote("installer notes: lower case")).toBe("lower case");
  });
});

describe("upsertInstallerNoteInBlob", () => {
  const base = "[TENTATIVE] Tentatively scheduled via Master Scheduler — Crew A [TZ:America/Denver]";

  it("appends note to blob without existing marker", () => {
    const result = upsertInstallerNoteInBlob(base, "Customer prefers AM");
    expect(result).toContain("[TENTATIVE]");
    expect(result).toContain("[TZ:America/Denver]");
    expect(result).toContain("— Crew A");
    expect(result).toContain("Installer Notes: Customer prefers AM");
  });

  it("replaces existing note", () => {
    const existing = `${base}\n\nInstaller Notes: Old note`;
    const result = upsertInstallerNoteInBlob(existing, "New note");
    expect(result).toContain("[TENTATIVE]");
    expect(result).toContain("[TZ:America/Denver]");
    expect(result).toContain("— Crew A");
    expect(result).toContain("Installer Notes: New note");
    expect(result).not.toContain("Old note");
  });

  it("removes note segment cleanly when empty string", () => {
    const existing = `${base}\n\nInstaller Notes: Old note`;
    const result = upsertInstallerNoteInBlob(existing, "");
    expect(result).toContain("[TENTATIVE]");
    expect(result).toContain("[TZ:America/Denver]");
    expect(result).toContain("— Crew A");
    expect(result).not.toContain("Installer Notes:");
    expect(result).not.toContain("Old note");
    // Should not have trailing whitespace/newlines
    expect(result).toBe(result.trimEnd());
  });

  it("removes note segment cleanly when whitespace only", () => {
    const existing = `${base}\n\nInstaller Notes: Old note`;
    const result = upsertInstallerNoteInBlob(existing, "   ");
    expect(result).not.toContain("Installer Notes:");
  });

  it("preserves [AUTO_OPTIMIZED] tag", () => {
    const withOptimizer = `${base} [AUTO_OPTIMIZED]\n\nInstaller Notes: Old`;
    const result = upsertInstallerNoteInBlob(withOptimizer, "Updated");
    expect(result).toContain("[AUTO_OPTIMIZED]");
    expect(result).toContain("Installer Notes: Updated");
  });

  it("preserves [CONFIRMED] tag", () => {
    const confirmed = "[CONFIRMED] Scheduled — Crew B\n\nInstaller Notes: Old";
    const result = upsertInstallerNoteInBlob(confirmed, "Updated");
    expect(result).toContain("[CONFIRMED]");
    expect(result).toContain("Installer Notes: Updated");
  });

  it("handles null/undefined existing notes", () => {
    const result = upsertInstallerNoteInBlob(null, "New note");
    expect(result).toBe("Installer Notes: New note");

    const result2 = upsertInstallerNoteInBlob(undefined, "New note");
    expect(result2).toBe("Installer Notes: New note");
  });

  it("handles empty existing notes with empty new note (no-op)", () => {
    expect(upsertInstallerNoteInBlob(null, "")).toBe("");
    expect(upsertInstallerNoteInBlob("", "")).toBe("");
  });

  it("truncates notes exceeding max length", () => {
    const longNote = "A".repeat(3000);
    const result = upsertInstallerNoteInBlob(base, longNote);
    // 2000 chars max
    const extracted = extractInstallerNote(result);
    expect(extracted.length).toBeLessThanOrEqual(2000);
  });

  it("round-trips correctly: upsert then extract", () => {
    const note = "Customer wants crew to arrive after 10am, gate code 5678";
    const blob = upsertInstallerNoteInBlob(base, note);
    expect(extractInstallerNote(blob)).toBe(note);
  });

  it("double-upsert replaces cleanly", () => {
    const first = upsertInstallerNoteInBlob(base, "First note");
    const second = upsertInstallerNoteInBlob(first, "Second note");
    expect(extractInstallerNote(second)).toBe("Second note");
    expect(second.match(/Installer Notes:/g)?.length).toBe(1);
  });
});
