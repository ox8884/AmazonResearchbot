const BLOCKED_HOSTS: Record<string, true> = {
  localhost: true,
  "metadata.google.internal": true,
};

function hostBlocked(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.+$/, "");
  if (BLOCKED_HOSTS[host]) return true;
  if (host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") return true;
  if (host.endsWith(".local")) return true;
  return false;
}

function ipv4Private(ip: string): boolean {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

export type EgressDecision = { ok: true; url: URL } | { ok: false; code: string };

export function authorizeUrl(raw: string, allowedHosts: Readonly<Record<string, true>>): EgressDecision {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, code: "URL_INVALID" };
  }
  if (url.protocol !== "https:") return { ok: false, code: "HTTPS_ONLY" };
  if (url.username || url.password) return { ok: false, code: "USERINFO_FORBIDDEN" };
  if (url.port && url.port !== "443") return { ok: false, code: "PORT_FORBIDDEN" };
  const host = url.hostname.toLowerCase();
  if (hostBlocked(host) || ipv4Private(host)) return { ok: false, code: "PRIVATE_ADDRESS" };
  if (Object.keys(allowedHosts).length === 0 || !allowedHosts[host]) return { ok: false, code: "HOST_NOT_ALLOWED" };
  return { ok: true, url };
}

/** M1: no Jungle Scout wire. Empty allowlist denies every URL. */
export const M1_ALLOWED_HOSTS: Readonly<Record<string, true>> = {};
