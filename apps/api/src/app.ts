import { registerBrowserCapabilityRoutes } from "./browser-capability-routes.ts";
import { registerRepresentativeRoutes } from "./representative-routes.ts";
import {registerMarketSourceRoutes} from './market-source-routes.ts';
import {registerProductSourceRoutes} from './product-source-routes.ts';
import { registerImportPreviewRoutes } from './import-preview-routes.ts';
import { ImportInputError, readImportUpload } from './import-input.ts';
import { registerBrowserTaskRoutes } from "./browser-task-routes.ts";
import { registerBridgeDeviceRoutes } from "./bridge-device-routes.ts";
import { registerSupplierCaptureRoutes } from "./supplier-capture-routes.ts";
import { lockSearchRun,attachSearchRunImport,SearchRunError } from "@forge-ops/db";
import { readCandidateAiTasks } from "@forge-ops/db";
import { createAiTransport, type AiTransport } from "@forge-ops/integrations/ai/transport";
import { registerAiTestRoutes } from "./ai-test-routes.ts";
import { registerSummaryRoutes } from "./summary-routes.ts";
import { createRecoveryCodeStorage } from "./recovery-code-storage.ts";
import { registerSecurityRoutes } from "./security-routes.ts";
import { registerComposioRoutes } from "./composio-routes.ts";
import { registerSavedSearchRoutes } from "./saved-search-routes.ts";
import { registerCustomAiRoutes } from "./custom-ai-routes.ts";
import { registerInboxRoutes } from "./inbox-routes.ts";
import { loadCandidates, readCandidateDetails } from "@forge-ops/db";
import { z } from "zod";
import { registerMailProfileRoutes } from "./mail-profile-routes.ts";
import { registerSubscriptionRoutes } from "./subscription-routes.ts";
import { registerOrderRoutes } from "./order-routes.ts";
import { registerSettingsRoutes } from "./settings-routes.ts";
import { registerApprovalRoutes } from "./approval-routes.ts";
import { registerRfqRoutes } from "./rfq-routes.ts";
import { registerRfqApprovalRoutes } from "./rfq-approval-routes.ts";
import { registerQuoteRoutes } from "./quote-routes.ts";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { fromNodeHeaders } from "better-auth/node";
import Fastify from "fastify";
import { createDb, type Pool } from "@forge-ops/db";
import { parseKey, PINO_REDACT_PATHS } from "@forge-ops/security";
import { createAuth } from "./auth.ts";
import type { ApiEnv } from "./env.ts";
import { createAuthThrottle } from "./auth-throttle.ts";
import { createProducer } from "./queue.ts";
import {importCsvWithinTransaction,ImportMappingConflict} from "./import-store.ts";


