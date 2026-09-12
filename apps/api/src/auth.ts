import { createAuthMiddleware } from "better-auth/api";
import { createRecoveryCodeStorage } from "./recovery-code-storage.ts";
import { createHash } from "node:crypto";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { twoFactor } from "better-auth/plugins";
import type { Db } from "@forge-ops/db";
import { authSchema } from "@forge-ops/db/schema";
import type { ApiEnv } from "./env.ts";

export function createAuth(db: Db, env: ApiEnv) {
  const recoveryCodes = createRecoveryCodeStorage(env.authSecret);
  const trustedOrigins =
    env.appEnv === "production"
      ? [env.webOrigin]
      : [
          env.webOrigin,
          `http://127.0.0.1:${env.apiPort}`,
          `http://localhost:${env.apiPort}`,
        ];
  return betterAuth({
    appName: "Forge Kitchen Ops",
    baseURL: env.webOrigin,
    basePath: "/api/auth",
    secret: env.authSecret,
    trustedOrigins,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: authSchema,
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: env.appEnv === "production",
    },
    verification: {
      storeIdentifier: {
        default: "plain",
        overrides: {
          "trust-device-": {
            hash: async (identifier) =>
              "trust-device-sha256:" +
              createHash("sha256").update(identifier).digest("hex"),
          },
        },
      },
      additionalFields: {
        userAgent: { type: "string", required: false, input: false },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (context) => {
        const body: unknown = context.body;
        if (
          context.path !== "/two-factor/verify-backup-code" ||
          !body ||
          typeof body !== "object" ||
          Array.isArray(body) ||
          !("code" in body) ||
          typeof body.code !== "string"
        )
          return;
        return {
          context: {
            body: { ...body, code: recoveryCodes.hashInput(body.code) },
          },
        };
      }),
    },
    databaseHooks: {
      verification: {
        create: {
          before: async (record, context) => {
            if (!record.identifier.startsWith("trust-device-sha256:")) return;
            return {
              data: {
                ...record,
                userAgent:
                  context?.request?.headers.get("user-agent")?.slice(0, 1024) ??
                  null,
              },
            };
          },
        },
      },
    },
    session: {
      expiresIn: 60 * 60 * 12,
      freshAge: 0,
      disableSessionRefresh: true,
    },
    advanced: {
      useSecureCookies: env.appEnv === "production",
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: env.appEnv === "production",
      },
    },
    plugins: [
      twoFactor({
        issuer: "Forge Kitchen Ops",
        backupCodeOptions: { storeBackupCodes: recoveryCodes },
        accountLockout: { enabled: false },
      }),
    ],
  });
}
