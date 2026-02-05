import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// Allowed email domain for authentication
const ALLOWED_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN || "photonbrothers.com";

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
      return session;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      // Default role - actual role fetched from DB via API
      if (!token.role) {
        token.role = "VIEWER";
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
