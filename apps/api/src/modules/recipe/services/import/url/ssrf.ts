/**
 * SSRF guard for the URL importer.
 *
 * The user controls the URL we fetch, so the API must never be turned into a
 * proxy into the private network (cloud metadata endpoints, internal admin
 * panels, `file://`, …). Every candidate URL — the original one AND every
 * redirect Location — goes through `assertPublicUrl()`.
 *
 * Two layers:
 *   1. syntactic — scheme allow-list, hostname deny-list, literal IP checks,
 *   2. DNS — every A/AAAA record the hostname resolves to must be public.
 *
 * Remaining (documented, accepted) risk: Bun's `fetch` gives no socket-level
 * hook, so a DNS rebinding attack could in theory return a private address on
 * the *second* lookup performed by fetch itself. Mitigating that needs a
 * pinned-IP HTTP client; the deny-list above blocks every realistic attack.
 */
import { serverText } from "@toon/shared";
import { lookup } from "node:dns/promises";
import { env } from "../../../../../env.ts";
import { ApiError, type ErrorText } from "../../../../../lib/errors.ts";

export class SsrfError extends Error {
  readonly reason: string;
  readonly text: ErrorText;
  constructor(reason: string, text: ErrorText) {
    // English: this is what lands in the log, same rule as ApiError.
    super(serverText("en", text));
    this.name = "SsrfError";
    this.reason = reason;
    this.text = text;
  }

  /** Maps to a 400 `fetch_failed` — the URL is unusable, not our bug. */
  toApiError(): ApiError {
    return new ApiError(400, "fetch_failed", this.text, { reason: this.reason });
  }
}

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

let warnedAboutPrivateHosts = false;
function warnPrivateHostsAllowed(): void {
  if (warnedAboutPrivateHosts) return;
  warnedAboutPrivateHosts = true;
  console.warn(
    "[import] IMPORT_ALLOW_PRIVATE_HOSTS=1 — the URL importer's SSRF guard is disabled. Local tests only!",
  );
}

/** Hostnames that are never fetchable, regardless of what DNS says. */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
  "kubernetes",
  "kubernetes.default",
  "kubernetes.default.svc",
]);

/** Suffixes reserved for internal/private naming (RFC 6761, RFC 8375, k8s). */
const BLOCKED_SUFFIXES = [
  ".localhost",
  ".local",
  ".localdomain",
  ".internal",
  ".intranet",
  ".private",
  ".corp",
  ".home",
  ".lan",
  ".home.arpa",
  ".in-addr.arpa",
  ".ip6.arpa",
  ".svc",
  ".svc.cluster.local",
  ".cluster.local",
  ".onion",
];

interface Ipv4 {
  readonly octets: readonly [number, number, number, number];
}

/** Strict dotted-quad parser (no octal/hex/short forms — those are rejected). */
function parseIpv4(host: string): Ipv4 | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }
  return { octets: octets as unknown as Ipv4["octets"] };
}

/**
 * True for every IPv4 address that must never be fetched: loopback, private,
 * link-local (incl. 169.254.169.254 cloud metadata), CGNAT, benchmarking,
 * documentation, multicast, reserved and broadcast ranges.
 */
export function isPrivateIpv4(host: string): boolean {
  const parsed = parseIpv4(host);
  if (!parsed) return false;
  const [a, b, c, d] = parsed.octets;

  if (a === 0) return true; // 0.0.0.0/8 "this host"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 0 && c === 0) return true; // IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return true; // TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return true; // 6to4 relay anycast
  if (a === 192 && b === 168) return true; // private
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast, reserved, 255.255.255.255
  return a === 255 && b === 255 && c === 255 && d === 255;
}

/** Expands an IPv6 literal to its 8 hextets, or null when unparseable. */
function parseIpv6(input: string): number[] | null {
  let host = input.trim();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  // strip a zone id ("fe80::1%eth0")
  const percent = host.indexOf("%");
  if (percent !== -1) host = host.slice(0, percent);
  if (!host.includes(":")) return null;

  // an embedded IPv4 tail ("::ffff:127.0.0.1") becomes two hextets
  let tail: number[] = [];
  const lastColon = host.lastIndexOf(":");
  const candidate = host.slice(lastColon + 1);
  if (candidate.includes(".")) {
    const v4 = parseIpv4(candidate);
    if (!v4) return null;
    const [a, b, c, d] = v4.octets;
    tail = [(a << 8) | b, (c << 8) | d];
    host = host.slice(0, lastColon + 1) + "0";
  }

  const doubleColon = host.indexOf("::");
  let head: string[];
  let rear: string[];
  if (doubleColon === -1) {
    head = host.split(":");
    rear = [];
  } else {
    head = host.slice(0, doubleColon).split(":").filter((part) => part.length > 0);
    rear = host.slice(doubleColon + 2).split(":").filter((part) => part.length > 0);
  }

  const toHextet = (part: string): number | null => {
    if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return null;
    return Number.parseInt(part, 16);
  };

  const headValues: number[] = [];
  for (const part of head) {
    const value = toHextet(part);
    if (value === null) return null;
    headValues.push(value);
  }
  const rearValues: number[] = [];
  for (const part of rear) {
    const value = toHextet(part);
    if (value === null) return null;
    rearValues.push(value);
  }

  if (tail.length === 2) {
    // the placeholder "0" we appended replaces the IPv4 tail
    if (rear.length > 0) rearValues.pop();
    else headValues.pop();
  }

  const known = headValues.length + rearValues.length + tail.length;
  if (doubleColon === -1) {
    if (known !== 8) return null;
    return [...headValues, ...rearValues, ...tail];
  }
  if (known > 8) return null;
  const zeros = new Array<number>(8 - known).fill(0);
  return [...headValues, ...zeros, ...rearValues, ...tail];
}

