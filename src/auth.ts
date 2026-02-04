import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// Allowed email domain for authentication
const ALLOWED_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN || "photonbrothers.com";

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
      return session;
    },
    async jwt({ token, user, account }) {
      if (user) {
        token.id = user.id;
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
