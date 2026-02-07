/**
 * Database Client
 *
 * Prisma client configured for Neon serverless PostgreSQL.
 * The database is optional - all functions gracefully handle the case
 * where DATABASE_URL is not set.
 */

import { PrismaClient } from "@/generated/prisma/client";
import { UserRole, ActivityType } from "@/generated/prisma/enums";
import { PrismaNeon } from "@prisma/adapter-neon";

// Re-export types
export { UserRole, ActivityType };
export type { User, ActivityLog, BookedSlot, AppSetting, ZuperJobCache, HubSpotProjectCache, ScheduleRecord, RateLimit } from "@/generated/prisma/client";

// Connection string
const connectionString = process.env.DATABASE_URL;

// Singleton pattern for Prisma client
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | null | undefined;
};

function createPrismaClient(): PrismaClient | null {
  if (!connectionString) {
    console.warn("DATABASE_URL not set - database features disabled");
    return null;
  }

  // Prisma 7 uses simplified adapter config
  const adapter = new PrismaNeon({ connectionString });

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development"
      ? ["query", "error", "warn"]
      : ["error"],
  });
}

// Initialize once
if (globalForPrisma.prisma === undefined) {
  globalForPrisma.prisma = createPrismaClient();
}

export const prisma = globalForPrisma.prisma;

// ==========================================
// HELPER FUNCTIONS
// ==========================================

/**
 * Check if database is configured and accessible
 */
