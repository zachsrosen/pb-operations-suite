import React from "react";
import { render } from "@react-email/render";
import { sendEmailMessage } from "@/lib/email";
import SalesProductRequestNotification from "@/emails/SalesProductRequestNotification";
import SalesProductRequestApproved from "@/emails/SalesProductRequestApproved";
import SalesProductRequestDeclined from "@/emails/SalesProductRequestDeclined";

function techOpsRecipients(): string[] {
  const raw = process.env.TECH_OPS_REQUESTS_EMAIL || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function notifyTechOpsOfNewRequest(args: {
  requestId: string;
  type: "EQUIPMENT" | "ADDER";
  title: string;
  requestedBy: string;
  salesRequestNote: string;
  dealId: string | null;
  reviewUrl: string;
}): Promise<void> {
  const to = techOpsRecipients();
  if (to.length === 0) return;
  const html = await render(
    React.createElement(SalesProductRequestNotification, args),
  );
  const text = [
    `New ${args.type.toLowerCase()} request from ${args.requestedBy}`,
    `Title: ${args.title}`,
    args.dealId ? `Deal: ${args.dealId}` : "",
    `Note: ${args.salesRequestNote}`,
    `Review: ${args.reviewUrl}`,
  ]
    .filter(Boolean)
    .join("\n");
  const subject = `[${args.type === "EQUIPMENT" ? "Product" : "Adder"} Request] ${args.title}`;
  await sendEmailMessage({
    to,
    subject,
    html,
    text,
    debugFallbackTitle: subject,
    debugFallbackBody: text,
  });
}

export async function notifyRepOfApproval(args: {
  to: string;
  title: string;
  dealId: string | null;
}): Promise<void> {
  const html = await render(
    React.createElement(SalesProductRequestApproved, args),
  );
  const text = `Your product request "${args.title}" has been added to OpenSolar. It may take a few minutes to appear in the OpenSolar UI.${
    args.dealId ? `\n\nDeal: ${args.dealId}` : ""
  }`;
  const subject = `Your product request was added to OpenSolar: ${args.title}`;
  await sendEmailMessage({
    to: args.to,
    subject,
    html,
    text,
    debugFallbackTitle: subject,
    debugFallbackBody: text,
  });
}

export async function notifyRepOfDecline(args: {
  to: string;
  title: string;
  reviewerNote: string;
}): Promise<void> {
  const html = await render(
    React.createElement(SalesProductRequestDeclined, args),
  );
  const text = `Your product request "${args.title}" was declined.\n\n${args.reviewerNote}`;
  const subject = `Your product request was declined: ${args.title}`;
  await sendEmailMessage({
    to: args.to,
    subject,
    html,
    text,
    debugFallbackTitle: subject,
    debugFallbackBody: text,
  });
}
