import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma, getUserByEmail } from "@/lib/db";

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

// Default roadmap items - used to seed the database
const DEFAULT_ITEMS: Omit<RoadmapItem, "createdAt">[] = [
  {
    id: "security-1",
    title: "Security & Role-Based Access Control",
    description: "Comprehensive security headers, role enforcement for scheduling, database-backed rate limiting, and crew notification emails.",
    category: "features",
    status: "completed",
    votes: 15,
    isOfficial: true,
  },
  {
    id: "ux-3",
    title: "Dashboard Status Groups Reorganization",
    description: "Reorganized status filter groups across all dashboards for better workflow organization and logical groupings.",
    category: "ux",
    status: "completed",
    votes: 6,
    isOfficial: true,
  },
  {
    id: "ux-4",
    title: "Scheduler Calendar Full Event Display",
    description: "All scheduler calendars now show complete event lists without truncation - no more '+X more' indicators.",
    category: "ux",
    status: "completed",
    votes: 8,
    isOfficial: true,
  },
  {
    id: "perf-1",
    title: "Make Loading Faster",
    description: "Implement data caching, pagination, and optimize HubSpot API calls to reduce load times across all dashboards.",
    category: "performance",
    status: "completed",
    votes: 12,
    isOfficial: true,
  },
  {
    id: "feat-1",
    title: "User Access Levels & Control",
    description: "Add role-based permissions (Admin, Manager, Viewer, Sales) with permission-based route protection and an admin panel for user management.",
    category: "features",
    status: "completed",
    votes: 8,
    isOfficial: true,
  },
  {
    id: "int-1",
    title: "Zuper Job Links in Scheduler Tools",
    description: "Display links to Zuper jobs alongside HubSpot links in Site Survey Scheduler and Master Scheduler project cards.",
    category: "integrations",
    status: "completed",
    votes: 6,
    isOfficial: true,
  },
  {
    id: "analytics-1",
    title: "Detailed User Activity Tracking",
    description: "Track all user actions with timestamps including page views, schedule changes, and feature usage. Create activity log dashboard for admins.",
    category: "analytics",
    status: "completed",
    votes: 5,
    isOfficial: true,
  },
  {
    id: "int-2",
    title: "Two-Way Sync with Zuper",
    description: "Pull job status updates from Zuper back into the Operations Suite for real-time status tracking.",
    category: "integrations",
    status: "planned",
    votes: 4,
    isOfficial: true,
  },
  {
    id: "int-3",
    title: "Google Calendar Export",
    description: "Export scheduled events directly to Google Calendar for team members to view on their personal calendars.",
    category: "integrations",
    status: "planned",
    votes: 3,
    isOfficial: true,
  },
  {
    id: "ux-1",
    title: "Dark/Light Theme Toggle",
    description: "Add the ability to switch between dark and light themes based on user preference.",
    category: "ux",
    status: "planned",
    votes: 2,
    isOfficial: true,
  },
  {
    id: "ux-2",
    title: "Mobile-Responsive Scheduler Views",
    description: "Make the Master Scheduler and Site Survey Scheduler fully usable on mobile devices.",
    category: "ux",
    status: "planned",
    votes: 3,
    isOfficial: true,
  },
  {
    id: "feat-2",
    title: "Keyboard Shortcuts for Common Actions",
    description: "Add keyboard shortcuts throughout the app for power users to navigate and take actions faster.",
    category: "features",
    status: "planned",
    votes: 2,
    isOfficial: true,
  },
  {
    id: "feat-3",
    title: "Bulk Scheduling Operations",
    description: "Allow selecting multiple projects at once and scheduling them in bulk to the same date or crew.",
    category: "features",
    status: "planned",
    votes: 4,
    isOfficial: true,
  },
  {
    id: "analytics-2",
    title: "Historical Performance Trends",
    description: "View historical data and trends over time for pipeline stages, completion rates, and revenue.",
    category: "analytics",
    status: "planned",
    votes: 3,
    isOfficial: true,
  },
  {
    id: "analytics-3",
    title: "Crew Utilization Reports",
    description: "Generate reports showing crew utilization, capacity vs. actual work, and efficiency metrics.",
    category: "analytics",
    status: "planned",
    votes: 2,
    isOfficial: true,
  },
  {
    id: "int-4",
    title: "Customer Notifications via Zuper",
    description: "Customers receive SMS/Email notifications when jobs are scheduled through Zuper integration.",
    category: "integrations",
    status: "completed",
    votes: 5,
    isOfficial: true,
  },
  {
    id: "int-5",
    title: "Crew Scheduling Notifications",
    description: "Crew members receive email notifications when they are scheduled for appointments with customer details, address, and scheduler info.",
    category: "integrations",
    status: "completed",
    votes: 7,
    isOfficial: true,
  },
  {
    id: "ux-5",
    title: "Improved Availability Display",
    description: "Better visibility of surveyor availability on Site Survey Scheduler with grouped slots and no truncation.",
    category: "ux",
    status: "completed",
    votes: 5,
    isOfficial: true,
  },
];

