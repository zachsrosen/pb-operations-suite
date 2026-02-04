import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export interface RoadmapItem {
  id: string;
  title: string;
  description: string;
  category: "performance" | "features" | "integrations" | "ux" | "analytics";
  status: "planned" | "in-progress" | "completed" | "under-review";
  votes: number;
  isOfficial: boolean;
  submittedBy?: string;
  createdAt: string;
}

const DATA_FILE = path.join(process.cwd(), "data", "roadmap.json");

// Default roadmap items (from ROADMAP.md)
const DEFAULT_ITEMS: RoadmapItem[] = [
  {
    id: "perf-1",
    title: "Make Loading Faster",
    description: "Implement data caching, pagination, and optimize HubSpot API calls to reduce load times across all dashboards.",
    category: "performance",
    status: "planned",
    votes: 12,
    isOfficial: true,
    createdAt: "2026-02-04T00:00:00Z",
  },
  {
    id: "feat-1",
    title: "User Access Levels & Control",
    description: "Add role-based permissions (Admin, Manager, Viewer) with permission-based route protection and an admin panel for user management.",
    category: "features",
    status: "planned",
    votes: 8,
    isOfficial: true,
    createdAt: "2026-02-04T00:00:00Z",
  },
  {
    id: "int-1",
    title: "Zuper Job Links in Scheduler Tools",
    description: "Display links to Zuper jobs alongside HubSpot links in Site Survey Scheduler and Master Scheduler project cards.",
    category: "integrations",
    status: "planned",
    votes: 6,
    isOfficial: true,
    createdAt: "2026-02-04T00:00:00Z",
  },
  {
    id: "analytics-1",
    title: "Detailed User Activity Tracking",
    description: "Track all user actions with timestamps including page views, schedule changes, and feature usage. Create activity log dashboard for admins.",
    category: "analytics",
    status: "planned",
    votes: 5,
    isOfficial: true,
    createdAt: "2026-02-04T00:00:00Z",
  },
  {
    id: "int-2",
    title: "Two-Way Sync with Zuper",
    description: "Pull job status updates from Zuper back into the Operations Suite for real-time status tracking.",
    category: "integrations",
    status: "planned",
    votes: 4,
    isOfficial: true,
    createdAt: "2026-02-04T00:00:00Z",
  },
  {
    id: "int-3",
    title: "Google Calendar Export",
    description: "Export scheduled events directly to Google Calendar for team members to view on their personal calendars.",
    category: "integrations",
    status: "planned",
    votes: 3,
    isOfficial: true,
    createdAt: "2026-02-04T00:00:00Z",
  },
  {
    id: "ux-1",
    title: "Dark/Light Theme Toggle",
    description: "Add the ability to switch between dark and light themes based on user preference.",
    category: "ux",
    status: "planned",
    votes: 2,
    isOfficial: true,
    createdAt: "2026-02-04T00:00:00Z",
  },
  {
    id: "ux-2",
    title: "Mobile-Responsive Scheduler Views",
    description: "Make the Master Scheduler and Site Survey Scheduler fully usable on mobile devices.",
    category: "ux",
    status: "planned",
    votes: 3,
    isOfficial: true,
    createdAt: "2026-02-04T00:00:00Z",
  },
  {
    id: "feat-2",
    title: "Keyboard Shortcuts for Common Actions",
    description: "Add keyboard shortcuts throughout the app for power users to navigate and take actions faster.",
    category: "features",
    status: "planned",
    votes: 2,
    isOfficial: true,
    createdAt: "2026-02-04T00:00:00Z",
  },
  {
    id: "feat-3",
    title: "Bulk Scheduling Operations",
    description: "Allow selecting multiple projects at once and scheduling them in bulk to the same date or crew.",
    category: "features",
    status: "planned",
    votes: 4,
    isOfficial: true,
    createdAt: "2026-02-04T00:00:00Z",
  },
  {
    id: "analytics-2",
    title: "Historical Performance Trends",
    description: "View historical data and trends over time for pipeline stages, completion rates, and revenue.",
    category: "analytics",
    status: "planned",
    votes: 3,
    isOfficial: true,
    createdAt: "2026-02-04T00:00:00Z",
  },
  {
    id: "analytics-3",
    title: "Crew Utilization Reports",
    description: "Generate reports showing crew utilization, capacity vs. actual work, and efficiency metrics.",
    category: "analytics",
    status: "planned",
    votes: 2,
    isOfficial: true,
    createdAt: "2026-02-04T00:00:00Z",
  },
  {
    id: "int-4",
    title: "Email Notifications for Schedule Changes",
    description: "Send email notifications when schedules are changed, including to affected team members and customers.",
    category: "integrations",
    status: "planned",
    votes: 5,
    isOfficial: true,
    createdAt: "2026-02-04T00:00:00Z",
  },
];

async function ensureDataDir() {
  const dataDir = path.join(process.cwd(), "data");
  try {
    await fs.access(dataDir);
  } catch {
    await fs.mkdir(dataDir, { recursive: true });
  }
}

async function loadItems(): Promise<RoadmapItem[]> {
  await ensureDataDir();
  try {
    const data = await fs.readFile(DATA_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    // File doesn't exist, return defaults
    return DEFAULT_ITEMS;
  }
}

async function saveItems(items: RoadmapItem[]) {
  await ensureDataDir();
  await fs.writeFile(DATA_FILE, JSON.stringify(items, null, 2));
}

export async function GET() {
  try {
    const items = await loadItems();
    return NextResponse.json({ items });
  } catch (error) {
    console.error("Failed to load roadmap:", error);
    return NextResponse.json({ items: DEFAULT_ITEMS });
  }
}

// Admin endpoint to update item status (protected in real app)
export async function PUT(request: Request) {
  try {
    const { id, status } = await request.json();
    const items = await loadItems();
    const item = items.find(i => i.id === id);

    if (!item) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }

    item.status = status;
    await saveItems(items);

    return NextResponse.json({ item });
  } catch (error) {
    console.error("Failed to update roadmap item:", error);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}
