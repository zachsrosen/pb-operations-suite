import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import type { JWT } from "next-auth/jwt";
import { assertProductionEnvConfigured } from "@/lib/env";
import { normalizeRole } from "@/lib/user-access";
import type { UserRole } from "@/generated/prisma/enums";

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
      roles?: string[];
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: string;
    roles?: string[];
    roleSyncedAt?: number;
    accessToken?: string;
    refreshToken?: string;
    accessTokenExpires?: number;
  }
}

const ROLE_SYNC_INTERVAL_MS = 5 * 60 * 1000;

function ensureDevAuthUrl(): void {
  if (process.env.NODE_ENV === "production") return;

  const currentAuthUrl = process.env.AUTH_URL?.trim();
  const currentNextAuthUrl = process.env.NEXTAUTH_URL?.trim();
  if (currentAuthUrl || currentNextAuthUrl) return;

  const localAuthUrl = "http://localhost:3000";
  process.env.AUTH_URL = localAuthUrl;
  process.env.NEXTAUTH_URL = localAuthUrl;
  console.log(`[auth] Using default local auth URL: ${localAuthUrl}`);
}

assertProductionEnvConfigured();
ensureDevAuthUrl();

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

    // Prefer the multi-role array if it's populated; fall back to the single
    // `role` column for Phase 1 back-compat (synthesize a 1-element array).
    const dbRoles = dbUser?.roles && dbUser.roles.length > 0 ? dbUser.roles : null;
    const rolesRaw: UserRole[] = dbRoles
      ? (dbRoles as UserRole[])
      : dbUser?.role
        ? [dbUser.role as UserRole]
        : token.role
          ? [token.role as UserRole]
          : ["VIEWER" as UserRole];
    const normalizedRoles = rolesRaw.map((r) => normalizeRole(r));
    token.roles = normalizedRoles;
    token.role = normalizedRoles[0] ?? "VIEWER";
    token.roleSyncedAt = Date.now();
    return token;
  } catch (error) {
    console.error("[auth] Failed to sync role to token:", error);
    const fallback = normalizeRole((token.role || "VIEWER") as UserRole);
    token.role = fallback;
    token.roles = token.roles && token.roles.length > 0 ? token.roles : [fallback];
    return token;
  }
}

// Dev-only credentials provider for local testing without Google OAuth
const devProvider = process.env.NODE_ENV !== "production"
  ? [
      Credentials({
        id: "dev-login",
        name: "Dev Login",
        credentials: {
          email: { label: "Email", type: "email", placeholder: "you@photonbrothers.com" },
        },
        async authorize(credentials) {
          const email = credentials?.email as string | undefined;
          if (!email?.endsWith("@photonbrothers.com") && !email?.endsWith("@pb-contractor.com")) {
            return null;
          }
          return { id: email, email, name: email.split("@")[0] };
        },
      }),
    ]
  : [];

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
          // Request Drive read-only scope so user's token can access design folder PDFs
          scope: "openid email profile https://www.googleapis.com/auth/drive.readonly",
        },
      },
    }),
    ...devProvider,
  ],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async signIn({ user }) {
      // Reject sign-in if email is missing
      if (!user.email) return false;

      // Verify email is from allowed domain(s)
      const domains = ALLOWED_DOMAINS.split(",").map((d) => d.trim().toLowerCase());
      const emailDomain = user.email.split("@")[1]?.toLowerCase();
      return !!emailDomain && domains.includes(emailDomain);
    },
    async redirect({ url, baseUrl }) {
      // Solar Surveyor is now same-origin — no cross-origin redirect needed
      try {
        const target = new URL(url);
        // Same origin — always allow
        if (target.origin === baseUrl) return url;
      } catch {
        // Invalid URL — fall through to default
      }

      // Default: redirect to base URL
      return baseUrl;
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
      if (token.roles && Array.isArray(token.roles)) {
        session.user.roles = token.roles;
      } else if (token.role) {
        // Phase 1 back-compat: synthesize roles[] if JWT predates multi-role.
        session.user.roles = [token.role as string];
      }
      // Note: accessToken intentionally NOT forwarded to session.user — it stays
      // server-side in the JWT only. API routes read it via getToken({ req }).
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
      if (!token.roles || token.roles.length === 0) {
        token.roles = [token.role];
      }
      return token;
    },
  },
  session: {
    strategy: "jwt",
    maxAge: 7 * 24 * 60 * 60, // 7 days
  },
  // Same-origin cookie config.
  // Solar Surveyor now runs from PB Ops `public/solar-surveyor`, so host-only
  // cookies are preferred (no Domain override). This avoids login loops on
  // localhost / preview hosts where a fixed parent domain would reject cookies.
  cookies: {
    sessionToken: {
      // Rotated name to avoid collisions with legacy domain-scoped cookies
      // that can coexist and cause ambiguous Cookie headers.
      name: "pbops.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax" as const,
        secure: process.env.NODE_ENV === "production",
        path: "/",
      },
    },
    callbackUrl: {
      name: "pbops.callback-url",
      options: {
        sameSite: "lax" as const,
        secure: process.env.NODE_ENV === "production",
        path: "/",
      },
    },
    csrfToken: {
      name: "pbops.authjs.csrf-token",
      options: {
        httpOnly: true,
        sameSite: "lax" as const,
        secure: process.env.NODE_ENV === "production",
        path: "/",
      },
    },
  },
  trustHost: true,
});
