import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { getOrCreateUser, getUserByEmail } from "@/lib/db";

// Allowed email domain for authentication
const ALLOWED_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN || "photonbrothers.com";

// Extend the session type to include role
declare module "next-auth" {
  interface Session {
    user: {
      id?: string;
      email?: string | null;
      name?: string | null;
      image?: string | null;
      role?: string;
    };
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
          // Restrict to Google Workspace domain
          hd: ALLOWED_DOMAIN.split(",")[0].trim(),
        },
      },
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async signIn({ user, account, profile }) {
      // Verify email is from allowed domain
      if (user.email) {
        const domains = ALLOWED_DOMAIN.split(",").map((d) => d.trim().toLowerCase());
        const emailDomain = user.email.split("@")[1]?.toLowerCase();
        if (!domains.includes(emailDomain)) {
          return false; // Reject sign-in
        }

        // Create or update user in database (if DB is configured)
        try {
          await getOrCreateUser({
            email: user.email,
            name: user.name ?? undefined,
            image: user.image ?? undefined,
            googleId: account?.providerAccountId,
          });
        } catch (error) {
          // Don't block sign-in if DB is not configured
          console.warn("Could not sync user to database:", error);
        }
      }
      return true;
    },
    async session({ session, token }) {
      // Add user info to session
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      // Add role from token
      if (token.role) {
        session.user.role = token.role as string;
      }
      return session;
    },
    async jwt({ token, user, account, trigger }) {
      if (user) {
        token.id = user.id;
      }

      // Fetch role from database on sign-in or when session is updated
      if ((user || trigger === "update") && token.email) {
        try {
          const dbUser = await getUserByEmail(token.email as string);
          if (dbUser) {
            token.role = dbUser.role;
          } else {
            token.role = "VIEWER"; // Default role
          }
        } catch {
          token.role = "VIEWER";
        }
      }

      return token;
    },
  },
  session: {
    strategy: "jwt",
    maxAge: 7 * 24 * 60 * 60, // 7 days
  },
  trustHost: true,
});
