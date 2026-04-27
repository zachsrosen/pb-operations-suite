"use client";

import type { ShitShowItem } from "./types";

export function ProjectInfoPanel({ item }: { item: ShitShowItem }) {
  return (
    <div className="bg-surface-2 rounded-lg p-4 space-y-3">
      <Row label="Address" value={item.address} />
      <div className="grid grid-cols-2 gap-3">
        <Row label="System size" value={item.systemSizeKw ? `${item.systemSizeKw} kW` : null} />
        <Row label="Project type" value={item.projectType} />
      </div>
      <Row label="Equipment" value={item.equipmentSummary} />
      <div className="grid grid-cols-2 gap-3">
        <Row label="Stage" value={item.stage} />
        <Row label="Survey status" value={item.surveyStatus} />
        <Row label="Design status" value={item.designStatus} />
        <Row label="Design approval" value={item.designApprovalStatus} />
        <Row label="Survey date" value={item.surveyDate} />
        <Row label="Planset date" value={item.plansetDate} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Row label="AHJ" value={item.ahj} />
        <Row label="Utility" value={item.utilityCompany} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Row label="Project Manager" value={item.projectManager} />
        <Row label="Operations Manager" value={item.operationsManager} />
        <Row label="Site surveyor" value={item.siteSurveyor} />
        <Row label="Deal owner" value={item.dealOwner} />
      </div>

      <div className="flex flex-wrap gap-2 pt-2 border-t border-t-border">
        <LinkButton label="HubSpot deal" href={`https://app.hubspot.com/contacts/0/deal/${item.dealId}`} />
        <LinkButton label="OpenSolar" href={item.openSolarUrl} />
        <LinkButton label="Sales folder" href={item.salesFolderUrl} />
        <LinkButton label="Survey folder" href={item.surveyFolderUrl} />
        <LinkButton label="Design folder" href={item.designFolderUrl} />
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className="text-sm text-foreground">{value || "—"}</div>
    </div>
  );
}

function LinkButton({ label, href }: { label: string; href: string | null }) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="bg-surface hover:bg-surface-elevated border border-t-border rounded px-2 py-1 text-xs"
    >
      {label} ↗
    </a>
  );
}
