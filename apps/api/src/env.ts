/**
 * Zod-validated environment. Import `env` anywhere in the API — it is parsed
 * exactly once at module load and fails fast with a readable message.
 *
 * Every variable is documented in /.env.example.
 */
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { LOCALES } from "@toon/shared";
import { z } from "zod";

/** Monorepo root (apps/api/src/env.ts -> ../../..). */
export const REPO_ROOT = resolve(import.meta.dir, "../../..");

/**
 * Bun only auto-loads .env from the current working directory, but the API is
 * started from apps/api. So we load the ROOT .env (and .env.local) ourselves —
 * existing process env always wins.
 */
function loadRootDotEnv(): void {
  // Never let a developer .env leak into `bun test` — tests use file::memory:
  // unless the test itself sets the variable in process.env.
  if (process.env.NODE_ENV === "test") return;
  for (const file of [".env", ".env.local"]) {
    const path = join(REPO_ROOT, file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!match) continue;
      const key = match[1]!;
      if (process.env[key] !== undefined) continue;
      let value = match[2]!.trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      } else {
        value = value.replace(/\s+#.*$/, "").trim();
      }
      process.env[key] = value;
    }
  }
}
loadRootDotEnv();

/** Resolves a relative `file:` DB path against the repo root, not the cwd. */
function resolveDatabaseUrl(url: string): string {
  if (!url.startsWith("file:")) return url;
  const path = url.slice("file:".length);
  if (path.length === 0 || path.startsWith(":memory:") || isAbsolute(path)) return url;
  return `file:${resolve(REPO_ROOT, path)}`;
}

