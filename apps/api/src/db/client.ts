/**
 * libSQL client + drizzle instance.
 *
 * The driver choice is NEVER hardcoded: everything comes from DATABASE_URL.
 *   file:./data/local.db      -> self-hosted local file (directory is created)
 *   file::memory:             -> in-memory (tests)
 *   libsql://xxx.turso.io     -> Turso cloud (requires DATABASE_AUTH_TOKEN)
 */
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { type Client, createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { env } from "../env.ts";
import * as schema from "./schema.ts";

export type Database = ReturnType<typeof drizzle<typeof schema>>;

/** Resolves a `file:` URL against process.cwd() and creates the directory. */
function prepareUrl(url: string): string {
  if (!url.startsWith("file:")) return url;
  const path = url.slice("file:".length);
  if (path.startsWith(":memory:") || path.length === 0) return url;
  const absolute = isAbsolute(path) ? path : resolve(process.cwd(), path);
  mkdirSync(dirname(absolute), { recursive: true });
  return `file:${absolute}`;
}

/**
 * Connection PRAGMAs for a local `file:` database, in the order they are sent.
 *
 * WITHOUT THESE, EVERY WRITE COSTS A FULL fsync. libSQL's defaults are
 * `journal_mode=delete` + `synchronous=FULL`, which measured (ext4, NVMe) at
 * **15.5 ms for a single-row INSERT**; WAL alone brings that to 5.2 ms and
 * WAL + `synchronous=NORMAL` to **0.04 ms**. On the slow storage a cheap VPS or an
 * SD-card machine offers, the untuned figure is far worse. It is paid by every shopping-list
 * write (i.e. every replayed offline mutation) and by the `sessions.last_used_at`
 * refresh that any request older than a minute triggers.
 *
 * `journal_mode` is PERSISTENT in the database file, but `synchronous` is
 * PER-CONNECTION — which is exactly why this belongs here and not in a migration.
 * A connection that skips it silently falls back to FULL and pays 5 ms a write.
 *
 * **`synchronous = FULL`, not `NORMAL` — the one pragma this repo sets
 * differently from toon-recipe, and on purpose (SPEC D7).** toon-recipe set
 * `NORMAL` and said why, word for word: *"can lose the last transactions to a
 * power cut, never to a process crash — the right trade for a recipe box, not
 * for a ledger."* The finance module's ledger lives in this file now — SPEC D7:
 * two people settle real money against the balance it holds, and the last
 * committed settlement disappearing after a power cut (not a crash — WAL
 * already survives a crash either way) is not a failure mode either of them
 * would accept from a cash book. The measured price is the 5.2 ms vs. 0.04 ms
 * per write above — real, but a household makes a few dozen to a few hundred
 * writes a day, not a few thousand per second, so it is unmeasurable in
 * practice. WAL still buys the bulk of the win over the 15.5 ms default.
 *
 * `synchronous` is still sent explicitly on every connection even though the
 * libSQL default is also `FULL`: the failure mode of forgetting the line is
 * "invisible", never "wrong", and this comment exists so nobody "optimises" it
 * back to `NORMAL` without re-reading the trade-off above.
 *
 * NEVER SENT TO A REMOTE DATABASE. Against `libsql://…turso.io` these are
 * meaningless at best — the storage engine is not ours — so they are skipped, as
 * they are for `:memory:` (no journal, nothing to tune).
 */
const LOCAL_FILE_PRAGMAS: readonly string[] = [
  "journal_mode = WAL",
  "synchronous = FULL",
  // Wait rather than throw SQLITE_BUSY when another connection holds the write
  // lock. The default is 0, i.e. fail immediately.
  "busy_timeout = 5000",
  // 64 MB of page cache (negative = KiB, not pages). The default 2 MB cannot hold
  // the recipes table plus its indexes, so a list query re-read pages every time.
  "cache_size = -65536",
  // Read pages straight out of the page cache instead of copying through a
  // syscall. Harmless when the file is smaller than the limit.
  "mmap_size = 268435456",
];

/** True for a local file DB — the only kind whose PRAGMAs we own. */
function isLocalFile(url: string): boolean {
  return url.startsWith("file:") && !url.includes(":memory:");
}

export interface CreateDatabaseOptions {
  url?: string;
  authToken?: string;
}

export interface CreatedDatabase {
  client: Client;
  db: Database;
  /**
   * Resolves once {@link LOCAL_FILE_PRAGMAS} have been applied.
   *
   * The statements are QUEUED before this function returns, and libSQL serialises
   * everything on a connection, so any query issued afterwards already runs with
   * them in effect — awaiting is belt and braces, and a place to see a failure.
   * `src/index.ts` awaits it before serving so a broken DB fails at boot.
   */
  ready: Promise<void>;
}

/**
 * Builds an independent client + drizzle instance. Use this in tests
 * (`createDatabase({ url: "file::memory:" })`); the app uses the shared `db`.
 */
export function createDatabase(options: CreateDatabaseOptions = {}): CreatedDatabase {
  const url = prepareUrl(options.url ?? env.databaseUrl);
  const authToken = options.authToken ?? env.DATABASE_AUTH_TOKEN;
  const client = createClient(authToken ? { url, authToken } : { url });
  const db = drizzle(client, { schema, logger: env.DEBUG_SQL === true });
  return { client, db, ready: applyPragmas(client, url) };
}

/**
 * Sends the tuning PRAGMAs. Never rejects for a reason that should not stop the
 * server: an old libSQL that rejects one of them must not take the API down, so a
 * failure is logged and the process continues on the slow-but-correct defaults.
 */
async function applyPragmas(client: Client, url: string): Promise<void> {
  if (!isLocalFile(url)) return;
  for (const pragma of LOCAL_FILE_PRAGMAS) {
    try {
      await client.execute(`PRAGMA ${pragma}`);
    } catch (error) {
      if (!env.isTest) {
        const reason = error instanceof Error ? error.message : String(error);
        console.warn(`[db] PRAGMA ${pragma} abgelehnt: ${reason}`);
      }
    }
  }
}

const shared = createDatabase();

/** Process-wide libSQL client. */
export const client: Client = shared.client;
/** Process-wide drizzle instance — import this in routes. */
export const db: Database = shared.db;
/** Awaited by src/index.ts before the first request — see {@link CreatedDatabase.ready}. */
export const dbReady: Promise<void> = shared.ready;

export { schema };
