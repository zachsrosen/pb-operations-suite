import { bucketDnrStages, bucketRoofingStages } from "@/lib/shop-health-dnr-roofing";

describe("bucketDnrStages", () => {
  const cases: Array<[string, string, ReturnType<typeof bucketDnrStages>]> = [
    ["Kickoff", "52474739", "preDetach"],
    ["Site Survey", "52474740", "preDetach"],
    ["Design", "52474741", "preDetach"],
    ["Permit", "52474742", "preDetach"],
    ["Ready for Detach", "78437201", "preDetach"],
    ["Detach", "52474743", "detachInProgress"],
    ["Detach Complete - Roofing In Progress", "78453339", "roofingPhase"],
    ["Reset Blocked - Waiting on Payment", "78412639", "resetBlocked"],
    ["Ready for Reset", "78412640", "resetPhase"],
    ["Reset", "52474744", "resetPhase"],
    ["Inspection", "55098156", "closeout"],
    ["Closeout", "52498440", "closeout"],
    ["Complete", "68245827", "terminal"],
    ["Cancelled", "52474745", "terminal"],
    ["On-hold", "72700977", "terminal"],
  ];

  it.each(cases)("buckets %s (%s) → %s", (_label, id, expected) => {
    expect(bucketDnrStages(id)).toBe(expected);
  });

  it("returns 'unknown' for an unmapped stage ID", () => {
    expect(bucketDnrStages("99999999")).toBe("unknown");
  });
});

describe("bucketRoofingStages", () => {
  const cases: Array<[string, string, ReturnType<typeof bucketRoofingStages>]> = [
    ["On Hold", "1117662745", "preProduction"],
    ["Color Selection", "1117662746", "preProduction"],
    ["Material & Labor Order", "1215078279", "preProduction"],
    ["Confirm Dates", "1117662747", "preProduction"],
    ["Staged", "1215078280", "preProduction"],
    ["Production", "1215078281", "inProduction"],
    ["Post Production", "1215078282", "postProduction"],
    ["Invoice/Collections", "1215078283", "postProduction"],
    ["Job Close Out Paperwork", "1215078284", "postProduction"],
    ["Job Completed", "1215078285", "terminal"],
  ];

  it.each(cases)("buckets %s (%s) → %s", (_label, id, expected) => {
    expect(bucketRoofingStages(id)).toBe(expected);
  });

  it("returns 'unknown' for an unmapped stage ID", () => {
    expect(bucketRoofingStages("99999999")).toBe("unknown");
  });
});
