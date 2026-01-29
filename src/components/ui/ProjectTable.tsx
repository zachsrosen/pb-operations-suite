"use client";

import { type Project } from "@/lib/hubspot";
import { getStageColorClass } from "@/lib/config";

type ColumnType = "index" | "name" | "location" | "stage" | "value" | "install" | "inspection" | "pto" | "priority" | "actions";

export interface ProjectTableProps {
  projects: Project[];
  loading?: boolean;
  columns?: ColumnType[];
  maxHeight?: string;
}

const defaultColumns: ColumnType[] = [
  "index", "name", "location", "stage", "value", "install", "inspection", "pto", "priority", "actions"
];

export function ProjectTable({
  projects,
  loading = false,
  columns = defaultColumns,
  maxHeight = "500px",
}: ProjectTableProps) {
  // Ensure columns is always defined
  const cols = columns || defaultColumns;

  if (loading) {
    return (
      <div className="table-container">
        <div className="p-8 text-center text-zinc-500">
          Loading projects...
        </div>
      </div>
    );
  }

  return (
    <div className="table-container">
      <div className="table-header">
        <div className="grid gap-2 p-4" style={{ gridTemplateColumns: getGridTemplate(cols) }}>
          {cols.includes("index") && <div>#</div>}
          {cols.includes("name") && <div>Project</div>}
          {cols.includes("location") && <div>Location / AHJ</div>}
          {cols.includes("stage") && <div>Stage</div>}
          {cols.includes("value") && <div>Value</div>}
          {cols.includes("install") && <div>Install</div>}
          {cols.includes("inspection") && <div>Inspection</div>}
          {cols.includes("pto") && <div>PTO</div>}
          {cols.includes("priority") && <div>Priority</div>}
          {cols.includes("actions") && <div>Actions</div>}
        </div>
      </div>
      <div className="overflow-y-auto" style={{ maxHeight }}>
        {projects.length === 0 ? (
          <div className="p-8 text-center text-zinc-500">
            No projects found
          </div>
        ) : (
          projects.map((project, index) => (
            <ProjectRow
              key={project.id}
              project={project}
              index={index + 1}
              columns={cols}
            />
          ))
        )}
      </div>
    </div>
  );
}

function getGridTemplate(columns: ColumnType[]): string {
  const columnWidths: Record<string, string> = {
    index: "50px",
    name: "2fr",
    location: "1fr",
    stage: "120px",
    value: "100px",
    install: "100px",
    inspection: "100px",
    pto: "100px",
    priority: "80px",
    actions: "120px",
  };

  return columns.map((col) => columnWidths[col]).join(" ");
}

interface ProjectRowProps {
  project: Project;
  index: number;
  columns: ColumnType[];
}

function ProjectRow({ project, index, columns }: ProjectRowProps) {
  const isOverdue =
    (project.daysToInstall !== null && project.daysToInstall < 0 && !project.constructionCompleteDate) ||
    (project.daysToInspection !== null && project.daysToInspection < 0 && !project.inspectionPassDate);

  return (
    <div
      className={`table-row grid gap-2 p-4 text-sm items-center ${
        project.isParticipateEnergy ? "pe-row" : ""
      } ${isOverdue ? "overdue" : ""}`}
      style={{ gridTemplateColumns: getGridTemplate(columns) }}
    >
      {columns.includes("index") && (
        <div className="text-zinc-500">{index}</div>
      )}
      {columns.includes("name") && (
        <div>
          <div className="font-medium text-white truncate">
            {project.name}
          </div>
          {project.isParticipateEnergy && (
            <span className="badge badge-pe text-[10px]">PE</span>
          )}
        </div>
      )}
      {columns.includes("location") && (
        <div>
          <div className="text-zinc-300">{project.pbLocation}</div>
          <div className="text-xs text-zinc-500">{project.ahj}</div>
        </div>
      )}
      {columns.includes("stage") && (
        <div>
          <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${getStageColorClass(project.stage)} text-white`}>
            {project.stage}
          </span>
        </div>
      )}
      {columns.includes("value") && (
        <div className="stat-number text-orange-400">
          ${((project.amount || 0) / 1000).toFixed(0)}k
        </div>
      )}
      {columns.includes("install") && (
        <DaysIndicator
          days={project.daysToInstall}
          completed={!!project.constructionCompleteDate}
        />
      )}
      {columns.includes("inspection") && (
        <DaysIndicator
          days={project.daysToInspection}
          completed={!!project.inspectionPassDate}
        />
      )}
      {columns.includes("pto") && (
        <DaysIndicator
          days={project.daysToPto}
          completed={!!project.ptoGrantedDate}
        />
      )}
      {columns.includes("priority") && (
        <div>
          <div className="priority-bar">
            <div
              className="priority-fill bg-gradient-to-r from-orange-500 to-orange-400"
              style={{ width: `${Math.min(project.priorityScore / 10, 100)}%` }}
            />
          </div>
          <div className="text-[10px] text-zinc-500 mt-1 text-center">
            {project.priorityScore.toFixed(0)}
          </div>
        </div>
      )}
      {columns.includes("actions") && (
        <div className="flex gap-2">
          <a
            href={project.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-400 hover:text-blue-300"
          >
            HubSpot
          </a>
        </div>
      )}
    </div>
  );
}

function DaysIndicator({ days, completed }: { days: number | null; completed: boolean }) {
  if (completed) {
    return <span className="text-xs text-emerald-400">Done</span>;
  }
  if (days === null) {
    return <span className="text-xs text-zinc-500">N/A</span>;
  }
  if (days === 0) {
    return <span className="text-xs text-yellow-400 stat-number">Today</span>;
  }
  if (days < 0) {
    return (
      <span className="text-xs days-overdue stat-number">
        {Math.abs(days)}d over
      </span>
    );
  }
  return (
    <span className={`text-xs stat-number ${days <= 7 ? "days-warning" : "days-ok"}`}>
      in {days}d
    </span>
  );
}