const BooleanishSchema = z
  .string()
  .transform((value) => value === "1" || value.toLowerCase() === "true")
  .optional();

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

    /** "file:./data/local.db" (self-hosted) or "libsql://xxx.turso.io" (Turso cloud). */
    DATABASE_URL: z.string().min(1, "DATABASE_URL fehlt (z. B. file:./data/local.db)"),
    /** Only needed for remote libsql:// / https:// URLs. */
    DATABASE_AUTH_TOKEN: z.string().optional(),

    API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    /**
     * The interface locale a request/mail falls back to when nothing more
     * specific is known: an unrecognised/absent `Accept-Language`, or a
     * recipient whose `users.locale` is null. NOT the CONTENT language of a
     * recipe (`recipes.language`) — see CLAUDE.md's interface/content gotcha.
     */
    DEFAULT_LOCALE: z.enum(LOCALES).default("de"),
    /** Comma-separated list of allowed browser origins (CORS, credentials: true). */
    WEB_ORIGIN: z.string().min(1).default("http://localhost:5173"),
    SESSION_SECRET: z.string().min(16, "SESSION_SECRET muss mindestens 16 Zeichen haben"),

    PUBLIC_API_URL: z.string().optional(),

    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    GITHUB_CLIENT_ID: z.string().optional(),
    GITHUB_CLIENT_SECRET: z.string().optional(),
    /** Public base URL of the API; OAuth redirect URIs are built from it. */
    OAUTH_REDIRECT_BASE: z.string().default("http://localhost:3001"),

    UPLOAD_DIR: z.string().default("./data/uploads"),

    /**
     * FEATURE FLAG for PHOTO import. **Off unless set**, which is the whole
     * point: URL import is pure fetch-and-parse, while OCR needs the `tesseract`
     * binary (~105 MB with the language packs Debian pulls in) plus `sharp`
     * resident whenever a job runs. A small VPS runs the app comfortably without
     * it; turning this on is an explicit decision to pay for it. See
     * services/import/capabilities.ts for what it gates.
     *
     * Enabling it on an image built WITHOUT the binary is not a crash: the
     * pipeline answers the documented 422 (`ocr_failed` /
     * `reason: "tesseract_unavailable"`). The Docker image derives its default
     * from the `WITH_OCR` build arg, so a slim image ships with this off.
     */
    IMPORT_OCR_ENABLED: BooleanishSchema,

    /**
     * FEATURE FLAG for PDF import, separate from photos because it costs an order
     * of magnitude more: a scan is up to MAX_PDF_PAGES tesseract runs plus poppler,
     * and even a digital PDF hands `unpdf` the whole parsed document. On one core
     * a ten-page scan cannot finish inside OCR_TIMEOUT_MS, so a small box wants
     * photos WITHOUT PDFs.
     *
     * UNSET FOLLOWS `IMPORT_OCR_ENABLED`, so an existing deployment that turned OCR
     * on keeps PDF import exactly as before and only an explicit `0` takes it away.
     */
    IMPORT_PDF_ENABLED: BooleanishSchema,

    /**
     * How many OCR pipelines may run at once, process-wide. This is directly the
     * peak number of concurrent `tesseract` processes, i.e. the app's memory
     * ceiling — see MAX_CONCURRENT_OCR's seat in services/ocr/index.ts.
     *
     * DEFAULT 1, because one job already saturates a one-core VPS and two peaked
     * past what a 1 GB box has. Raise it only with a `docker stats` measurement of
     * two parallel photo imports. A request that finds every slot taken now WAITS
     * (bounded) instead of failing immediately.
     */
    IMPORT_OCR_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(1),

    TESSERACT_LANGS: z.string().default("deu+eng"),
    /**
     * OCR and PDF rasterization run as NATIVE SUBPROCESSES, so both binaries have
     * to be on the host. The Docker image installs them (`tesseract-ocr`,
     * `tesseract-ocr-deu`, `tesseract-ocr-eng`, `poppler-utils`); these overrides
     * exist for a dev machine that keeps them somewhere else, or a Nix/Homebrew
     * path. Each language in TESSERACT_LANGS needs its own `tesseract-ocr-<lang>`
     * package — a missing one fails at recognise time with a 422 naming it.
     */
    TESSERACT_BIN: z.string().default("tesseract"),
    PDFTOPPM_BIN: z.string().default("pdftoppm"),

    /**
     * Directory of the built web app (`apps/web/dist`). When set, the API also
     * serves the PWA from its own port — which is how the Docker image runs, and
     * the reason a container needs no CORS, no second origin and no API URL baked
     * into the bundle at build time. Unset in dev, where vite serves it.
     */
    WEB_DIST_DIR: z.string().optional(),

    /**
     * Outgoing mail. ALL OPTIONAL: with nothing configured the API uses the
     * ConsoleMailer, which logs the message (including the link) and sends
     * nothing — so `bun run dev` and `bun test` never touch the network and an
     * install without mail still boots.
     *
     * "console" (default) | "smtp" | "resend"
     *
     * "smtp" is the self-hosted transport and needs no API key at all — any mail
     * provider's submission access will do; see MAIL_HOST below. The Docker stack
     * leaves this UNSET, so a deployment that never configures mail logs its links
     * rather than pretending to send them.
     */
    MAIL_TRANSPORT: z.enum(["console", "smtp", "resend"]).optional(),
    /** Sender, "Name <address>" or a bare address. Required for a real transport. */
    MAIL_FROM: z.string().optional(),
    /** Resend API key (re_…). Required when MAIL_TRANSPORT=resend. */
    MAIL_API_KEY: z.string().optional(),

    /** SMTP relay host, e.g. "smtp.resend.com". Required when MAIL_TRANSPORT=smtp. */
    MAIL_HOST: z.string().optional(),
    /** Defaults to 465 for MAIL_SECURITY=tls, otherwise 587. */
    MAIL_PORT: z.coerce.number().int().min(1).max(65535).optional(),
    /** Omit both for a relay that does not authenticate. */
    MAIL_USER: z.string().optional(),
    MAIL_PASSWORD: z.string().optional(),
    /**
     * "starttls" (default) — plaintext greeting then a MANDATORY upgrade, port 587,
     * "tls"                — TLS from the first byte, port 465,
     * "none"               — plaintext, only defensible for a relay on the same
     *                        private network, and env.ts refuses to combine it
     *                        with credentials.
     */
    MAIL_SECURITY: z.enum(["starttls", "tls", "none"]).optional(),
    /** Accept a self-signed relay certificate. Off unless you know why you need it. */
    MAIL_TLS_INSECURE: BooleanishSchema,

    /** Optional: set to 1 to log every SQL statement. */
    DEBUG_SQL: BooleanishSchema,

    /**
     * DANGEROUS, development only: lets the URL importer fetch localhost /
     * private-network addresses. Needed to import from a fixture served on
     * 127.0.0.1 (see the smoke test in README.md). IGNORED in production.
     */
    IMPORT_ALLOW_PRIVATE_HOSTS: BooleanishSchema,

    /**
     * Set to 1 ONLY when the API really sits behind a reverse proxy that
     * overwrites X-Forwarded-For (nginx/Caddy/Traefik/Cloudflare). Without it the
     * rate limiter uses the socket address, because otherwise anyone could reset
     * their own login/register bucket by sending a fresh X-Forwarded-For header.
     */
    TRUST_PROXY: BooleanishSchema,
  })
  .transform((value) => {
    const isRemoteDb = /^(libsql|https|http|wss|ws):/i.test(value.DATABASE_URL);
    return {
      ...value,
      isProduction: value.NODE_ENV === "production",
      isTest: value.NODE_ENV === "test",
      /** Origins allowed by CORS, already split and trimmed. */
      webOrigins: value.WEB_ORIGIN.split(",")
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
      /** "remote" for Turso cloud, "file" for a local libSQL file / memory DB. */
      databaseKind: (isRemoteDb ? "remote" : "file") as "remote" | "file",
      /** DATABASE_URL with relative file: paths resolved against the repo root. */
      databaseUrl: resolveDatabaseUrl(value.DATABASE_URL),
      /** Absolute upload directory (relative paths resolve from the repo root). */
      uploadDir: resolve(REPO_ROOT, value.UPLOAD_DIR),
      googleOAuthConfigured:
        typeof value.GOOGLE_CLIENT_ID === "string" &&
        value.GOOGLE_CLIENT_ID.length > 0 &&
        typeof value.GOOGLE_CLIENT_SECRET === "string" &&
        value.GOOGLE_CLIENT_SECRET.length > 0,
      githubOAuthConfigured:
        typeof value.GITHUB_CLIENT_ID === "string" &&
        value.GITHUB_CLIENT_ID.length > 0 &&
        typeof value.GITHUB_CLIENT_SECRET === "string" &&
        value.GITHUB_CLIENT_SECRET.length > 0,
      /** Whether X-Forwarded-For / X-Real-IP may be believed (see TRUST_PROXY). */
      trustProxy: value.TRUST_PROXY === true,
      /** SSRF guard escape hatch — can never be enabled in production. */
      allowPrivateImportHosts:
        value.IMPORT_ALLOW_PRIVATE_HOSTS === true && value.NODE_ENV !== "production",
      /**
       * Whether PHOTO import is offered at all (see IMPORT_OCR_ENABLED).
       * Read through `isOcrImportEnabled()` in services/import/capabilities.ts,
       * never directly, so tests can flip it.
       */
      ocrImportEnabled: value.IMPORT_OCR_ENABLED === true,
      /**
       * Whether PDF import is offered (see IMPORT_PDF_ENABLED). Unset FOLLOWS the
       * photo flag, so `IMPORT_OCR_ENABLED=1` alone keeps the pre-split behaviour
       * and only an explicit `IMPORT_PDF_ENABLED=0` splits them apart.
       */
      pdfImportEnabled: (value.IMPORT_PDF_ENABLED ?? value.IMPORT_OCR_ENABLED) === true,
      /** Peak concurrent OCR pipelines; see IMPORT_OCR_CONCURRENCY. */
      ocrConcurrency: value.IMPORT_OCR_CONCURRENCY,
      /** Which mail adapter services/mail/index.ts builds. Always "console" in tests. */
      mailTransport: (value.NODE_ENV === "test" ? "console" : value.MAIL_TRANSPORT ?? "console") as
        | "console"
        | "smtp"
        | "resend",
      /** Sender address; the ConsoleMailer is happy with the placeholder. */
      mailFrom: value.MAIL_FROM ?? "Rezepte <noreply@localhost>",
      /** How the SMTP session is encrypted; see MAIL_SECURITY. */
      mailSecurity: (value.MAIL_SECURITY ?? "starttls") as "starttls" | "tls" | "none",
      /** Submission port, defaulted from the chosen security rather than guessed. */
      mailPort: value.MAIL_PORT ?? (value.MAIL_SECURITY === "tls" ? 465 : 587),
      /** Absolute path of the built web app, or null when the API serves no UI. */
      webDistDir:
        value.WEB_DIST_DIR === undefined ? null : resolve(REPO_ROOT, value.WEB_DIST_DIR),
      /** The locale `requestLocale(c)` and mail fall back to. See DEFAULT_LOCALE above. */
      defaultLocale: value.DEFAULT_LOCALE,
    };
  })
  .refine(
    (value) => value.databaseKind === "file" || (value.DATABASE_AUTH_TOKEN ?? "").length > 0,
    "DATABASE_AUTH_TOKEN is required for a remote libsql:// database",
  )
  // Fail at boot rather than at the first invite: a deployment that asked for a
  // real transport but forgot the key would otherwise look fine and silently
  // never deliver anything.
  .refine(
    (value) => value.mailTransport !== "resend" || (value.MAIL_API_KEY ?? "").length > 0,
    "MAIL_API_KEY is required for MAIL_TRANSPORT=resend",
  )
  .refine(
    (value) => value.mailTransport === "console" || (value.MAIL_FROM ?? "").length > 0,
    "MAIL_FROM is required for a real MAIL_TRANSPORT (a verified sender domain)",
  )
  .refine(
    (value) => value.mailTransport !== "smtp" || (value.MAIL_HOST ?? "").length > 0,
    "MAIL_HOST is required for MAIL_TRANSPORT=smtp (your mail provider's submission host)",
  )
  // Credentials over an unencrypted session would be readable by anything on the
  // path. The only setup that legitimately uses MAIL_SECURITY=none is a relay on
  // the same private network, and that one needs no login — so this combination is
  // always a mistake, and it is one that looks like it works.
  .refine(
    (value) =>
      value.mailTransport !== "smtp" ||
      (value.MAIL_SECURITY ?? "starttls") !== "none" ||
      (value.MAIL_USER ?? "").length === 0,
    "MAIL_USER/MAIL_PASSWORD must not be combined with MAIL_SECURITY=none — the credentials would cross the network in cleartext (use MAIL_SECURITY=starttls or =tls)",
  );