export async function isDatabaseConfigured(): Promise<boolean> {
  if (!prisma) return false;

  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

/**
 * Get user by email
 */
export async function getUserByEmail(email: string) {
  if (!prisma) return null;

  return prisma.user.findUnique({
    where: { email },
  });
}

/**
 * Get or create user from OAuth
 */
export async function getOrCreateUser(userData: {
  email: string;
  name?: string;
  image?: string;
  googleId?: string;
}) {
  if (!prisma) return null;

  return prisma.user.upsert({
    where: { email: userData.email },
    update: {
      name: userData.name,
      image: userData.image,
      googleId: userData.googleId,
      lastLoginAt: new Date(),
    },
    create: {
      email: userData.email,
      name: userData.name,
      image: userData.image,
      googleId: userData.googleId,
      role: "VIEWER", // Default role for new users
      lastLoginAt: new Date(),
    },
  });
}

/**
 * Update user role
 */
export async function updateUserRole(userId: string, role: UserRole) {
  if (!prisma) return null;

  return prisma.user.update({
    where: { id: userId },
    data: { role },
  });
}

/**
 * Get all users
 */
export async function getAllUsers() {
  if (!prisma) return [];

  return prisma.user.findMany({
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Log an activity
 */
export async function logActivity(data: {
  type: ActivityType;
  description: string;
  userId?: string;
  userEmail?: string;
  userName?: string;
  entityType?: string;
  entityId?: string;
  entityName?: string;
  pbLocation?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  requestPath?: string;
  requestMethod?: string;
  responseStatus?: number;
  durationMs?: number;
  sessionId?: string;
}) {
  if (!prisma) return null;

  try {
    return await prisma.activityLog.create({
      data: {
        type: data.type,
        description: data.description,
        userId: data.userId,
        userEmail: data.userEmail,
        userName: data.userName,
        entityType: data.entityType,
        entityId: data.entityId,
        entityName: data.entityName,
        pbLocation: data.pbLocation,
        metadata: data.metadata ? JSON.parse(JSON.stringify(data.metadata)) : undefined,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
        requestPath: data.requestPath,
        requestMethod: data.requestMethod,
        responseStatus: data.responseStatus,
        durationMs: data.durationMs,
        sessionId: data.sessionId,
      },
    });
  } catch (error) {
    console.error("Failed to log activity:", error);
    return null;
  }
}

/**
 * Log a dashboard view
 */
export async function logDashboardView(data: {
  dashboard: string;
  userEmail?: string;
  userName?: string;
  filters?: Record<string, unknown>;
  projectCount?: number;
  pbLocation?: string;
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
}) {
  return logActivity({
    type: "DASHBOARD_VIEWED",
    description: `Viewed ${data.dashboard} dashboard`,
    userEmail: data.userEmail,
    userName: data.userName,
    entityType: "dashboard",
    entityId: data.dashboard,
    entityName: data.dashboard,
    pbLocation: data.pbLocation,
    metadata: {
      filters: data.filters,
      projectCount: data.projectCount,
    },
    ipAddress: data.ipAddress,
    userAgent: data.userAgent,
    sessionId: data.sessionId,
  });
}

/**
 * Log a project view
 */
export async function logProjectView(data: {
  projectId: string;
  projectName: string;
  userEmail?: string;
  userName?: string;
  source?: string; // "dashboard", "search", "direct"
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
}) {
  return logActivity({
    type: "PROJECT_VIEWED",
    description: `Viewed project ${data.projectName}`,
    userEmail: data.userEmail,
    userName: data.userName,
    entityType: "project",
    entityId: data.projectId,
    entityName: data.projectName,
    metadata: { source: data.source },
    ipAddress: data.ipAddress,
    userAgent: data.userAgent,
    sessionId: data.sessionId,
  });
}

/**
 * Log a search action
 */
export async function logSearch(data: {
  searchTerm: string;
  resultCount: number;
  dashboard?: string;
  userEmail?: string;
  userName?: string;
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
}) {
  return logActivity({
    type: "PROJECT_SEARCHED",
    description: `Searched for "${data.searchTerm}" (${data.resultCount} results)`,
    userEmail: data.userEmail,
    userName: data.userName,
    entityType: "search",
    entityName: data.dashboard || "global",
    metadata: {
      searchTerm: data.searchTerm,
      resultCount: data.resultCount,
      dashboard: data.dashboard,
    },
    ipAddress: data.ipAddress,
    userAgent: data.userAgent,
    sessionId: data.sessionId,
  });
}

/**
 * Log a filter change
 */
export async function logFilterChange(data: {
  dashboard: string;
  filters: Record<string, unknown>;
  userEmail?: string;
  userName?: string;
  sessionId?: string;
}) {
  return logActivity({
    type: "DASHBOARD_FILTERED",
    description: `Applied filters on ${data.dashboard}`,
    userEmail: data.userEmail,
    userName: data.userName,
    entityType: "dashboard",
    entityId: data.dashboard,
    entityName: data.dashboard,
    metadata: { filters: data.filters },
    sessionId: data.sessionId,
  });
}

/**
 * Log an API error
 */
export async function logApiError(data: {
  endpoint: string;
  method: string;
  error: string;
  statusCode?: number;
  userEmail?: string;
  ipAddress?: string;
  userAgent?: string;
  requestBody?: unknown;
}) {
  return logActivity({
    type: "API_ERROR",
    description: `API error on ${data.method} ${data.endpoint}: ${data.error}`,
    userEmail: data.userEmail,
    entityType: "api",
    entityId: data.endpoint,
    entityName: `${data.method} ${data.endpoint}`,
    metadata: {
      error: data.error,
      statusCode: data.statusCode,
      requestBody: data.requestBody,
    },
    ipAddress: data.ipAddress,
    userAgent: data.userAgent,
    requestPath: data.endpoint,
    requestMethod: data.method,
    responseStatus: data.statusCode,
  });
}

/**
 * Log a data export
 */
export async function logDataExport(data: {
  exportType: string; // "csv", "pdf", "excel"
  dashboard?: string;
  recordCount: number;
  userEmail?: string;
  userName?: string;
  filters?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}) {
  return logActivity({
    type: "DATA_EXPORTED",
    description: `Exported ${data.recordCount} records as ${data.exportType}`,
    userEmail: data.userEmail,
    userName: data.userName,
    entityType: "export",
    entityName: data.dashboard || "data",
    metadata: {
      exportType: data.exportType,
      recordCount: data.recordCount,
      dashboard: data.dashboard,
      filters: data.filters,
    },
    ipAddress: data.ipAddress,
    userAgent: data.userAgent,
  });
}

/**
 * Get recent activities
 */
export async function getRecentActivities(options?: {
  userId?: string;
  type?: ActivityType;
  entityType?: string;
  limit?: number;
}) {
  if (!prisma) return [];

  return prisma.activityLog.findMany({
    where: {
      userId: options?.userId,
      type: options?.type,
      entityType: options?.entityType,
    },
    include: {
      user: {
        select: { name: true, email: true, image: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: options?.limit ?? 50,
  });
}

// ==========================================
// ROLE-BASED ACCESS HELPERS
// ==========================================

/**
 * Permission structure for roles
 */
export interface RolePermissions {
  allowedRoutes: string[];
  canScheduleSurveys: boolean;
  canScheduleInstalls: boolean;
  canScheduleInspections: boolean;
  canSyncZuper: boolean;
  canManageUsers: boolean;
  canEditDesign: boolean;
  canEditPermitting: boolean;
  canViewAllLocations: boolean;
}

/**
 * Define which routes and actions each role can access
 */
export const ROLE_PERMISSIONS: Record<UserRole, RolePermissions> = {
  ADMIN: {
    allowedRoutes: ["*"], // All routes
    canScheduleSurveys: true,
    canScheduleInstalls: true,
    canScheduleInspections: true,
    canSyncZuper: true,
    canManageUsers: true,
    canEditDesign: true,
    canEditPermitting: true,
    canViewAllLocations: true,
  },
  MANAGER: {
    allowedRoutes: ["*"], // All routes
    canScheduleSurveys: true,
    canScheduleInstalls: true,
    canScheduleInspections: true,
    canSyncZuper: true,
    canManageUsers: false,
    canEditDesign: true,
    canEditPermitting: true,
    canViewAllLocations: true,
  },
  OPERATIONS: {
    allowedRoutes: [
      "/dashboards/construction",
      "/dashboards/construction-scheduler",
      "/dashboards/inspection-scheduler",
      "/dashboards/scheduler",
      "/dashboards/command-center",
      "/dashboards/at-risk",
      "/dashboards/timeline",
      "/api/projects",
      "/api/zuper",
    ],
    canScheduleSurveys: false,
    canScheduleInstalls: true,
    canScheduleInspections: true,
    canSyncZuper: true,
    canManageUsers: false,
    canEditDesign: false,
    canEditPermitting: false,
    canViewAllLocations: true,
  },
  DESIGNER: {
    allowedRoutes: [
      "/dashboards/design",
      "/dashboards/pe",
      "/dashboards/timeline",
      "/api/projects",
    ],
    canScheduleSurveys: false,
    canScheduleInstalls: false,
    canScheduleInspections: false,
    canSyncZuper: false,
    canManageUsers: false,
    canEditDesign: true,
    canEditPermitting: false,
    canViewAllLocations: true,
  },
  PERMITTING: {
    allowedRoutes: [
      "/dashboards/permitting",
      "/dashboards/interconnection",
      "/dashboards/timeline",
      "/api/projects",
    ],
    canScheduleSurveys: false,
    canScheduleInstalls: false,
    canScheduleInspections: false,
    canSyncZuper: false,
    canManageUsers: false,
    canEditDesign: false,
    canEditPermitting: true,
    canViewAllLocations: true,
  },
  VIEWER: {
    allowedRoutes: ["*"], // All routes, read-only
    canScheduleSurveys: false,
    canScheduleInstalls: false,
    canScheduleInspections: false,
    canSyncZuper: false,
    canManageUsers: false,
    canEditDesign: false,
    canEditPermitting: false,
    canViewAllLocations: true,
  },
  SALES: {
    allowedRoutes: [
      "/dashboards/site-survey-scheduler",
      "/dashboards/sales",
      "/api/projects",
      "/api/zuper/availability",
      "/api/zuper/status",
      "/api/zuper/jobs/lookup",
      "/api/zuper/jobs/schedule",
    ],
    canScheduleSurveys: true,
    canScheduleInstalls: false,
    canScheduleInspections: false,
    canSyncZuper: true,
    canManageUsers: false,
    canEditDesign: false,
    canEditPermitting: false,
    canViewAllLocations: false, // SALES sees only their location
  },
};

/**
 * Check if a user role can access a specific route
 */
export function canAccessRoute(role: UserRole, route: string): boolean {
  const permissions = ROLE_PERMISSIONS[role];
  if (!permissions) return false;

  // Roles with "*" can access all routes
  if (permissions.allowedRoutes.includes("*")) return true;

  // Check specific routes
  return permissions.allowedRoutes.some(allowed =>
    route.startsWith(allowed)
  );
}

/**
 * Check if user can schedule a specific type
 */
export function canScheduleType(role: UserRole, scheduleType: "survey" | "installation" | "inspection"): boolean {
  const permissions = ROLE_PERMISSIONS[role];
  if (!permissions) return false;

  switch (scheduleType) {
    case "survey":
      return permissions.canScheduleSurveys;
    case "installation":
      return permissions.canScheduleInstalls;
    case "inspection":
      return permissions.canScheduleInspections;
    default:
      return false;
  }
}

/**
 * Check if user can perform any scheduling actions (legacy support)
 */
export function canSchedule(role: UserRole): boolean {
  const permissions = ROLE_PERMISSIONS[role];
  if (!permissions) return false;
  return permissions.canScheduleSurveys || permissions.canScheduleInstalls || permissions.canScheduleInspections;
}

/**
 * Get user's permissions (combines role + user-specific overrides)
 */
export async function getUserPermissions(userEmail: string): Promise<RolePermissions | null> {
  if (!prisma) return null;

  const user = await prisma.user.findUnique({
    where: { email: userEmail },
    select: {
      role: true,
      canScheduleSurveys: true,
      canScheduleInstalls: true,
      canSyncToZuper: true,
      canManageUsers: true,
      allowedLocations: true,
    },
  });

  if (!user) return null;

  // Start with role permissions
  const basePermissions = ROLE_PERMISSIONS[user.role];
  if (!basePermissions) return null;

  // Apply user-specific overrides (true in user overrides role)
  return {
    ...basePermissions,
    canScheduleSurveys: user.canScheduleSurveys || basePermissions.canScheduleSurveys,
    canScheduleInstalls: user.canScheduleInstalls || basePermissions.canScheduleInstalls,
    canSyncZuper: user.canSyncToZuper || basePermissions.canSyncZuper,
    canManageUsers: user.canManageUsers || basePermissions.canManageUsers,
    // Location restriction: if user has specific locations, they can't view all
    canViewAllLocations: user.allowedLocations.length === 0 && basePermissions.canViewAllLocations,
  };
}

/**
 * Check if user can sync to Zuper
 */
export function canSyncZuper(role: UserRole): boolean {
  return ROLE_PERMISSIONS[role]?.canSyncZuper ?? false;
}

// ==========================================
// ZUPER JOB CACHE
// ==========================================

/**
 * Cache a Zuper job
 */
export async function cacheZuperJob(job: {
  jobUid: string;
  jobTitle: string;
  jobCategory: string;
  jobStatus: string;
  jobPriority?: string;
  scheduledStart?: Date;
  scheduledEnd?: Date;
  assignedUsers?: { user_uid: string; user_name?: string }[];
  assignedTeam?: string;
  customerAddress?: { street?: string; city?: string; state?: string; zip_code?: string };
  hubspotDealId?: string;
  projectName?: string;
  jobTags?: string[];
  jobNotes?: string;
  rawData?: unknown;
}) {
  if (!prisma) return null;

  try {
    return await prisma.zuperJobCache.upsert({
      where: { jobUid: job.jobUid },
      update: {
        jobTitle: job.jobTitle,
        jobCategory: job.jobCategory,
        jobStatus: job.jobStatus,
        jobPriority: job.jobPriority,
        scheduledStart: job.scheduledStart,
        scheduledEnd: job.scheduledEnd,
        assignedUsers: job.assignedUsers ? JSON.parse(JSON.stringify(job.assignedUsers)) : null,
        assignedTeam: job.assignedTeam,
        customerAddress: job.customerAddress ? JSON.parse(JSON.stringify(job.customerAddress)) : null,
        hubspotDealId: job.hubspotDealId,
        projectName: job.projectName,
        jobTags: job.jobTags || [],
        jobNotes: job.jobNotes,
        rawData: job.rawData ? JSON.parse(JSON.stringify(job.rawData)) : null,
        lastSyncedAt: new Date(),
      },
      create: {
        jobUid: job.jobUid,
        jobTitle: job.jobTitle,
        jobCategory: job.jobCategory,
        jobStatus: job.jobStatus,
        jobPriority: job.jobPriority,
        scheduledStart: job.scheduledStart,
        scheduledEnd: job.scheduledEnd,
        assignedUsers: job.assignedUsers ? JSON.parse(JSON.stringify(job.assignedUsers)) : null,
        assignedTeam: job.assignedTeam,
        customerAddress: job.customerAddress ? JSON.parse(JSON.stringify(job.customerAddress)) : null,
        hubspotDealId: job.hubspotDealId,
        projectName: job.projectName,
        jobTags: job.jobTags || [],
        jobNotes: job.jobNotes,
        rawData: job.rawData ? JSON.parse(JSON.stringify(job.rawData)) : null,
      },
    });
  } catch (error) {
    console.error("Failed to cache Zuper job:", error);
    return null;
  }
}

/**
 * Get cached Zuper job by HubSpot deal ID
 */
export async function getCachedZuperJobByDealId(dealId: string, category?: string) {
  if (!prisma) return null;

  return prisma.zuperJobCache.findFirst({
    where: {
      hubspotDealId: dealId,
      ...(category && { jobCategory: category }),
    },
    orderBy: { lastSyncedAt: "desc" },
  });
}

/**
 * Get cached Zuper jobs by HubSpot deal IDs (bulk lookup)
 */
export async function getCachedZuperJobsByDealIds(dealIds: string[], category?: string) {
  if (!prisma) return [];

  return prisma.zuperJobCache.findMany({
    where: {
      hubspotDealId: { in: dealIds },
      ...(category && { jobCategory: category }),
    },
  });
}

/**
 * Check if cache is stale (older than maxAge minutes)
 */
export async function isZuperCacheStale(dealId: string, maxAgeMinutes: number = 5): Promise<boolean> {
  if (!prisma) return true;

  const cached = await prisma.zuperJobCache.findFirst({
    where: { hubspotDealId: dealId },
    select: { lastSyncedAt: true },
  });

  if (!cached) return true;

  const ageMs = Date.now() - cached.lastSyncedAt.getTime();
  return ageMs > maxAgeMinutes * 60 * 1000;
}

// ==========================================
// SCHEDULE RECORDS
// ==========================================

/**
 * Create a schedule record
 */
export async function createScheduleRecord(data: {
  scheduleType: string;
  projectId: string;
  projectName: string;
  scheduledDate: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  assignedUser?: string;
  assignedUserUid?: string;
  assignedTeamUid?: string;
  scheduledBy?: string;
  zuperJobUid?: string;
  zuperSynced?: boolean;
  zuperAssigned?: boolean;
  zuperError?: string;
  notes?: string;
}) {
  if (!prisma) return null;

  try {
    return await prisma.scheduleRecord.create({
      data: {
        scheduleType: data.scheduleType,
        projectId: data.projectId,
        projectName: data.projectName,
        scheduledDate: data.scheduledDate,
        scheduledStart: data.scheduledStart,
        scheduledEnd: data.scheduledEnd,
        assignedUser: data.assignedUser,
        assignedUserUid: data.assignedUserUid,
        assignedTeamUid: data.assignedTeamUid,
        scheduledBy: data.scheduledBy,
        zuperJobUid: data.zuperJobUid,
        zuperSynced: data.zuperSynced ?? false,
        zuperAssigned: data.zuperAssigned ?? false,
        zuperError: data.zuperError,
        notes: data.notes,
      },
    });
  } catch (error) {
    console.error("Failed to create schedule record:", error);
    return null;
  }
}

/**
 * Get schedule records for a project
 */
export async function getScheduleRecordsForProject(projectId: string) {
  if (!prisma) return [];

  return prisma.scheduleRecord.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Get schedule records that need manual assignment in Zuper
 */
export async function getUnassignedScheduleRecords() {
  if (!prisma) return [];

  return prisma.scheduleRecord.findMany({
    where: {
      zuperSynced: true,
      zuperAssigned: false,
      status: "scheduled",
    },
    orderBy: { scheduledDate: "asc" },
  });
}

/**
 * Update schedule record with Zuper sync status
 */
export async function updateScheduleRecordZuperStatus(
  id: string,
  status: { zuperJobUid?: string; zuperSynced?: boolean; zuperAssigned?: boolean; zuperError?: string }
) {
  if (!prisma) return null;

  return prisma.scheduleRecord.update({
    where: { id },
    data: status,
  });
}

/**
 * Get schedule records by date range
 */
export async function getScheduleRecordsByDateRange(startDate: string, endDate: string, scheduleType?: string) {
  if (!prisma) return [];

  return prisma.scheduleRecord.findMany({
    where: {
      scheduledDate: { gte: startDate, lte: endDate },
      ...(scheduleType && { scheduleType }),
      status: { not: "cancelled" },
    },
    orderBy: { scheduledDate: "asc" },
  });
}

// ==========================================
// CREW MEMBERS (Zuper User Configuration)
// ==========================================

export type CrewMember = {
  id: string;
  name: string;
  email: string | null;
  zuperUserUid: string;
  zuperTeamUid: string | null;
  role: string;
  locations: string[];
  isActive: boolean;
  maxDailyJobs: number;
};

/**
 * Get all active crew members
 */
export async function getActiveCrewMembers(role?: string): Promise<CrewMember[]> {
  if (!prisma) return [];

  return prisma.crewMember.findMany({
    where: {
      isActive: true,
      ...(role && { role }),
    },
    orderBy: { name: "asc" },
  });
}

/**
 * Get crew member by name
 */
export async function getCrewMemberByName(name: string): Promise<CrewMember | null> {
  if (!prisma) return null;

  return prisma.crewMember.findUnique({
    where: { name },
  });
}

/**
 * Get crew members for a specific location
 */
export async function getCrewMembersForLocation(location: string, role?: string): Promise<CrewMember[]> {
  if (!prisma) return [];

  const allCrew = await prisma.crewMember.findMany({
    where: {
      isActive: true,
      ...(role && { role }),
    },
    orderBy: { name: "asc" },
  });

  // Filter by location - empty locations array means "all locations"
  return allCrew.filter(crew =>
    crew.locations.length === 0 || crew.locations.includes(location)
  );
}

/**
 * Create or update a crew member
 */
export async function upsertCrewMember(data: {
  name: string;
  email?: string;
  zuperUserUid: string;
  zuperTeamUid?: string;
  role?: string;
  locations?: string[];
  isActive?: boolean;
  maxDailyJobs?: number;
}): Promise<CrewMember | null> {
  if (!prisma) return null;

  return prisma.crewMember.upsert({
    where: { name: data.name },
    create: {
      name: data.name,
      email: data.email,
      zuperUserUid: data.zuperUserUid,
      zuperTeamUid: data.zuperTeamUid,
      role: data.role || "technician",
      locations: data.locations || [],
      isActive: data.isActive ?? true,
      maxDailyJobs: data.maxDailyJobs || 4,
    },
    update: {
      email: data.email,
      zuperUserUid: data.zuperUserUid,
      zuperTeamUid: data.zuperTeamUid,
      role: data.role,
      locations: data.locations,
      isActive: data.isActive,
      maxDailyJobs: data.maxDailyJobs,
    },
  });
}

/**
 * Get crew member lookup map (name -> UIDs)
 * This is used by the scheduling API to look up Zuper UIDs
 */
export async function getCrewMemberLookup(): Promise<Record<string, { userUid: string; teamUid?: string }>> {
  const crew = await getActiveCrewMembers();

  const lookup: Record<string, { userUid: string; teamUid?: string }> = {};
  for (const member of crew) {
    lookup[member.name] = {
      userUid: member.zuperUserUid,
      ...(member.zuperTeamUid && { teamUid: member.zuperTeamUid }),
    };
  }

  return lookup;
}
