import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { authConfig } from "./auth.config";

/** In-memory users; passwords stored as bcrypt hashes only. */
const users = [
  {
    id: "1",
    email: "admin@meridian.com",
    passwordHash:
      "$2b$10$LrGGVe2pxocoyR7su9kSBe9lMRu9K.phLX44ewvAjEOr/5qNdEeFm",
    role: "admin" as const,
  },
  {
    id: "2",
    email: "client@meridian.com",
    passwordHash:
      "$2b$10$ioBmSZ8rcu5/8FA9gp8Qy.RQc/1HEJxfWvpfz4jNtXIygXbtXBn.6",
    role: "viewer" as const,
  },
];

/**
 * Logs bcrypt hashes for the known Meridian passwords (dev/setup only).
 * Set `MERIDIAN_LOG_PASSWORD_HASHES=1` in `.env.local`, restart once, copy
 * hashes into `users` above, then remove the env var.
 */
export async function generateHashedPasswords(): Promise<void> {
  const [adminHash, clientHash] = await Promise.all([
    bcrypt.hash("Meridian2026!", 10),
    bcrypt.hash("Client2026!", 10),
  ]);
  console.log("[meridian-auth] admin@meridian.com:", adminHash);
  console.log("[meridian-auth] client@meridian.com:", clientHash);
}

if (process.env.MERIDIAN_LOG_PASSWORD_HASHES === "1") {
  void generateHashedPasswords();
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string") {
          return null;
        }
        const user = users.find(
          (u) => u.email.toLowerCase() === email.toLowerCase().trim(),
        );
        if (!user) return null;
        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;
        return { id: user.id, email: user.email, role: user.role };
      },
    }),
  ],
});
