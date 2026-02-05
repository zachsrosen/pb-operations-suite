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
export type { User, ActivityLog, BookedSlot, AppSetting } from "@/generated/prisma/client";

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