/**
 * True for loopback (::1), unspecified (::), unique-local (fc00::/7),
 * link-local (fe80::/10), site-local (fec0::/10), IPv4-mapped/compatible and
 * NAT64 addresses whose embedded IPv4 is private, and multicast (ff00::/8).
 */
export function isPrivateIpv6(host: string): boolean {
  const hextets = parseIpv6(host);
  if (!hextets) return false;
  const [h0, h1, h2, h3, h4, h5, h6, h7] = hextets as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];

  const allZeroPrefix = h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0;
  if (allZeroPrefix && h5 === 0 && h6 === 0 && (h7 === 0 || h7 === 1)) return true; // :: and ::1
  // ::ffff:a.b.c.d (IPv4-mapped) and ::a.b.c.d (IPv4-compatible)
  if (allZeroPrefix && (h5 === 0xffff || h5 === 0)) {
    return isPrivateIpv4(embeddedIpv4(h6, h7));
  }
  // 64:ff9b::/96 NAT64
  if (h0 === 0x64 && h1 === 0xff9b && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0) {
    return isPrivateIpv4(embeddedIpv4(h6, h7));
  }
  if ((h0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((h0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
  if ((h0 & 0xffc0) === 0xfec0) return true; // fec0::/10 site local (deprecated)
  if ((h0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

function embeddedIpv4(high: number, low: number): string {
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
}

/** True for any IP literal (v4 or v6) that is not publicly routable. */
export function isPrivateAddress(host: string): boolean {
  return isPrivateIpv4(host) || isPrivateIpv6(host);
}

/** True when the hostname itself is on the deny-list (no DNS involved). */
export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host.length === 0) return true;
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  return BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export interface AssertPublicUrlOptions {
  /**
   * DNS resolver, injectable for tests. Must behave like
   * `dns.promises.lookup(host, { all: true })`.
   */
  resolve?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
  /** Skip DNS entirely (used when the caller already resolved the host). */
  skipDns?: boolean;
}

const defaultResolve = async (hostname: string): Promise<Array<{ address: string; family: number }>> =>
  await lookup(hostname, { all: true, verbatim: true });

/**
 * Validates a user-supplied URL for outbound fetching.
 *
 * @throws SsrfError when the URL is malformed, uses a forbidden scheme, points
 *   at a denied hostname, or resolves to a private/link-local address.
 * @returns the parsed URL (normalised) when it is safe to fetch.
 */
export async function assertPublicUrl(input: string, options: AssertPublicUrlOptions = {}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new SsrfError("invalid_url", "server.import.urlInvalid");
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new SsrfError("bad_scheme", { key: "server.import.schemeNotAllowed", values: { protocol: url.protocol } });
  }

  // Credentials in the URL are a classic way to confuse redirect targets.
  if (url.username.length > 0 || url.password.length > 0) {
    throw new SsrfError("credentials_in_url", "server.import.credentialsInUrl");
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname.length === 0) throw new SsrfError("no_host", "server.import.noHostname");

  /**
   * Development-only escape hatch (`IMPORT_ALLOW_PRIVATE_HOSTS=1`, ignored when
   * NODE_ENV=production, never set under `bun test`): allows importing from a
   * fixture served on 127.0.0.1. Scheme and credential checks above still apply.
   */
  if (env.allowPrivateImportHosts) {
    warnPrivateHostsAllowed();
    return url;
  }

  if (isBlockedHostname(hostname)) {
    throw new SsrfError("blocked_host", { key: "server.import.blockedHost", values: { hostname } });
  }
  if (isPrivateAddress(hostname)) {
    throw new SsrfError("private_ip", { key: "server.import.privateIp", values: { hostname } });
  }

  // Anything numeric-looking that got this far is refused: an IP literal is
  // never a legitimate recipe URL, and the octal/hex/decimal shorthands
  // (0177.0.0.1, 2130706433, 0x7f000001) exist only to smuggle past filters.
  if (/^[0-9]+$/.test(hostname) || /^0[xX][0-9a-fA-F]+$/.test(hostname) || /^[0-9.]+$/.test(hostname)) {
    throw new SsrfError("suspicious_host", { key: "server.import.suspiciousHost", values: { hostname } });
  }

  if (options.skipDns === true) return url;

  const resolver = options.resolve ?? defaultResolve;
  let records: Array<{ address: string; family: number }>;
  try {
    records = await resolver(hostname);
  } catch {
    throw new SsrfError("dns_failed", { key: "server.import.dnsFailed", values: { hostname } });
  }
  if (records.length === 0) {
    throw new SsrfError("dns_failed", { key: "server.import.dnsFailed", values: { hostname } });
  }
  for (const record of records) {
    if (isPrivateAddress(record.address)) {
      throw new SsrfError("private_ip", {
        key: "server.import.dnsPointsToPrivateIp",
        values: { hostname, address: record.address },
      });
    }
  }
  return url;
}
