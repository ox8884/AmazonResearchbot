import {
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
});

export const twoFactor = pgTable("two_factor", {
  id: text("id").primaryKey(),
  secret: text("secret").notNull(),
  backupCodes: text("backup_codes"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  verified: boolean("verified").notNull().default(false),
  failedVerificationCount: integer("failed_verification_count").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
});

export const loginAttempts = pgTable("login_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  emailNormalized: text("email_normalized").notNull(),
  ip: text("ip").notNull(),
  success: boolean("success").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const settingsVersions = pgTable("settings_versions", {
  version: integer("version").primaryKey(),
  effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
  approvedBy: text("approved_by").notNull(),
  snapshot: jsonb("snapshot").notNull(),
});

export const settingsProposals = pgTable("settings_proposals", {
  id: uuid("id").primaryKey().defaultRandom(),
  proposedBy: text("proposed_by").notNull(),
  beforeSnapshot: jsonb("before_snapshot").notNull(),
  afterSnapshot: jsonb("after_snapshot").notNull(),
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const imports = pgTable(
  "imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    filename: text("filename").notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: text("sha256").notNull(),
    sourceType: text("source_type").notNull(),
    schemaVersion: text("schema_version").notNull(),
    marketplace: text("marketplace").notNull(),
    blobCiphertext: text("blob_ciphertext").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.sha256, t.marketplace)],
);

export const importRows = pgTable(
  "import_rows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    importId: uuid("import_id")
      .notNull()
      .references(() => imports.id),
    rowNumber: integer("row_number").notNull(),
    rawJson: jsonb("raw_json").notNull(),
    keywordRaw: text("keyword_raw").notNull(),
    normalizedKeyword: text("normalized_keyword").notNull(),
    error: text("error"),
  },
  (t) => [unique().on(t.importId, t.rowNumber)],
);

export const candidates = pgTable(
  "candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    marketplace: text("marketplace").notNull(),
    normalizedKeyword: text("normalized_keyword").notNull(),
    keywordDisplay: text("keyword_display").notNull(),
    stage: text("stage").notNull(),
    blockedReason: text("blocked_reason"),
    inputVersion: integer("input_version").notNull().default(1),
    lastProgressAt: timestamp("last_progress_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.marketplace, t.normalizedKeyword)],
);

export const candidateImportRows = pgTable(
  "candidate_import_rows",
  {
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id),
    importRowId: uuid("import_row_id")
      .notNull()
      .references(() => importRows.id),
  },
  (t) => [primaryKey({ columns: [t.candidateId, t.importRowId] })],
);

export const candidateEvents = pgTable(
  "candidate_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id),
    stage: text("stage").notNull(),
    inputVersion: integer("input_version").notNull(),
    detail: jsonb("detail").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.candidateId, t.stage, t.inputVersion)],
);

export const evidence = pgTable("evidence", {
  id: uuid("id").primaryKey().defaultRandom(),
  candidateId: uuid("candidate_id")
    .notNull()
    .references(() => candidates.id),
  field: text("field").notNull(),
  kind: text("kind").notNull(),
  valueNumeric: numeric("value_numeric"),
  valueText: text("value_text"),
  sourceId: text("source_id"),
  observedAt: timestamp("observed_at", { withTimezone: true }),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const evaluations = pgTable("evaluations", {
  id: uuid("id").primaryKey().defaultRandom(),
  candidateId: uuid("candidate_id")
    .notNull()
    .references(() => candidates.id),
  settingsVersion: integer("settings_version").notNull(),
  kind: text("kind").notNull(),
  outcome: text("outcome").notNull(),
  payload: jsonb("payload").notNull(),
  stale: boolean("stale").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const approvals = pgTable("approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(),
  candidateId: uuid("candidate_id"),
  payloadHash: text("payload_hash").notNull(),
  payload: jsonb("payload").notNull(),
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decidedBy: text("decided_by"),
});

export const budgetDays = pgTable("budget_days", {
  dayUtc: date("day_utc").primaryKey(),
  reserved: integer("reserved").notNull().default(0),
  consumed: integer("consumed").notNull().default(0),
  wireLimit: integer("wire_limit").notNull(),
});

export const apiAttempts = pgTable("api_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  operationId: uuid("operation_id").notNull(),
  budgetDay: date("budget_day").notNull(),
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  target: text("target"),
  approvalHash: text("approval_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  meta: jsonb("meta").notNull().default({}),
});

export const authSchema = {
  user,
  session,
  account,
  verification,
  twoFactor,
};
