// src/lib/morning-sweep/run.ts
//
// Orchestrates the morning sweep: gather all four sources in parallel, draft
// prep with Claude, render, and email the brief to Zach. Always delivers to
// Zach (he is the only recipient); dryRun just prefixes the subject and skips
// nothing destructive (the sweep is read-only anyway).

import { sendEmailMessage } from "@/lib/email";
import { gatherTasks, gatherFreshservice, gatherPe, gatherEmail, denverToday } from "./gather";
import { draftPrep } from "./draft";
import { renderSweepEmail } from "./render";
import type { SweepData, MorningSweepResult } from "./types";

const RECIPIENT = "zach@photonbrothers.com";

export async function runMorningSweep(
  options: { dryRun?: boolean } = {}
): Promise<MorningSweepResult> {
  const dryRun = options.dryRun ?? false;
  const errors: string[] = [];

  const [tasks, freshservice, pe, email] = await Promise.all([
    gatherTasks(errors),
    gatherFreshservice(errors),
    gatherPe(errors),
    gatherEmail(errors),
  ]);

  const data: SweepData = {
    date: denverToday(),
    tasks,
    freshservice,
    pe,
    email,
    drafts: null,
    errors,
  };

  // Best-effort drafting layer (ranked priorities + ticket replies).
  data.drafts = await draftPrep(data);

  const html = renderSweepEmail(data);
  const subject = `${dryRun ? "[DRY RUN] " : ""}Your morning sweep — ${data.date}`;
  const total =
    tasks.totalOpen + freshservice.waitingOnMe.length + pe.actionRequiredDealCount;

  const send = await sendEmailMessage({
    to: RECIPIENT,
    subject,
    html,
    text: `Morning sweep for ${data.date}: ${tasks.totalOpen} open tasks, ${freshservice.waitingOnMe.length} tickets waiting on you, ${pe.actionRequiredDealCount} PE deals with action-required docs. View in an HTML client for detail and draft replies.`,
    debugFallbackTitle: subject,
    debugFallbackBody: `${total} items across your sources`,
  });
  if (!send.success && send.error) errors.push("Email send: " + send.error);

  return {
    sent: send.success,
    dryRun,
    recipient: RECIPIENT,
    taskCount: tasks.totalOpen,
    ticketCount: freshservice.waitingOnMe.length,
    peDealCount: pe.actionRequiredDealCount,
    emailItemCount: email.items.length,
    errors,
  };
}
