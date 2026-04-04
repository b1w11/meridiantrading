import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe auth config (no Node-only deps). Used by middleware.
 * Credentials provider and bcrypt live in `auth.ts` with the route handlers.
 */
export const authConfig: NextAuthConfig = {
  trustHost: true,
  pages: {
    signIn: "/login",
  },
  providers: [],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id ?? "";
        token.role = user.role;
        token.email = user.email;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
        if (token.email) {
          session.user.email = token.email as string;
        }
      }
      return session;
    },
  },
  session: {
    strategy: "jwt",
  },
};
