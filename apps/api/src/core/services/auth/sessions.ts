/**
 * OWNER: auth agent.
 *
 * Opaque database sessions. The cookie value IS the primary key of the
 * `sessions` row — there is no JWT and no signature to verify, so revoking a
 * session is a single DELETE.
 *
 * - id: 32 random bytes, base64url (256 bit entropy)
 * - 30-day expiry, slid forward on use once less than 15 days remain
 * - expired rows are deleted when they are read (plus a cheap periodic sweep)
 */
import type { SessionInfo } from "@toon/shared";
import { desc, eq, lt } from "drizzle-orm";
import type { Database } from "../../../db/client.ts";
import { type SessionRow, type UserRow, sessions, users } from "../../../db/schema.ts";
import { env } from "../../../env.ts";
import { SESSION_RENEW_THRESHOLD_MS, SESSION_TTL_MS } from "../../../lib/cookies.ts";
import { toIso } from "../../../lib/http.ts";

/** `lastUsedAt` is only written again after this much time, to avoid a write per request. */
const LAST_USED_WRITE_INTERVAL_MS = 60 * 1000;
/** At most one expired-session sweep per process in this interval. */
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

let lastSweepAt = 0;

/** Cryptographically random, URL-safe session id (32 bytes -> 43 chars). */
export function generateSessionId(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

/**
 * Stable public handle of a session, derived from the id + SESSION_SECRET.
 * `GET /api/auth/sessions` must never hand out cookie values, but the UI still
 * needs something to pass to `DELETE /api/auth/sessions/:sessionId`.
 */
export function sessionHandle(sessionId: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(`${env.SESSION_SECRET}:${sessionId}`);
  return hasher.digest("hex").slice(0, 32);
}

export interface RequestFingerprint {
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** Inserts a fresh session row and returns it. */
export async function createSession(
  database: Database,
  userId: string,
  fingerprint: RequestFingerprint = {},
): Promise<SessionRow> {
  const now = Date.now();
  const row: SessionRow = {
    id: generateSessionId(),
    userId,
    expiresAt: now + SESSION_TTL_MS,
    createdAt: now,
    lastUsedAt: now,
    ipAddress: fingerprint.ipAddress ?? null,
    userAgent: (fingerprint.userAgent ?? null)?.slice(0, 400) ?? null,
  };
  await database.insert(sessions).values(row);
  return row;
}

export interface ResolvedSession {
  session: SessionRow;
  user: UserRow;
  /** True when the expiry was slid forward — the caller must re-set the cookie. */
  renewed: boolean;
}

/**
 * Looks up a session id, deleting it when expired. Returns null for unknown,
 * expired or orphaned sessions; never throws for bad input.
 */
export async function resolveSession(
  database: Database,
  sessionId: string,
): Promise<ResolvedSession | null> {
  if (sessionId.length === 0 || sessionId.length > 256) return null;

  const rows = await database
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, sessionId))
    .limit(1);

  const found = rows[0];
  if (!found) return null;

  const now = Date.now();
  if (found.session.expiresAt <= now) {
    await database.delete(sessions).where(eq(sessions.id, sessionId));
    return null;
  }

  void sweepExpiredSessions(database);

  let session = found.session;
  let renewed = false;
  const patch: Partial<SessionRow> = {};

  if (session.expiresAt - now < SESSION_RENEW_THRESHOLD_MS) {
    patch.expiresAt = now + SESSION_TTL_MS;
    renewed = true;
  }
  if (now - session.lastUsedAt > LAST_USED_WRITE_INTERVAL_MS) {
    patch.lastUsedAt = now;
  }
  if (Object.keys(patch).length > 0) {
    await database.update(sessions).set(patch).where(eq(sessions.id, sessionId));
    session = { ...session, ...patch };
  }

  return { session, user: found.user, renewed };
}

/** Deletes one session (logout / revoke). Returns true when a row was removed. */
export async function deleteSession(database: Database, sessionId: string): Promise<boolean> {
  const existing = await database
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);
  if (existing.length === 0) return false;
  await database.delete(sessions).where(eq(sessions.id, sessionId));
  return true;
}

/** Deletes every session of a user except `keepSessionId` (password change). */
export async function deleteOtherSessions(
  database: Database,
  userId: string,
  keepSessionId?: string,
): Promise<void> {
  const rows = await database
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.userId, userId));
  for (const row of rows) {
    if (row.id === keepSessionId) continue;
    await database.delete(sessions).where(eq(sessions.id, row.id));
  }
}

/** Best-effort cleanup of rows that expired a while ago. Never rejects. */
export async function sweepExpiredSessions(database: Database): Promise<void> {
  const now = Date.now();
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
  try {
    await database.delete(sessions).where(lt(sessions.expiresAt, now));
  } catch {
    // A failed cleanup must never break the request that triggered it.
  }
}

/** All live sessions of a user, newest first, as the API exposes them. */
export async function listSessionsForUser(
  database: Database,
  userId: string,
  currentSessionId: string | undefined,
): Promise<SessionInfo[]> {
  const now = Date.now();
  const rows = await database
    .select()
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(desc(sessions.lastUsedAt));

  return rows
    .filter((row) => row.expiresAt > now)
    .map((row) => ({
      id: sessionHandle(row.id),
      current: row.id === currentSessionId,
      createdAt: toIso(row.createdAt),
      lastUsedAt: toIso(row.lastUsedAt),
      expiresAt: toIso(row.expiresAt),
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
    }));
}

/**
 * Resolves a public session handle back to the real session id of that user.
 *
 * ONLY the handle is accepted. It used to also match the raw session id, which
 * meant `DELETE /api/auth/sessions/<real id>` worked — and hono's `logger()`
 * writes `c.req.path`, so a live 30-day session token ended up in the API log and
 * in every reverse-proxy access log, where it could be replayed as a cookie.
 */
export async function findSessionByHandle(
  database: Database,
  userId: string,
  handle: string,
): Promise<SessionRow | null> {
  const rows = await database.select().from(sessions).where(eq(sessions.userId, userId));
  return rows.find((row) => sessionHandle(row.id) === handle) ?? null;
}
