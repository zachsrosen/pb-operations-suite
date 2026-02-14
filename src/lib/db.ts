/**
 * Database Client
 *
 * Prisma client configured for Neon serverless PostgreSQL.
 * The database is optional - all functions gracefully handle the case
 * where DATABASE_URL is not set.
 */

import { PrismaClient } from "@/generated/prisma/client";
import { ActivityType } from "@/generated/prisma/enums";
import { PrismaNeon } from "@prisma/adapter-neon";

// Import for local use + re-export role permissions from edge-compatible module
import { UserRole, ROLE_PERMISSIONS, type RolePermissions } from "./role-permissions";
export { UserRole, ROLE_PERMISSIONS, normalizeRole, canAccessRoute, canScheduleType, canSchedule, canSyncZuper } from "./role-permissions";
export type { RolePermissions } from "./role-permissions";

// Re-export types
export { ActivityType };
export type { User, ActivityLog, BookedSlot, AppSetting, ZuperJobCache, HubSpotProjectCache, ScheduleRecord, RateLimit, AvailabilityOverride } from "@/generated/prisma/client";

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
}, options?: {
  touchLastLogin?: boolean;
}) {
  if (!prisma) return null;

  const touchLastLogin = options?.touchLastLogin === true;

  return prisma.user.upsert({
    where: { email: userData.email },
    update: {
      name: userData.name,
      image: userData.image,
      googleId: userData.googleId,
      ...(touchLastLogin ? { lastLoginAt: new Date() } : {}),
    },
    create: {
      email: userData.email,
      name: userData.name,
      image: userData.image,
      googleId: userData.googleId,
      role: "VIEWER", // Unassigned by default until admin assigns access
      ...(touchLastLogin ? { lastLoginAt: new Date() } : {}),
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
    orderBy: { lastLoginAt: { sort: "desc", nulls: "last" } },
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
 * Get recent activities with pagination and date filtering
 */
export async function getRecentActivities(options?: {
  userId?: string;
  type?: ActivityType;
  entityType?: string;
  limit?: number;
  offset?: number;
  since?: Date;
  userEmail?: string;
}) {
  if (!prisma) return { activities: [], total: 0 };

  const where: Record<string, unknown> = {};
  if (options?.userId) where.userId = options.userId;
  if (options?.type) where.type = options.type;
  if (options?.entityType) where.entityType = options.entityType;
  if (options?.since) where.createdAt = { gte: options.since };
  if (options?.userEmail) {
    where.OR = [
      { userEmail: { contains: options.userEmail, mode: "insensitive" } },
      { user: { email: { contains: options.userEmail, mode: "insensitive" } } },
    ];
  }

  const [activities, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      include: {
        user: {
          select: { name: true, email: true, image: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: options?.limit ?? 50,
      skip: options?.offset ?? 0,
    }),
    prisma.activityLog.count({ where }),
  ]);

  return { activities, total };
}

/**
 * Get all distinct activity types that exist in the database
 */
export async function getActivityTypes() {
  if (!prisma) return [];

  const result = await prisma.activityLog.findMany({
    select: { type: true },
    distinct: ["type"],
    orderBy: { type: "asc" },
  });

  return result.map((r) => r.type);
}

// ==========================================
// ROLE-BASED ACCESS HELPERS
// ==========================================
// Note: ROLE_PERMISSIONS, canAccessRoute, canScheduleType, canSchedule,
// canSyncZuper, RolePermissions, and UserRole are all defined in
// src/lib/role-permissions.ts (edge-compatible) and re-exported above.

/**
 * Get user's permissions (combines role + user-specific overrides)
 * NOTE: This function requires Prisma and CANNOT run in Edge Runtime.
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
      canManageAvailability: true,
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
    canManageAvailability: user.canManageAvailability || basePermissions.canManageAvailability,
    // Location restriction: if user has specific locations, they can't view all
    canViewAllLocations: user.allowedLocations.length === 0 && basePermissions.canViewAllLocations,
  };
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
  scheduledDays?: number;
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
        scheduledDays: data.scheduledDays,
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
  teamName: string | null;
  permissions: string[];
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
 * Get crew member by email (for linking logged-in users to their crew profile)
 */
export async function getCrewMemberByEmail(email: string): Promise<CrewMember | null> {
  if (!prisma) return null;

  return prisma.crewMember.findFirst({
    where: { email, isActive: true },
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
  teamName?: string;
  permissions?: string[];
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
      teamName: data.teamName,
      permissions: data.permissions || [],
      isActive: data.isActive ?? true,
      maxDailyJobs: data.maxDailyJobs || 4,
    },
    update: {
      email: data.email,
      zuperUserUid: data.zuperUserUid,
      zuperTeamUid: data.zuperTeamUid,
      role: data.role,
      locations: data.locations,
      teamName: data.teamName,
      permissions: data.permissions,
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

// ==========================================
// CREW AVAILABILITY
// ==========================================

/**
 * Get crew availability records with optional filters
 */
export async function getCrewAvailabilities(filters?: {
  crewMemberId?: string;
  location?: string;
  jobType?: string;
  dayOfWeek?: number;
  isActive?: boolean;
}) {
  if (!prisma) return [];

  return prisma.crewAvailability.findMany({
    where: {
      ...(filters?.crewMemberId && { crewMemberId: filters.crewMemberId }),
      ...(filters?.location && { location: filters.location }),
      ...(filters?.jobType && { jobType: filters.jobType }),
      ...(filters?.dayOfWeek !== undefined && { dayOfWeek: filters.dayOfWeek }),
      ...(filters?.isActive !== undefined && { isActive: filters.isActive }),
    },
    include: {
      crewMember: {
        select: { name: true, zuperUserUid: true, zuperTeamUid: true, isActive: true },
      },
    },
    orderBy: [{ crewMember: { name: "asc" } }, { dayOfWeek: "asc" }, { startTime: "asc" }],
  });
}

/**
 * Create or update a crew availability slot
 */
export async function upsertCrewAvailability(data: {
  id?: string;
  crewMemberId: string;
  location: string;
  reportLocation?: string;
  jobType: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  timezone?: string;
  isActive?: boolean;
  updatedBy?: string;
  createdBy?: string;
}) {
  if (!prisma) return null;

  if (data.id) {
    return prisma.crewAvailability.update({
      where: { id: data.id },
      data: {
        crewMemberId: data.crewMemberId,
        location: data.location,
        reportLocation: data.reportLocation,
        jobType: data.jobType,
        dayOfWeek: data.dayOfWeek,
        startTime: data.startTime,
        endTime: data.endTime,
        timezone: data.timezone || "America/Denver",
        isActive: data.isActive ?? true,
        updatedBy: data.updatedBy,
      },
    });
  }

  return prisma.crewAvailability.create({
    data: {
      crewMemberId: data.crewMemberId,
      location: data.location,
      reportLocation: data.reportLocation,
      jobType: data.jobType,
      dayOfWeek: data.dayOfWeek,
      startTime: data.startTime,
      endTime: data.endTime,
      timezone: data.timezone || "America/Denver",
      isActive: data.isActive ?? true,
      createdBy: data.createdBy,
      updatedBy: data.updatedBy,
    },
  });
}

/**
 * Delete a crew availability slot
 */
export async function deleteCrewAvailability(id: string) {
  if (!prisma) return null;

  return prisma.crewAvailability.delete({
    where: { id },
  });
}

/**
 * Convert DB crew availability records to the CrewSchedule format
 * used by the availability route. Groups by crew member name.
 */
export async function getCrewSchedulesFromDB(): Promise<Array<{
  crewMemberId: string;
  name: string;
  location: string;
  reportLocation: string;
  schedule: Array<{ day: number; startTime: string; endTime: string; availabilityId: string }>;
  jobTypes: string[];
  userUid?: string;
  teamUid?: string;
  timezone?: string;
}>> {
  if (!prisma) return [];

  const records = await prisma.crewAvailability.findMany({
    where: { isActive: true },
    include: {
      crewMember: {
        select: { name: true, zuperUserUid: true, zuperTeamUid: true, isActive: true },
      },
    },
  });

  // Only include records where the crew member is active
  const activeRecords = records.filter(r => r.crewMember.isActive);

  // Group by crew member + location combo
  const grouped = new Map<string, {
    crewMemberId: string;
    name: string;
    location: string;
    reportLocation: string;
    schedule: Array<{ day: number; startTime: string; endTime: string; availabilityId: string }>;
    jobTypes: Set<string>;
    userUid?: string;
    teamUid?: string;
    timezone?: string;
  }>();

  for (const record of activeRecords) {
    const key = `${record.crewMember.name}|${record.location}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        crewMemberId: record.crewMemberId,
        name: record.crewMember.name,
        location: record.location,
        reportLocation: record.reportLocation || record.location,
        schedule: [],
        jobTypes: new Set(),
        userUid: record.crewMember.zuperUserUid,
        teamUid: record.crewMember.zuperTeamUid || undefined,
        timezone: record.timezone !== "America/Denver" ? record.timezone : undefined,
      });
    }
    const group = grouped.get(key)!;
    group.schedule.push({
      day: record.dayOfWeek,
      startTime: record.startTime,
      endTime: record.endTime,
      availabilityId: record.id,
    });
    group.jobTypes.add(record.jobType);
  }

  return Array.from(grouped.values()).map(g => ({
    ...g,
    jobTypes: Array.from(g.jobTypes),
  }));
}

// ==========================================
// AVAILABILITY OVERRIDES (Date-specific exceptions)
// ==========================================

/**
 * Get overrides for a crew member within a date range.
 * Used by the availability API to check if a recurring slot
 * should be blocked or modified on a specific date.
 */
export async function getAvailabilityOverrides(filters?: {
  crewMemberId?: string;
  dateFrom?: string;
  dateTo?: string;
  date?: string;
}): Promise<Array<{
  id: string;
  crewMemberId: string;
  date: string;
  availabilityId: string | null;
  type: string;
  reason: string | null;
  startTime: string | null;
  endTime: string | null;
  createdBy: string | null;
  createdAt: Date;
  crewMember: { name: string; isActive: boolean };
}>> {
  if (!prisma) return [];

  const where: Record<string, unknown> = {};
  if (filters?.crewMemberId) where.crewMemberId = filters.crewMemberId;
  if (filters?.date) {
    where.date = filters.date;
  } else {
    const dateFilter: Record<string, string> = {};
    if (filters?.dateFrom) dateFilter.gte = filters.dateFrom;
    if (filters?.dateTo) dateFilter.lte = filters.dateTo;
    if (Object.keys(dateFilter).length > 0) where.date = dateFilter;
  }

  return prisma.availabilityOverride.findMany({
    where,
    include: {
      crewMember: {
        select: { name: true, isActive: true },
      },
    },
    orderBy: [{ date: "asc" }, { crewMemberId: "asc" }],
  });
}

/**
 * Create or update an availability override.
 */
export async function upsertAvailabilityOverride(data: {
  id?: string;
  crewMemberId: string;
  date: string;
  availabilityId?: string | null;
  type: string;
  reason?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  createdBy?: string;
  updatedBy?: string;
}) {
  if (!prisma) return null;

  if (data.id) {
    return prisma.availabilityOverride.update({
      where: { id: data.id },
      data: {
        crewMemberId: data.crewMemberId,
        date: data.date,
        availabilityId: data.availabilityId,
        type: data.type,
        reason: data.reason,
        startTime: data.startTime,
        endTime: data.endTime,
        updatedBy: data.updatedBy,
      },
    });
  }

  // Check for existing override to prevent duplicates (NULL != NULL in SQL unique constraints)
  const existing = await prisma.availabilityOverride.findFirst({
    where: {
      crewMemberId: data.crewMemberId,
      date: data.date,
      availabilityId: data.availabilityId ?? null,
    },
  });

  if (existing) {
    return prisma.availabilityOverride.update({
      where: { id: existing.id },
      data: {
        type: data.type,
        reason: data.reason,
        startTime: data.startTime,
        endTime: data.endTime,
        updatedBy: data.updatedBy,
      },
    });
  }

  return prisma.availabilityOverride.create({
    data: {
      crewMemberId: data.crewMemberId,
      date: data.date,
      availabilityId: data.availabilityId,
      type: data.type,
      reason: data.reason,
      startTime: data.startTime,
      endTime: data.endTime,
      createdBy: data.createdBy,
      updatedBy: data.updatedBy,
    },
  });
}

/**
 * Delete an availability override.
 */
export async function deleteAvailabilityOverride(id: string) {
  if (!prisma) return null;

  return prisma.availabilityOverride.delete({
    where: { id },
  });
}
