import { lstat, readFile } from "node:fs/promises";
import { userInfo } from "node:os";
export type RuntimeService = "api" | "worker" | "scheduler";
export type RuntimeAuthority = {
  appEnv: "development" | "production";
  service: RuntimeService;
  databaseUrl: string;
  workerIdentity: string | null;
};
type FileFacts = { uid: number; mode: number; regular: boolean; size: number };
type HostFacts = {
  platform: string;
  uid: number;
  username: string;
  invocationId: string | undefined;
  cgroup: string;
  machineId: string;
  authorityDirectory: { uid: number; mode: number; directory: boolean };
  authorityFile: FileFacts;
  manifest: unknown;
};
const authorityDirectory = "/etc/forge-ops";
const authorityFile = authorityDirectory + "/worker-authority.json";
function denied(): never {
  throw new Error("RUNTIME_AUTHORITY_REQUIRED");
}
export function validateHostAuthority(
  service: RuntimeService,
  facts: HostFacts,
): string {
  const document = facts.manifest;
  if (
    !["api", "worker", "scheduler"].includes(service) ||
    facts.platform !== "linux" ||
    facts.uid <= 0 ||
    facts.username !== `forge-ops-${service}` ||
    !facts.invocationId ||
    !/^[a-f0-9]{32}$/.test(facts.invocationId)
  )
    denied();
  if (
    !facts.cgroup
      .split("\n")
      .some((line) => line.slice(line.lastIndexOf(":") + 1) === `/system.slice/forge-ops-${service}.service`)
  )
    denied();
  if (
    !facts.authorityDirectory.directory ||
    facts.authorityDirectory.uid !== 0 ||
    (facts.authorityDirectory.mode & 0o022) !== 0
  )
    denied();
  if (
    !facts.authorityFile.regular ||
    facts.authorityFile.uid !== 0 ||
    (facts.authorityFile.mode & 0o022) !== 0 ||
    facts.authorityFile.size < 1 ||
    facts.authorityFile.size > 4096
  )
    denied();
  if (
    typeof document !== "object" ||
    document === null ||
    Array.isArray(document) ||
    Object.keys(document).length !== 3 ||
    !("version" in document) ||
    document.version !== 1 ||
    !("machineId" in document) ||
    typeof document.machineId !== "string" ||
    !("workerIdentity" in document) ||
    typeof document.workerIdentity !== "string"
  )
    denied();
  if (
    !/^[a-f0-9]{32}$/.test(document.machineId) ||
    document.machineId !== facts.machineId.trim() ||
    !/^oracle:ocid1\.instance\.[A-Za-z0-9._-]+$/.test(
      document.workerIdentity,
    ) ||
    document.workerIdentity.length > 512
  )
    denied();
  return document.workerIdentity;
}
export function validateDatabaseLocation(
  appEnv: "development" | "production",
  service: RuntimeService,
  value: string,
): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    denied();
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hash)
    denied();
  if (appEnv === "development") {
    if (
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.search
    )
      denied();
  } else {
    const keys = [...url.searchParams.keys()];
    if (
      url.hostname ||
      url.username ||
      url.password ||
      url.port ||
      url.pathname !== "/forge_ops" ||
      keys.length !== 2 ||
      new Set(keys).size !== 2 ||
      !keys.includes("host") ||
      !keys.includes("user") ||
      url.searchParams.get("host") !== "/var/run/postgresql" ||
      url.searchParams.get("user") !== `forge_ops_${service}`
    )
      denied();
  }
  return value;
}
export async function readRuntimeAuthority(
  service: RuntimeService,
  source: NodeJS.ProcessEnv,
): Promise<RuntimeAuthority> {
  const appEnv = source.APP_ENV ?? "development";
  if (process.argv.includes("--production") && appEnv !== "production")
    denied();
  if (appEnv !== "development" && appEnv !== "production") denied();
  if (!source.DATABASE_URL) denied();
  if (appEnv === "production" && process.platform !== "linux") denied();
  const databaseUrl = validateDatabaseLocation(
    appEnv,
    service,
    source.DATABASE_URL,
  );
  if (appEnv === "development")
    return { appEnv, service, databaseUrl, workerIdentity: null };
  if (Object.keys(source).some((key) => key.startsWith("PG") && source[key]))
    denied();
  try {
    const directory = await lstat(authorityDirectory),
      file = await lstat(authorityFile);
    if (
      !directory.isDirectory() ||
      directory.uid !== 0 ||
      (directory.mode & 0o022) !== 0 ||
      !file.isFile() ||
      file.uid !== 0 ||
      (file.mode & 0o022) !== 0 ||
      file.size > 4096
    )
      denied();
    const [cgroup, machineId, raw] = await Promise.all([
      readFile("/proc/self/cgroup", "utf8"),
      readFile("/etc/machine-id", "utf8"),
      readFile(authorityFile, "utf8"),
    ]);
    const user = userInfo();
    const workerIdentity = validateHostAuthority(service, {
      platform: process.platform,
      uid: user.uid,
      username: user.username,
      invocationId: source.INVOCATION_ID,
      cgroup,
      machineId,
      authorityDirectory: {
        uid: directory.uid,
        mode: directory.mode,
        directory: directory.isDirectory(),
      },
      authorityFile: {
        uid: file.uid,
        mode: file.mode,
        regular: file.isFile(),
        size: file.size,
      },
      manifest: JSON.parse(raw),
    });
    return { appEnv, service, databaseUrl, workerIdentity };
  } catch {
    denied();
  }
}
type AuthorityDatabase = {
  query: (sql: string) => Promise<{ rows: readonly unknown[] }>;
};
export async function assertDatabaseAuthority(
  db: AuthorityDatabase,
  authority: RuntimeAuthority,
): Promise<void> {
  const claimAggregate =
    authority.service === "worker" ? "bool_and" : "bool_or";
  const readAggregate = authority.service === "api" ? "bool_or" : "bool_and";
  const result = await db.query(`WITH job_tables AS (
   SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='pgboss' AND (c.relname='job' OR c.relname IN (SELECT table_name FROM pgboss.queue))
 ) SELECT d.environment,d.worker_identity,current_user::text AS db_role,session_user::text AS session_role,system_user AS auth_identity,inet_server_addr() IS NULL AS local_socket,
   (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls) AS privileged,
   EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid) AS member_of_role,
   (has_schema_privilege(current_user,'public','CREATE') OR has_schema_privilege(current_user,'pgboss','CREATE') OR has_database_privilege(current_user,current_database(),'CREATE') OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relowner=r.oid AND n.nspname IN ('public','pgboss'))) AS ddl_allowed,
   COALESCE((SELECT ${claimAggregate}(has_any_column_privilege(current_user,j.oid,'UPDATE')) FROM job_tables j),false) AS can_claim,
   COALESCE((SELECT ${readAggregate}(has_column_privilege(current_user,j.oid,'data','SELECT')) FROM job_tables j),false) AS can_read_jobs
   FROM deployment_identity d CROSS JOIN pg_roles r WHERE r.rolname=current_user`);
  const row = result.rows[0];
  if (
    result.rows.length !== 1 ||
    typeof row !== "object" ||
    row === null ||
    !("environment" in row) ||
    row.environment !== authority.appEnv
  )
    denied();
  if (authority.appEnv === "production") {
    if (
      !("member_of_role" in row) ||
      row.member_of_role !== false ||
      !("ddl_allowed" in row) ||
      row.ddl_allowed !== false ||
      !("can_claim" in row) ||
      row.can_claim !== (authority.service === "worker") ||
      !("can_read_jobs" in row) ||
      row.can_read_jobs !== (authority.service !== "api")
    )
      denied();
    if (
      !("worker_identity" in row) ||
      row.worker_identity !== authority.workerIdentity ||
      !("db_role" in row) ||
      row.db_role !== `forge_ops_${authority.service}` ||
      !("session_role" in row) ||
      row.session_role !== row.db_role ||
      !("auth_identity" in row) ||
      row.auth_identity !== `peer:forge-ops-${authority.service}` ||
      !("local_socket" in row) ||
      row.local_socket !== true ||
      !("privileged" in row) ||
      row.privileged !== false
    )
      denied();
  }
}