async function loadItems(): Promise<RoadmapItem[]> {
  if (!prisma) {
    // No database - return defaults
    return DEFAULT_ITEMS.map(item => ({
      ...item,
      createdAt: new Date().toISOString(),
    }));
  }

  try {
    // Check if we have items in the database
    const count = await prisma.roadmapItem.count();

    if (count === 0) {
      // Seed the database with default items
      for (const item of DEFAULT_ITEMS) {
        await prisma.roadmapItem.create({
          data: {
            id: item.id,
            title: item.title,
            description: item.description,
            category: item.category,
            status: item.status,
            votes: item.votes,
            isOfficial: item.isOfficial,
            submittedBy: item.submittedBy,
          },
        });
      }
    }

    // Load from database
    const items = await prisma.roadmapItem.findMany({
      orderBy: [{ votes: "desc" }, { createdAt: "desc" }],
    });

    return items.map(item => ({
      id: item.id,
      title: item.title,
      description: item.description,
      category: item.category as RoadmapItem["category"],
      status: item.status as RoadmapItem["status"],
      votes: item.votes,
      isOfficial: item.isOfficial,
      submittedBy: item.submittedBy || undefined,
      createdAt: item.createdAt.toISOString(),
    }));
  } catch (error) {
    console.error("Failed to load roadmap items from database:", error);
    // Fallback to defaults
    return DEFAULT_ITEMS.map(item => ({
      ...item,
      createdAt: new Date().toISOString(),
    }));
  }
}

export async function GET() {
  try {
    const items = await loadItems();
    return NextResponse.json({ items });
  } catch (error) {
    console.error("Failed to load roadmap:", error);
    return NextResponse.json({
      items: DEFAULT_ITEMS.map(item => ({
        ...item,
        createdAt: new Date().toISOString(),
      })),
    });
  }
}

// Update item status (admin only - server-side enforced)
export async function PUT(request: Request) {
  try {
    // Verify user is authenticated and is an ADMIN
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Check if user is admin in database
    const currentUser = await getUserByEmail(session.user.email);
    if (!currentUser || currentUser.role !== "ADMIN") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
    }

    const { id, status } = body;

    if (!id || !status) {
      return NextResponse.json({ error: "Missing id or status" }, { status: 400 });
    }

    const validStatuses = ["planned", "in-progress", "under-review", "completed"];
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    if (!prisma) {
      return NextResponse.json({ error: "Database not configured" }, { status: 503 });
    }

    // Update in database
    const updated = await prisma.roadmapItem.update({
      where: { id },
      data: { status },
    });

    return NextResponse.json({
      item: {
        id: updated.id,
        title: updated.title,
        description: updated.description,
        category: updated.category,
        status: updated.status,
        votes: updated.votes,
        isOfficial: updated.isOfficial,
        submittedBy: updated.submittedBy,
        createdAt: updated.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error("Failed to update roadmap item:", error);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}
