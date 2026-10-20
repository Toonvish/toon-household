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
 *
 * The `Sessions` service (docs/EFFECT.md E7; plan `docs/plans/e2-api-core-services.md` P2, P7) reads the current
 * executor of `Database` on every call and its time from the `Clock`, inside each method, so a `TestClock` provided
 * around one run reaches it (`apps/api/test/sessions-clock.test.ts`). The expired-session sweep stays fire-and-forget
 * and catch-all (plan e2 P2): `resolveSession` starts it as a detached fiber whose whole cause is ignored, never
 * awaited by the request, and a failed sweep never breaks the request that triggered it. The pure helpers
 * (`generateSessionId`, `sessionHandle`) stay plain; the one Promise bridge at the end of the file (`createSession`) keeps
 * the import tests and `middleware.test.ts` working until E3.
 */
import type { SessionInfo } from "@toon/shared";
import { desc, eq, lt } from "drizzle-orm";
import { Clock, Context, Effect, Layer } from "effect";
import type { DrizzleDatabase } from "../../../db/client.ts";
import { Database } from "../../../db/database.ts";
import { type SessionRow, type UserRow, sessions, users } from "../../../db/schema.ts";
import { env } from "../../../env.ts";
import { SESSION_RENEW_THRESHOLD_MS, SESSION_TTL_MS } from "../../../lib/cookies.ts";
import type { DatabaseError } from "../../../lib/errors.ts";
import { toIso } from "../../../lib/http.ts";
import { runtime } from "../../../runtime.ts";

/** `lastUsedAt` is only written again after this much time, to avoid a write per request. */
const LAST_USED_WRITE_INTERVAL_MS = 60 * 1000;
/** At most one expired-session sweep per process in this interval. */
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/** When the last sweep started (`Clock` ms); one store per process, shared by every `Sessions` instance. */
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

export interface ResolvedSession {
  session: SessionRow;
  user: UserRow;
  /** True when the expiry was slid forward — the caller must re-set the cookie. */
  renewed: boolean;
}

/** Session rows: creation, resolution with the sliding expiry, revocation, listing and the expired sweep. */
export class Sessions extends Context.Service<
  Sessions,
  {
    /** Inserts a fresh session row and returns it. */
    readonly createSession: (
      userId: string,
      fingerprint?: RequestFingerprint,
    ) => Effect.Effect<SessionRow, DatabaseError>;
    /**
     * Looks up a session id, deleting it when expired. Succeeds with null for unknown,
     * expired or orphaned sessions; never fails for bad input.
     */
    readonly resolveSession: (sessionId: string) => Effect.Effect<ResolvedSession | null, DatabaseError>;
    /** Deletes one session (logout / revoke). Succeeds with true when a row was removed. */
    readonly deleteSession: (sessionId: string) => Effect.Effect<boolean, DatabaseError>;
    /** Deletes every session of a user except `keepSessionId` (password change). */
    readonly deleteOtherSessions: (userId: string, keepSessionId?: string) => Effect.Effect<void, DatabaseError>;
    /**
     * Best-effort cleanup of rows that expired a while ago, at most once per `SWEEP_INTERVAL_MS` per process.
     * Never fails: the whole cause of the delete is ignored.
     */
    readonly sweepExpiredSessions: () => Effect.Effect<void>;
    /** All live sessions of a user, newest first, as the API exposes them. */
    readonly listSessionsForUser: (
      userId: string,
      currentSessionId: string | undefined,
    ) => Effect.Effect<SessionInfo[], DatabaseError>;
    /**
     * Resolves a public session handle back to the real session id of that user.
     *
     * ONLY the handle is accepted. It used to also match the raw session id, which
     * meant `DELETE /api/auth/sessions/<real id>` worked — and hono's `logger()`
     * writes `c.req.path`, so a live 30-day session token ended up in the API log and
     * in every reverse-proxy access log, where it could be replayed as a cookie.
     */
    readonly findSessionByHandle: (userId: string, handle: string) => Effect.Effect<SessionRow | null, DatabaseError>;
  }
