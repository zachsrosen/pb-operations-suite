import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import type { JWT } from "next-auth/jwt";
import { assertProductionEnvConfigured } from "@/lib/env";
import { normalizeRole, type UserRole } from "@/lib/role-permissions";

// Allowed email domains for authentication (comma-separated)
const ALLOWED_DOMAINS = (process.env.ALLOWED_EMAIL_DOMAIN || "photonbrothers.com,pb-contractor.com");

// Note: Database operations are done via API routes, not in auth callbacks
// This is because auth callbacks run in Edge Runtime which doesn't support Prisma

// Extend the session type to include role
declare module "next-auth" {
  interface Session {
    user: {
      id?: string;
      email?: string | null;
      name?: string | null;
      image?: string | null;
      role?: string;
      accessToken?: string;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: string;
    roleSyncedAt?: number;
    accessToken?: string;
    refreshToken?: string;
    accessTokenExpires?: number;
  }
}

const ROLE_SYNC_INTERVAL_MS = 5 * 60 * 1000;

assertProductionEnvConfigured();

async function syncRoleToToken(token: JWT): Promise<JWT> {
  // Prisma is not edge-compatible; skip DB sync if this callback executes in edge runtime.
  if (process.env.NEXT_RUNTIME === "edge") {
    return token;
  }

  if (!token.email) {
    return token;
  }

  try {
    const { getOrCreateUser } = await import("@/lib/db");
    const dbUser = await getOrCreateUser({
      email: token.email,
      name: typeof token.name === "string" ? token.name : undefined,
      image: typeof token.picture === "string" ? token.picture : undefined,
    }, { touchLastLogin: false });

    token.role = normalizeRole((dbUser?.role || token.role || "VIEWER") as UserRole);
    token.roleSyncedAt = Date.now();
    return token;
  } catch (error) {
    console.error("[auth] Failed to sync role to token:", error);
    token.role = normalizeRole((token.role || "VIEWER") as UserRole);
    return token;
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          prompt: "consent",
          access_type: "offline",
          response_type: "code",
          // Allow multiple Google Workspace domains — actual enforcement is in signIn callback
          hd: "*",
        },
      },
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async signIn({ user }) {
      // Verify email is from allowed domain(s)
      if (user.email) {
        const domains = ALLOWED_DOMAINS.split(",").map((d) => d.trim().toLowerCase());
        const emailDomain = user.email.split("@")[1]?.toLowerCase();
        if (!domains.includes(emailDomain)) {
          return false; // Reject sign-in
        }
      }
      return true;
    },
    async session({ session, token }) {
      // Add user info to session
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      // Role will be fetched via API call on client side
      if (token.role) {
        session.user.role = token.role as string;
      }
      if (token.accessToken) {
        session.user.accessToken = token.accessToken as string;
      }
      return session;
    },
    async jwt({ token, user, account }) {
      if (user) {
        token.id = user.id;
      }

      // Capture OAuth tokens on initial sign-in (account is only present on sign-in)
      if (account?.access_token) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token ?? token.refreshToken;
        token.accessTokenExpires = account.expires_at
          ? account.expires_at * 1000  // convert seconds → ms
          : Date.now() + 3600 * 1000;
      }

      const needsRoleSync =
        !!user ||
        !token.role ||
        !token.roleSyncedAt ||
        Date.now() - token.roleSyncedAt > ROLE_SYNC_INTERVAL_MS;

      if (needsRoleSync) {
        return syncRoleToToken(token);
      }

      token.role = normalizeRole((token.role || "VIEWER") as UserRole);
      return token;
    },
  },
  session: {
    strategy: "jwt",
    maxAge: 7 * 24 * 60 * 60, // 7 days
  },
  trustHost: true,
});
