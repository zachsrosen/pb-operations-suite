import { registerChecks } from "./index";
import type { CheckFn, ReviewContext, Finding } from "./types";

const permittingStatusSet: CheckFn = async (ctx: ReviewContext): Promise<Finding | null> => {
  const status = ctx.properties.permitting_status;
  if (!status || status === "" || status === "Not Started") {
    return { check: "permitting-status-set", severity: "warning", message: "Permitting status not set", field: "permitting_status" };
  }
  return null;
};

const inspectionDateSet: CheckFn = async (ctx: ReviewContext): Promise<Finding | null> => {
  const date = ctx.properties.inspection_date;
  if (!date) {
    return { check: "inspection-date-set", severity: "info", message: "Inspection date not yet scheduled", field: "inspection_date" };
  }
  return null;
};

registerChecks("engineering-review", [permittingStatusSet, inspectionDateSet]);