export async function buildApp(env: ApiEnv, pool: Pool, options: { aiTransport?: AiTransport } = {}) {
  if (options.aiTransport && env.appEnv !== "development") throw new Error("TEST_TRANSPORT_NOT_ALLOWED");
  const db = createDb(pool);
  const auth = createAuth(db, env);
  const throttle = createAuthThrottle({
    pool, authSecret: env.authSecret,
    resolveTrustedSessionAccount: async ({ sessionHeaders }) => {
      if (!sessionHeaders) return null;
      const session = await auth.api.getSession({ headers: sessionHeaders });
      return session?.user.email ?? null;
    },
  });
  const boss = await createProducer(env.databaseUrl, env.appEnv);
  const encKey = parseKey(env.encryptionKeyHex);

  const app = Fastify({
    logger: {
      level: "info",
      redact: {
        paths: PINO_REDACT_PATHS,
        censor: "[redacted]",
      },
    },
  });

  app.setErrorHandler((error, request, reply) => {
    const status = error instanceof Error && "statusCode" in error &&
      typeof error.statusCode === "number" && error.statusCode >= 400 && error.statusCode < 500
      ? error.statusCode : 500;
    const code = status === 500 ? "INTERNAL_ERROR" : "INVALID_REQUEST";
    if (status === 500) app.log.error({ requestId: request.id, code }, "Request failed");
    return reply.status(status).send({ code, message: "Request could not be processed", requestId: request.id });
  });

  await app.register(cookie);
  await app.register(cors, {
    origin: env.webOrigin,
    credentials: true,
    maxAge: 86400,
  });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

  app.addHook("onSend", async (_req, reply) => {
    reply.header("cache-control", "no-store");
  });

  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    async handler(request, reply) {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const headers = fromNodeHeaders(request.headers);
      const req = new Request(url.toString(), {
        method: request.method,
        headers,
        ...(request.body ? { body: JSON.stringify(request.body) } : {}),
      });
      const outcome = await throttle.run({
        method: request.method, pathname: url.pathname, ip: request.ip,
        cookieHeader: request.headers.cookie, sessionHeaders: headers, body: request.body,
      }, () => auth.handler(req));
      if (outcome.kind !== "handled") return reply.status(outcome.status).send(outcome.body);
      const response = outcome.response;
      reply.status(response.status);
      response.headers.forEach((value, key) => {
        reply.header(key, value);
      });
      return reply.send(response.body ? await response.text() : null);
    },
  });


  app.get("/api/health", async () => ({ ok: true, env: env.appEnv }));
  app.get("/health", async () => ({ ok: true, env: env.appEnv }));

  app.get("/api/session", async (request, reply) => {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session) return reply.status(401).send({ code: "UNAUTHENTICATED", message: "Sign in required" });
    return {
      user: {
        id: session.user.id,
        email: session.user.email,
        twoFactorEnabled: session.user.twoFactorEnabled === true,
      },
    };
  });

  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/api/")) return;
    if (request.url.startsWith("/api/auth") || request.url === "/api/health" || request.url === "/api/session") {
      return;
    }
    if ((request.method === "POST" && request.routeOptions.url === "/api/bridge/pair") ||
        (request.method === "GET" && request.routeOptions.url === "/api/bridge/device") ||
        (request.method === "POST" && ["/api/bridge/tasks/claim","/api/bridge/tasks/:id/results","/api/bridge/capabilities"].includes(request.routeOptions.url ?? "")) ||
        (request.method === "GET" && request.routeOptions.url === "/api/bridge/tasks/:id")) return;
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session) {
      return reply.status(401).send({ code: "UNAUTHENTICATED", message: "Sign in required" });
    }
    if (session.user.twoFactorEnabled !== true) {
      return reply.status(403).send({ code: "TWO_FACTOR_REQUIRED", message: "Turn on two-factor before using the workspace" });
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && request.headers.origin !== env.webOrigin) {
      return reply.status(403).send({ code: "ORIGIN_REJECTED", message: "Origin not allowed" });
    }
    (request as { userId?: string }).userId = session.user.id;
  });

  registerSecurityRoutes(app,pool,auth,createRecoveryCodeStorage(env.authSecret));
  registerRepresentativeRoutes(app,pool,boss,encKey);
  registerMarketSourceRoutes(app,pool,encKey);
  registerProductSourceRoutes(app,pool,encKey);
  registerImportPreviewRoutes(app);
  registerBridgeDeviceRoutes(app,pool,{auth,webOrigin:env.webOrigin});
  registerBrowserCapabilityRoutes(app,pool,env.webOrigin);
  registerBrowserTaskRoutes(app,pool,{boss,encryptionKey:encKey,webOrigin:env.webOrigin});
  registerSummaryRoutes(app,pool);
  registerQuoteRoutes(app,pool,env.webOrigin);
  registerOrderRoutes(app,pool);
  registerSettingsRoutes(app,pool);
  registerMailProfileRoutes(app,pool,encKey);
  registerCustomAiRoutes(app, pool, encKey);
  app.get('/api/candidates/:id/ai-analysis',async(request,reply)=>{
    const parsed=z.object({id:z.uuid()}).safeParse(request.params);
    if(!parsed.success)return reply.status(400).send({code:'INVALID_CANDIDATE'});
    return {tasks:await readCandidateAiTasks(pool,parsed.data.id)};
  });
  registerAiTestRoutes(app, pool, {transport: options.aiTransport ?? createAiTransport(env.aiTransport === "official"), encryptionKey: encKey});
  registerComposioRoutes(app,pool,encKey,{ownerEmail:env.composioOwnerEmail??"jay@local.test",...(env.composioApiKey?{apiKey:env.composioApiKey}:{})});
  registerInboxRoutes(app,pool,{key:encKey,collectionEnabled:env.mailTransport === "profile"});
  registerSubscriptionRoutes(app);
  registerApprovalRoutes(app,pool);
  registerRfqRoutes(app,pool,env.mailTransport);
  registerSupplierCaptureRoutes(app,pool,encKey);
  registerRfqApprovalRoutes(app,pool);

  app.post("/api/imports", async (request, reply) => {
    const options=z.object({searchRunId:z.uuid().optional()}).strict().safeParse(request.query);
    if(!options.success)return reply.status(400).send({code:'INVALID_SEARCH_RUN'});
    const actor='userId' in request&&typeof request.userId==='string'?request.userId:null;
    if(options.data.searchRunId&&!actor)return reply.status(401).send({code:'UNAUTHENTICATED'});
    let upload;
    try{upload=await readImportUpload(request,true);}catch(error){if(error instanceof ImportInputError)return reply.status(error.status).send({code:error.code});throw error;}
    const {file,bytes,parsed,mapped}=upload;
    if (parsed.validCount === 0 || parsed.rows.some((r) => r.error)) {
      return reply.status(422).send({
        code: "ROW_ERRORS",
        message: "Fix the highlighted rows before creating candidates",
        rows: parsed.rows.map((r) => ({ rowNumber: r.rowNumber, keyword: r.keywordRaw, error: r.error })),
      });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const searchRun=options.data.searchRunId&&actor?await lockSearchRun(client,options.data.searchRunId,actor):null;
      const imported=await importCsvWithinTransaction(client,{filename:file.filename,bytes,parsed,source:{kind:'manual',mapped}},boss,encKey);
      const importId=imported.importId;
      if(searchRun)await attachSearchRunImport(client,searchRun,importId);
      await client.query("COMMIT");
      const list = await loadCandidates(client, "ko");
      return {searchRunId:searchRun?.id,...imported,candidates:list};
    } catch (err) {
      await client.query("ROLLBACK");
      if(err instanceof ImportMappingConflict)return reply.status(409).send({code:err.message});
      if(err instanceof SearchRunError)return reply.status(err.code==='SEARCH_RUN_NOT_FOUND'?404:409).send({code:err.code,message:'Search run could not be linked; existing data was preserved'});
      throw err;
    } finally {
      client.release();
    }
  });

  app.get("/api/candidates", async (request) => {
    const locale = (request.headers["accept-language"] ?? "ko").toString().startsWith("en") ? "en" : "ko";
    return { candidates: await loadCandidates(pool, locale) };
  });

  app.get("/api/candidates/:id", async (request, reply) => {
    const locale = (request.headers["accept-language"] ?? "ko").toString().startsWith("en") ? "en" : "ko";
    const parsed=z.object({id:z.uuid()}).safeParse(request.params);
    if(!parsed.success)return reply.status(400).send({code:"INVALID",message:"Invalid candidate"});
    const detail=await readCandidateDetails(pool,parsed.data.id,locale);
    if(!detail)return reply.status(404).send({code:"NOT_FOUND",message:"Candidate missing"});
    return detail;
  });

  registerSavedSearchRoutes(app, pool);

  app.addHook("onClose", async () => {
    await boss.stop({ graceful: false, timeout: 5000 });
  });

  return { app, auth, boss };
}
