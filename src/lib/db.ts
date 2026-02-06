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
export type { User, ActivityLog, BookedSlot, AppSetting, ZuperJobCache, HubSpotProjectCache, ScheduleRecord } from "@/generated/prisma/client";

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
  entityType?: string;
  entityId?: string;
  entityName?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}) {
  if (!prisma) return null;

  try {
    return await prisma.activityLog.create({
      data: {
        type: data.type,
        description: data.description,
        userId: data.userId,
        userEmail: data.userEmail,
        entityType: data.entityType,
        entityId: data.entityId,
        entityName: data.entityName,
        metadata: data.metadata ? JSON.parse(JSON.stringify(data.metadata)) : undefined,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
      },
    });
  } catch (error) {
    console.error("Failed to log activity:", error);
    return null;
  }
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
 * Define which routes each role can access
 */
export const ROLE_PERMISSIONS: Record<UserRole, {
  allowedRoutes: string[];
  canSchedule: boolean;
  canSyncZuper: boolean;
  canManageUsers: boolean;
}> = {
  ADMIN: {
    allowedRoutes: ["*"], // All routes
    canSchedule: true,
    canSyncZuper: true,
    canManageUsers: true,
  },
  MANAGER: {
    allowedRoutes: ["*"], // All routes
    canSchedule: true,
    canSyncZuper: true,
    canManageUsers: false,
  },
  VIEWER: {
    allowedRoutes: ["*"], // All routes, read-only
    canSchedule: false,
    canSyncZuper: false,
    canManageUsers: false,
  },
  SALES: {
    allowedRoutes: [
      "/dashboards/site-survey-scheduler",
      "/api/projects",
      "/api/zuper/availability",
      "/api/zuper/status",
      "/api/zuper/jobs/lookup",
      "/api/zuper/jobs/schedule",
    ],
    canSchedule: true,
    canSyncZuper: true,
    canManageUsers: false,
  },
};

/**
 * Check if a user role can access a specific route
 */
export function canAccessRoute(role: UserRole, route: string): boolean {
  const permissions = ROLE_PERMISSIONS[role];
  if (!permissions) return false;

  // Admin/Manager/Viewer can access all
  if (permissions.allowedRoutes.includes("*")) return true;

  // Check specific routes
  return permissions.allowedRoutes.some(allowed =>
    route.startsWith(allowed)
  );
}

/**
 * Check if user can perform scheduling actions
 */
export function canSchedule(role: UserRole): boolean {
  return ROLE_PERMISSIONS[role]?.canSchedule ?? false;
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
