/**
 * Design Review Checks
 *
 * Deterministic checks for design completeness. Validates HubSpot deal
 * properties that should be set before a project leaves design stage.
 */

import { registerChecks } from "./index";
import type { CheckFn, ReviewContext, Finding } from "./types";

const designNameSet: CheckFn = async (ctx: ReviewContext): Promise<Finding | null> => {
  const name = ctx.properties.dealname;
  if (!name || !name.match(/PROJ-\d+/)) {
    return { check: "project-id-format", severity: "error", message: "Deal name missing PROJ-XXXX identifier", field: "dealname" };
  }
  return null;
};

const designStatusSet: CheckFn = async (ctx: ReviewContext): Promise<Finding | null> => {
  const status = ctx.properties.design_status;
  if (!status || status === "" || status === "Not Started") {
    return { check: "design-status-set", severity: "error", message: "Design status not set or still 'Not Started'", field: "design_status" };
  }
  return null;
};

const locationSet: CheckFn = async (ctx: ReviewContext): Promise<Finding | null> => {
  const location = ctx.properties.pb_location;
  if (!location || location === "") {
    return { check: "location-set", severity: "warning", message: "PB location not set on deal", field: "pb_location" };
  }
  return null;
};

const amountSet: CheckFn = async (ctx: ReviewContext): Promise<Finding | null> => {
  const amount = ctx.properties.amount;
  if (!amount || parseFloat(amount) <= 0) {
    return { check: "amount-set", severity: "warning", message: "Deal amount is zero or not set", field: "amount" };
  }
  return null;
};

const siteSurveyComplete: CheckFn = async (ctx: ReviewContext): Promise<Finding | null> => {
  const status = ctx.properties.site_survey_status;
  if (!status || !["Complete", "Completed", "Done"].includes(status)) {
    return { check: "site-survey-complete", severity: "error", message: `Site survey not marked complete (current: ${status || "not set"})`, field: "site_survey_status" };
  }
  return null;
};

const installDateSet: CheckFn = async (ctx: ReviewContext): Promise<Finding | null> => {
  const date = ctx.properties.install_date;
  if (!date) {
    return { check: "install-date-set", severity: "info", message: "Install date not yet scheduled", field: "install_date" };
  }
  return null;
};

registerChecks("design-review", [
  designNameSet,
  designStatusSet,
  locationSet,
  amountSet,
  siteSurveyComplete,
  installDateSet,
]);
