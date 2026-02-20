import {
  buildHeuristicFilterSpec,
  hasMeaningfulFilterSpec,
} from "@/lib/ai-nl-fallback";

describe("ai-nl-fallback", () => {
  it("parses PE overdue location query", () => {
    const spec = buildHeuristicFilterSpec("PE overdue in Westminster");

    expect(spec.is_pe).toBe(true);
    expect(spec.is_overdue).toBe(true);
    expect(spec.locations).toEqual(["Westminster"]);
    expect(hasMeaningfulFilterSpec(spec)).toBe(true);
  });

  it("parses negation and max amount", () => {
    const spec = buildHeuristicFilterSpec("non PE projects in Camarillo under 50k");

    expect(spec.is_pe).toBe(false);
    expect(spec.locations).toEqual(["Camarillo"]);
    expect(spec.max_amount).toBe(50000);
  });

  it("parses RTB sort hints", () => {
    const spec = buildHeuristicFilterSpec("RTB projects sort by amount descending");

    expect(spec.is_rtb).toBe(true);
    expect(spec.sort_by).toBe("amount");
    expect(spec.sort_dir).toBe("desc");
  });

  it("returns no-op interpretation when nothing is parsable", () => {
    const spec = buildHeuristicFilterSpec("asdf qwerty zzzz");

    expect(hasMeaningfulFilterSpec(spec)).toBe(false);
    expect(spec.interpreted_as).toContain("Could not confidently parse");
  });
});