>()("toon/api/core/services/auth/sessions/Sessions") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const database = yield* Database;

      const createSession = Effect.fn("Sessions.createSession")(function* (
        userId: string,
        fingerprint: RequestFingerprint = {},
      ) {
        const now = yield* Clock.currentTimeMillis;
        const row: SessionRow = {
          id: generateSessionId(),
          userId,
          expiresAt: now + SESSION_TTL_MS,
          createdAt: now,
          lastUsedAt: now,
          ipAddress: fingerprint.ipAddress ?? null,
          userAgent: (fingerprint.userAgent ?? null)?.slice(0, 400) ?? null,
        };
        yield* database.use((db) => db.insert(sessions).values(row));
        return row;
      });

      // The throttle is read and moved before the delete starts; `resolveSession` forks this with
      // `startImmediately`, so the check runs synchronously in the request, as the old `void sweep…()` did.
      const sweepExpiredSessions = Effect.fn("Sessions.sweepExpiredSessions")(function* () {
        const now = yield* Clock.currentTimeMillis;
        if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
        lastSweepAt = now;
        yield* database.use((db) => db.delete(sessions).where(lt(sessions.expiresAt, now)));
      }, Effect.ignoreCause);

      const resolveSession = Effect.fn("Sessions.resolveSession")(function* (sessionId: string) {
        if (sessionId.length === 0 || sessionId.length > 256) return null;

        const rows = yield* database.use((db) =>
          db
            .select({ session: sessions, user: users })
            .from(sessions)
            .innerJoin(users, eq(users.id, sessions.userId))
            .where(eq(sessions.id, sessionId))
            .limit(1),
        );

        const found = rows[0];
        if (!found) return null;

        const now = yield* Clock.currentTimeMillis;
        if (found.session.expiresAt <= now) {
          yield* database.use((db) => db.delete(sessions).where(eq(sessions.id, sessionId)));
          return null;
        }

        // Fire-and-forget: a detached fiber the request never awaits (plan e2 P2).
        yield* Effect.forkDetach(sweepExpiredSessions(), { startImmediately: true });

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
          yield* database.use((db) => db.update(sessions).set(patch).where(eq(sessions.id, sessionId)));
          session = { ...session, ...patch };
        }

        const resolved: ResolvedSession = { session, user: found.user, renewed };
        return resolved;
      });

      const deleteSession = Effect.fn("Sessions.deleteSession")(function* (sessionId: string) {
        const existing = yield* database.use((db) =>
          db.select({ id: sessions.id }).from(sessions).where(eq(sessions.id, sessionId)).limit(1),
        );
        if (existing.length === 0) return false;
        yield* database.use((db) => db.delete(sessions).where(eq(sessions.id, sessionId)));
        return true;
      });

      const deleteOtherSessions = Effect.fn("Sessions.deleteOtherSessions")(function* (
        userId: string,
        keepSessionId?: string,
      ) {
        const rows = yield* database.use((db) =>
          db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, userId)),
        );
        for (const row of rows) {
          if (row.id === keepSessionId) continue;
          yield* database.use((db) => db.delete(sessions).where(eq(sessions.id, row.id)));
        }
      });

      const listSessionsForUser = Effect.fn("Sessions.listSessionsForUser")(function* (
        userId: string,
        currentSessionId: string | undefined,
      ) {
        const now = yield* Clock.currentTimeMillis;
        const rows = yield* database.use((db) =>
          db.select().from(sessions).where(eq(sessions.userId, userId)).orderBy(desc(sessions.lastUsedAt)),
        );

        return rows
          .filter((row) => row.expiresAt > now)
          .map(
            (row): SessionInfo => ({
              id: sessionHandle(row.id),
              current: row.id === currentSessionId,
              createdAt: toIso(row.createdAt),
              lastUsedAt: toIso(row.lastUsedAt),
              expiresAt: toIso(row.expiresAt),
              ipAddress: row.ipAddress,
              userAgent: row.userAgent,
            }),
          );
      });

      const findSessionByHandle = Effect.fn("Sessions.findSessionByHandle")(function* (
        userId: string,
        handle: string,
      ) {
        const rows = yield* database.use((db) => db.select().from(sessions).where(eq(sessions.userId, userId)));
        return rows.find((row) => sessionHandle(row.id) === handle) ?? null;
      });

      return Sessions.of({
        createSession,
        resolveSession,
        deleteSession,
        deleteOtherSessions,
        sweepExpiredSessions,
        listSessionsForUser,
        findSessionByHandle,
      });
    }),
  );
}

/* legacy bridges: callers listed; E3 (recipe), E4 (finance), E5 (scripts) remove them */

/**
 * Callers: `apps/api/test/middleware.test.ts` (pinned), `apps/api/test/import/routes.test.ts`,
 * `apps/api/test/import/ocr-disabled.test.ts` (E3). Promise.
 */
export function createSession(
  database: DrizzleDatabase,
  userId: string,
  fingerprint: RequestFingerprint = {},
): Promise<SessionRow> {
  return runtime.runPromise(
    Sessions.use((service) => service.createSession(userId, fingerprint)).pipe(Database.withExecutor(database)),
  );
}
