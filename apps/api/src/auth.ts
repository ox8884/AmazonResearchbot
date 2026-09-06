import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { twoFactor } from "better-auth/plugins";
import type { Db } from "@forge-ops/db";
import { authSchema } from "@forge-ops/db/schema";
import type { ApiEnv } from "./env.ts";

export function createAuth(db: Db, env: ApiEnv) {
  return betterAuth({
    appName: "Forge Kitchen Ops",
    baseURL: env.webOrigin,
    basePath: "/api/auth",
    secret: env.authSecret,
    trustedOrigins: [env.webOrigin, `http://127.0.0.1:${env.apiPort}`, `http://localhost:${env.apiPort}`],
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: authSchema,
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: env.appEnv === "production",
    },
    session: {
      expiresIn: 60 * 60 * 12,
      freshAge: 0,
    },
    advanced: {
      useSecureCookies: env.appEnv === "production",
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: env.appEnv === "production",
      },
    },
    plugins: [twoFactor({ issuer: "Forge Kitchen Ops" })],
  });
}