export type Env = z.infer<typeof EnvSchema>;

/**
 * Test-friendly defaults so `bun test` works without any setup — and so a
 * developer .env (which Bun auto-loads from the cwd) can never point tests at
 * the real database. Override with TEST_DATABASE_URL if you really need a file.
 */
function rawEnv(): Record<string, string | undefined> {
  const source: Record<string, string | undefined> = {};
  // Empty strings in .env ("DATABASE_AUTH_TOKEN=") mean "not set", so that
  // .default()/.optional() kick in instead of failing a min(1) check.
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string" && value.trim().length === 0) continue;
    source[key] = value;
  }
  if (source.NODE_ENV === "test") {
    source.DATABASE_URL = source.TEST_DATABASE_URL ?? "file::memory:";
    source.DATABASE_AUTH_TOKEN = source.TEST_DATABASE_URL ? source.DATABASE_AUTH_TOKEN : undefined;
    source.SESSION_SECRET ??= "test-secret-test-secret-test-secret";
  }
  return source;
}

function loadEnv(): Env {
  const result = EnvSchema.safeParse(rawEnv());
  if (!result.success) {
    const lines = result.error.issues.map((issue) => {
      const key = issue.path.join(".") || "(env)";
      return `  - ${key}: ${issue.message}`;
    });
    const message = [
      "Invalid environment variables — check your .env (template: .env.example):",
      ...lines,
    ].join("\n");
    // Fail fast, no stack trace noise.
    console.error(message);
    process.exit(1);
  }
  return result.data;
}

export const env: Env = loadEnv();
