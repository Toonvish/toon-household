/**
 * `parseEnv` (apps/api/src/env.ts): the pure half of the environment loader. Table-driven over
 * raw `Record<string, string | undefined>` maps, so it pins defaults, coercions, the booleanish
 * rule, enums, derived fields, the two German `min` messages and the six cross-field refinements
 * (in order) without touching `process.env`. Imports no schema library (plan e1 P20): the same
 * file runs unchanged before and after env.ts moved from Zod to Effect Schema.
 *
 * Line texts are asserted only where env.ts spells them out; a generic failure (a missing or
 * mistyped variable) is checked by its `  - KEY: ` prefix, because the library words that message.
 */
import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { parseEnv, REPO_ROOT, type Env } from "../src/env";

const BASE = { DATABASE_URL: "file:./data/x.db", SESSION_SECRET: "0123456789abcdef" };
type Source = Record<string, string | undefined>;

function ok(extra: Source = {}, base: Source = BASE): Env {
  const result = parseEnv({ ...base, ...extra });
  if (!result.ok) throw new Error(`expected ok, got:\n${result.lines.join("\n")}`);
  return result.env;
}

function failLines(source: Source): string[] {
  const result = parseEnv(source);
  if (result.ok) throw new Error("expected a failure, got an env");
  return result.lines;
}

/** The `KEY` of every `  - KEY: message` line, in order. */
function keys(lines: string[]): string[] {
  return lines.map((line) => /^ {2}- ([^:]+): /.exec(line)?.[1] ?? `<bad line: ${line}>`);
}

describe("parseEnv: defaults", () => {
  test("a minimal source gets every default", () => {
    const env = ok();
    expect(env.NODE_ENV).toBe("development");
    expect(env.API_PORT).toBe(3001);
    expect(env.DEFAULT_LOCALE).toBe("de");
    expect(env.WEB_ORIGIN).toBe("http://localhost:5173");
    expect(env.OAUTH_REDIRECT_BASE).toBe("http://localhost:3001");
    expect(env.UPLOAD_DIR).toBe("./data/uploads");
    expect(env.IMPORT_OCR_CONCURRENCY).toBe(1);
    expect(env.TESSERACT_LANGS).toBe("deu+eng");
    expect(env.TESSERACT_BIN).toBe("tesseract");
    expect(env.PDFTOPPM_BIN).toBe("pdftoppm");
    expect(env.DATABASE_URL).toBe("file:./data/x.db");
    expect(env.SESSION_SECRET).toBe("0123456789abcdef");
  });

  test("unset optionals stay undefined", () => {
    const env = ok();
    for (const key of [
      "DATABASE_AUTH_TOKEN",
      "PUBLIC_API_URL",
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "GITHUB_CLIENT_ID",
      "GITHUB_CLIENT_SECRET",
      "IMPORT_OCR_ENABLED",
      "IMPORT_PDF_ENABLED",
      "WEB_DIST_DIR",
      "MAIL_TRANSPORT",
      "MAIL_FROM",
      "MAIL_API_KEY",
      "MAIL_HOST",
      "MAIL_PORT",
      "MAIL_USER",
      "MAIL_PASSWORD",
      "MAIL_SECURITY",
      "MAIL_TLS_INSECURE",
      "DEBUG_SQL",
      "IMPORT_ALLOW_PRIVATE_HOSTS",
      "TRUST_PROXY",
    ] as const) {
      expect(env[key]).toBeUndefined();
    }
  });

  test("the derived fields of the minimal source", () => {
    const env = ok();
    expect(env.isProduction).toBe(false);
    expect(env.isTest).toBe(false);
    expect(env.webOrigins).toEqual(["http://localhost:5173"]);
    expect(env.databaseKind).toBe("file");
    expect(env.databaseUrl).toBe(`file:${resolve(REPO_ROOT, "./data/x.db")}`);
    expect(env.uploadDir).toBe(resolve(REPO_ROOT, "./data/uploads"));
    expect(env.googleOAuthConfigured).toBe(false);
    expect(env.githubOAuthConfigured).toBe(false);
    expect(env.trustProxy).toBe(false);
    expect(env.allowPrivateImportHosts).toBe(false);
    expect(env.ocrImportEnabled).toBe(false);
    expect(env.pdfImportEnabled).toBe(false);
    expect(env.ocrConcurrency).toBe(1);
    expect(env.mailTransport).toBe("console");
    expect(env.mailFrom).toBe("Rezepte <noreply@localhost>");
    expect(env.mailSecurity).toBe("starttls");
    expect(env.mailPort).toBe(587);
    expect(env.webDistDir).toBeNull();
    expect(env.defaultLocale).toBe("de");
  });

  test("unknown variables are not part of the result", () => {
    const env = ok({ PATH: "/usr/bin", SOMETHING_ELSE: "x" }) as Record<string, unknown>;
    expect(env.PATH).toBeUndefined();
    expect(env.SOMETHING_ELSE).toBeUndefined();
  });
});

describe("parseEnv: numeric coercion", () => {
  const portCases: Array<[string, number | "fail"]> = [
    ["8080", 8080],
    ["1", 1],
    ["65535", 65535],
    [" 3002 ", 3002],
    ["0x10", 16],
    ["1e3", 1000],
    ["0", "fail"],
    ["65536", "fail"],
    ["abc", "fail"],
    ["1.5", "fail"],
    ["", "fail"],
    ["-1", "fail"],
    ["Infinity", "fail"],
  ];
  for (const [input, expected] of portCases) {
    test(`API_PORT ${JSON.stringify(input)}`, () => {
      if (expected === "fail") {
        const lines = failLines({ ...BASE, API_PORT: input });
        expect(lines).toHaveLength(1);
        expect(lines[0]).toStartWith("  - API_PORT: ");
      } else {
        expect(ok({ API_PORT: input }).API_PORT).toBe(expected);
      }
    });
    test(`MAIL_PORT ${JSON.stringify(input)}`, () => {
      if (expected === "fail") {
        const lines = failLines({ ...BASE, MAIL_PORT: input });
        expect(lines).toHaveLength(1);
        expect(lines[0]).toStartWith("  - MAIL_PORT: ");
      } else {
        const env = ok({ MAIL_PORT: input });
        expect(env.MAIL_PORT).toBe(expected);
        expect(env.mailPort).toBe(expected);
      }
    });
  }

  const concurrencyCases: Array<[string, number | "fail"]> = [
    ["1", 1],
    ["4", 4],
    ["8", 8],
    ["0", "fail"],
    ["9", "fail"],
    ["2.5", "fail"],
    ["many", "fail"],
  ];
  for (const [input, expected] of concurrencyCases) {
    test(`IMPORT_OCR_CONCURRENCY ${JSON.stringify(input)}`, () => {
      if (expected === "fail") {
        const lines = failLines({ ...BASE, IMPORT_OCR_CONCURRENCY: input });
        expect(lines).toHaveLength(1);
        expect(lines[0]).toStartWith("  - IMPORT_OCR_CONCURRENCY: ");
      } else {
        const env = ok({ IMPORT_OCR_CONCURRENCY: input });
        expect(env.IMPORT_OCR_CONCURRENCY).toBe(expected);
        expect(env.ocrConcurrency).toBe(expected);
      }
    });
  }
});

describe("parseEnv: the booleanish rule", () => {
  const VARIABLES = [
    "IMPORT_OCR_ENABLED",
    "IMPORT_PDF_ENABLED",
    "MAIL_TLS_INSECURE",
    "DEBUG_SQL",
    "IMPORT_ALLOW_PRIVATE_HOSTS",
    "TRUST_PROXY",
  ] as const;
  const CASES: Array<[string | undefined, boolean | undefined]> = [
    ["1", true],
    ["true", true],
    ["TRUE", true],
    ["True", true],
    ["0", false],
    ["false", false],
    ["yes", false],
    ["on", false],
    ["2", false],
    [" 1", false],
    ["", false],
    [undefined, undefined],
  ];
  for (const variable of VARIABLES) {
    for (const [input, expected] of CASES) {
      test(`${variable} ${JSON.stringify(input)} is ${String(expected)}`, () => {
        const env = ok(input === undefined ? {} : { [variable]: input });
        expect(env[variable]).toBe(expected);
      });
    }
  }

  test("trustProxy is true only for a truthy TRUST_PROXY", () => {
    expect(ok({ TRUST_PROXY: "1" }).trustProxy).toBe(true);
    expect(ok({ TRUST_PROXY: "true" }).trustProxy).toBe(true);
    expect(ok({ TRUST_PROXY: "no" }).trustProxy).toBe(false);
    expect(ok().trustProxy).toBe(false);
  });

  test("ocrImportEnabled follows IMPORT_OCR_ENABLED", () => {
    expect(ok({ IMPORT_OCR_ENABLED: "1" }).ocrImportEnabled).toBe(true);
    expect(ok({ IMPORT_OCR_ENABLED: "0" }).ocrImportEnabled).toBe(false);
    expect(ok().ocrImportEnabled).toBe(false);
  });

  test("pdfImportEnabled follows the OCR flag when unset, and an explicit value splits them", () => {
    expect(ok({ IMPORT_OCR_ENABLED: "1" }).pdfImportEnabled).toBe(true);
    expect(ok({ IMPORT_OCR_ENABLED: "1", IMPORT_PDF_ENABLED: "0" }).pdfImportEnabled).toBe(false);
    expect(ok({ IMPORT_OCR_ENABLED: "0", IMPORT_PDF_ENABLED: "1" }).pdfImportEnabled).toBe(true);
    expect(ok({ IMPORT_PDF_ENABLED: "1" }).pdfImportEnabled).toBe(true);
    expect(ok({ IMPORT_OCR_ENABLED: "0" }).pdfImportEnabled).toBe(false);
    expect(ok().pdfImportEnabled).toBe(false);
  });

  test("allowPrivateImportHosts is never true in production", () => {
    expect(ok({ IMPORT_ALLOW_PRIVATE_HOSTS: "1" }).allowPrivateImportHosts).toBe(true);
    expect(ok({ IMPORT_ALLOW_PRIVATE_HOSTS: "1", NODE_ENV: "test" }).allowPrivateImportHosts).toBe(true);
    expect(ok({ IMPORT_ALLOW_PRIVATE_HOSTS: "1", NODE_ENV: "production" }).allowPrivateImportHosts).toBe(
      false,
    );
    expect(ok({ IMPORT_ALLOW_PRIVATE_HOSTS: "0" }).allowPrivateImportHosts).toBe(false);
  });
});

describe("parseEnv: enums", () => {
  const ENUMS: Array<[string, string[]]> = [
    ["NODE_ENV", ["development", "production", "test"]],
    ["MAIL_TRANSPORT", ["console", "smtp", "resend"]],
    ["MAIL_SECURITY", ["starttls", "tls", "none"]],
    ["DEFAULT_LOCALE", ["de", "en"]],
  ];
  for (const [variable, values] of ENUMS) {
    test(`${variable} accepts ${values.join(", ")} and nothing else`, () => {
      for (const value of values) {
        // A real mail transport needs its companions, so the acceptance probe adds them.
        const extra: Source = {
          [variable]: value,
          MAIL_FROM: "a@b.c",
          MAIL_API_KEY: "key",
          MAIL_HOST: "smtp.example",
          // production would trip the placeholder rule only for a "change-me" secret
        };
        const result = parseEnv({ ...BASE, ...extra });
        expect(result.ok).toBe(true);
        if (result.ok) expect((result.env as Record<string, unknown>)[variable]).toBe(value);
      }
      for (const bad of ["", "nope", values[0]!.toUpperCase(), ` ${values[0]}`]) {
        const lines = failLines({ ...BASE, [variable]: bad });
        expect(lines).toHaveLength(1);
        expect(lines[0]).toStartWith(`  - ${variable}: `);
      }
    });
  }

  test("the defaults of NODE_ENV and DEFAULT_LOCALE are used only when the key is unset", () => {
    expect(ok().NODE_ENV).toBe("development");
    expect(ok({ NODE_ENV: undefined }).NODE_ENV).toBe("development");
    expect(ok({ DEFAULT_LOCALE: undefined }).DEFAULT_LOCALE).toBe("de");
    expect(ok({ DEFAULT_LOCALE: "en" }).defaultLocale).toBe("en");
  });

  test("NODE_ENV drives isProduction and isTest", () => {
    expect(ok({ NODE_ENV: "production" }).isProduction).toBe(true);
    expect(ok({ NODE_ENV: "production" }).isTest).toBe(false);
    expect(ok({ NODE_ENV: "test" }).isTest).toBe(true);
    expect(ok({ NODE_ENV: "test" }).isProduction).toBe(false);
  });
});

describe("parseEnv: derived fields", () => {
  test("webOrigins splits on commas, trims and drops empty entries", () => {
    expect(ok({ WEB_ORIGIN: "http://a" }).webOrigins).toEqual(["http://a"]);
    expect(ok({ WEB_ORIGIN: "http://a, http://b ,,  http://c" }).webOrigins).toEqual([
      "http://a",
      "http://b",
      "http://c",
    ]);
    expect(ok({ WEB_ORIGIN: " , " }).webOrigins).toEqual([]);
  });

  test("an empty WEB_ORIGIN is refused (min 1), an unset one defaults", () => {
    const lines = failLines({ ...BASE, WEB_ORIGIN: "" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toStartWith("  - WEB_ORIGIN: ");
    expect(ok({ WEB_ORIGIN: undefined }).webOrigins).toEqual(["http://localhost:5173"]);
  });

  const DATABASES: Array<[string, "file" | "remote", string]> = [
    ["file:./data/x.db", "file", `file:${resolve(REPO_ROOT, "./data/x.db")}`],
    ["file:data/y.db", "file", `file:${resolve(REPO_ROOT, "data/y.db")}`],
    ["file:/var/lib/app.db", "file", "file:/var/lib/app.db"],
    ["file::memory:", "file", "file::memory:"],
    ["file:", "file", "file:"],
    ["libsql://x.turso.io", "remote", "libsql://x.turso.io"],
    ["LIBSQL://X.TURSO.IO", "remote", "LIBSQL://X.TURSO.IO"],
    ["https://x.example/db", "remote", "https://x.example/db"],
    ["http://x.example/db", "remote", "http://x.example/db"],
    ["wss://x.example", "remote", "wss://x.example"],
    ["ws://x.example", "remote", "ws://x.example"],
    ["./relative.db", "file", "./relative.db"],
  ];
  for (const [url, kind, resolved] of DATABASES) {
    test(`DATABASE_URL ${url} is ${kind}`, () => {
      const env = ok({ DATABASE_URL: url, DATABASE_AUTH_TOKEN: "token" });
      expect(env.databaseKind).toBe(kind);
      expect(env.databaseUrl).toBe(resolved);
      expect(env.DATABASE_URL).toBe(url);
      expect(env.DATABASE_AUTH_TOKEN).toBe("token");
    });
  }

  test("uploadDir resolves against the repo root, an absolute path stays", () => {
    expect(ok({ UPLOAD_DIR: "uploads-x" }).uploadDir).toBe(resolve(REPO_ROOT, "uploads-x"));
    expect(ok({ UPLOAD_DIR: "/srv/uploads" }).uploadDir).toBe("/srv/uploads");
    expect(ok({ UPLOAD_DIR: "/srv/uploads" }).UPLOAD_DIR).toBe("/srv/uploads");
  });

  test("webDistDir is null when unset and resolved against the repo root otherwise", () => {
    expect(ok().webDistDir).toBeNull();
    expect(ok({ WEB_DIST_DIR: "./apps/web/dist" }).webDistDir).toBe(resolve(REPO_ROOT, "./apps/web/dist"));
    expect(ok({ WEB_DIST_DIR: "/app/apps/web/dist" }).webDistDir).toBe("/app/apps/web/dist");
  });

  const OAUTH: Array<[string, Source, boolean, boolean]> = [
    ["nothing", {}, false, false],
    ["google id only", { GOOGLE_CLIENT_ID: "g" }, false, false],
    ["google secret only", { GOOGLE_CLIENT_SECRET: "s" }, false, false],
    ["google both", { GOOGLE_CLIENT_ID: "g", GOOGLE_CLIENT_SECRET: "s" }, true, false],
    ["google empty strings", { GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "" }, false, false],
    ["google id empty", { GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "s" }, false, false],
    ["github id only", { GITHUB_CLIENT_ID: "g" }, false, false],
    ["github both", { GITHUB_CLIENT_ID: "g", GITHUB_CLIENT_SECRET: "s" }, false, true],
    [
      "both providers",
      { GOOGLE_CLIENT_ID: "g", GOOGLE_CLIENT_SECRET: "s", GITHUB_CLIENT_ID: "h", GITHUB_CLIENT_SECRET: "t" },
      true,
      true,
    ],
  ];
  for (const [name, extra, google, github] of OAUTH) {
    test(`OAuth flags: ${name}`, () => {
      const env = ok(extra);
      expect(env.googleOAuthConfigured).toBe(google);
      expect(env.githubOAuthConfigured).toBe(github);
    });
  }

  test("OAUTH_REDIRECT_BASE and PUBLIC_API_URL pass through", () => {
    const env = ok({ OAUTH_REDIRECT_BASE: "https://h.example", PUBLIC_API_URL: "" });
    expect(env.OAUTH_REDIRECT_BASE).toBe("https://h.example");
    expect(env.PUBLIC_API_URL).toBe("");
  });

  test("mail defaults come from the chosen security", () => {
    expect(ok({ MAIL_SECURITY: "tls" }).mailPort).toBe(465);
    expect(ok({ MAIL_SECURITY: "starttls" }).mailPort).toBe(587);
    expect(ok({ MAIL_SECURITY: "none" }).mailPort).toBe(587);
    expect(ok({ MAIL_SECURITY: "tls", MAIL_PORT: "2525" }).mailPort).toBe(2525);
    expect(ok({ MAIL_SECURITY: "tls" }).mailSecurity).toBe("tls");
    expect(ok({ MAIL_SECURITY: "none" }).mailSecurity).toBe("none");
    expect(ok().mailSecurity).toBe("starttls");
  });

  test("mailFrom defaults to the placeholder sender", () => {
    expect(ok({ MAIL_FROM: "Haushalt <h@example.org>" }).mailFrom).toBe("Haushalt <h@example.org>");
    expect(ok().mailFrom).toBe("Rezepte <noreply@localhost>");
  });

  test("mailTransport: console by default, forced to console under test, otherwise as asked", () => {
    expect(ok().mailTransport).toBe("console");
    expect(ok({ MAIL_TRANSPORT: "console" }).mailTransport).toBe("console");
    expect(ok({ NODE_ENV: "test", MAIL_TRANSPORT: "smtp" }).mailTransport).toBe("console");
    expect(ok({ NODE_ENV: "test", MAIL_TRANSPORT: "resend" }).mailTransport).toBe("console");
    expect(ok({ MAIL_TRANSPORT: "smtp", MAIL_HOST: "h", MAIL_FROM: "a@b.c" }).mailTransport).toBe("smtp");
    expect(ok({ MAIL_TRANSPORT: "resend", MAIL_API_KEY: "k", MAIL_FROM: "a@b.c" }).mailTransport).toBe(
      "resend",
    );
  });
});

describe("parseEnv: the two German minimum messages", () => {
  test("an empty DATABASE_URL names the example", () => {
    expect(failLines({ ...BASE, DATABASE_URL: "" })).toEqual([
      "  - DATABASE_URL: DATABASE_URL fehlt (z. B. file:./data/local.db)",
    ]);
  });

  test("a short SESSION_SECRET names the minimum", () => {
    expect(failLines({ ...BASE, SESSION_SECRET: "short" })).toEqual([
      "  - SESSION_SECRET: SESSION_SECRET muss mindestens 16 Zeichen haben",
    ]);
    expect(failLines({ ...BASE, SESSION_SECRET: "x".repeat(15) })).toEqual([
      "  - SESSION_SECRET: SESSION_SECRET muss mindestens 16 Zeichen haben",
    ]);
    expect(ok({ SESSION_SECRET: "x".repeat(16) }).SESSION_SECRET).toBe("x".repeat(16));
    expect(failLines({ ...BASE, SESSION_SECRET: "" })).toEqual([
      "  - SESSION_SECRET: SESSION_SECRET muss mindestens 16 Zeichen haben",
    ]);
  });

  test("both at once keep the field order", () => {
    expect(failLines({ DATABASE_URL: "", SESSION_SECRET: "short" })).toEqual([
      "  - DATABASE_URL: DATABASE_URL fehlt (z. B. file:./data/local.db)",
      "  - SESSION_SECRET: SESSION_SECRET muss mindestens 16 Zeichen haben",
    ]);
  });

  test("a missing (unset) variable fails on its own key, without the German text", () => {
    const lines = failLines({});
    expect(keys(lines)).toEqual(["DATABASE_URL", "SESSION_SECRET"]);
    expect(lines.join("\n")).not.toContain("fehlt");
    expect(lines.join("\n")).not.toContain("mindestens");
  });
});

describe("parseEnv: the failure line form", () => {
  test("a field issue is `  - KEY: message`, in schema field order", () => {
    const lines = failLines({
      ...BASE,
      MAIL_PORT: "0",
      IMPORT_OCR_CONCURRENCY: "9",
      API_PORT: "abc",
      NODE_ENV: "staging",
    });
    expect(keys(lines)).toEqual(["NODE_ENV", "API_PORT", "IMPORT_OCR_CONCURRENCY", "MAIL_PORT"]);
    for (const line of lines) expect(line).toMatch(/^ {2}- [A-Z_]+: .+/);
  });

  test("a root issue is `  - (env): message`", () => {
    const lines = failLines({ ...BASE, DATABASE_URL: "libsql://x.turso.io" });
    expect(lines).toEqual(["  - (env): DATABASE_AUTH_TOKEN is required for a remote libsql:// database"]);
  });

  test("a field issue stops the cross-field refinements", () => {
    const lines = failLines({ DATABASE_URL: "libsql://x.turso.io", SESSION_SECRET: "short" });
    expect(lines).toEqual(["  - SESSION_SECRET: SESSION_SECRET muss mindestens 16 Zeichen haben"]);
  });

  test("every failing result has at least one line and no env", () => {
    const result = parseEnv({});
    expect(result.ok).toBe(false);
    expect("env" in result).toBe(false);
  });
});

describe("parseEnv: the six refinements", () => {
  const PLACEHOLDER =
    "  - (env): SESSION_SECRET is still the .env.example placeholder — generate one: openssl rand -hex 32";
  const TOKEN = "  - (env): DATABASE_AUTH_TOKEN is required for a remote libsql:// database";
  const API_KEY = "  - (env): MAIL_API_KEY is required for MAIL_TRANSPORT=resend";
  const FROM = "  - (env): MAIL_FROM is required for a real MAIL_TRANSPORT (a verified sender domain)";
  const HOST =
    "  - (env): MAIL_HOST is required for MAIL_TRANSPORT=smtp (your mail provider's submission host)";
  const CREDENTIALS =
    "  - (env): MAIL_USER/MAIL_PASSWORD must not be combined with MAIL_SECURITY=none — the credentials would cross the network in cleartext (use MAIL_SECURITY=starttls or =tls)";

  test("1. the .env.example placeholder secret is refused in production only", () => {
    const placeholder = "change-me-to-a-32-byte-random-hex-string-0000000";
    expect(failLines({ ...BASE, NODE_ENV: "production", SESSION_SECRET: placeholder })).toEqual([PLACEHOLDER]);
    expect(
      failLines({ ...BASE, NODE_ENV: "production", SESSION_SECRET: "Change-Me-0123456789abcdef" }),
    ).toEqual([PLACEHOLDER]);
    expect(ok({ NODE_ENV: "development", SESSION_SECRET: placeholder }).SESSION_SECRET).toBe(placeholder);
    expect(ok({ NODE_ENV: "test", SESSION_SECRET: placeholder }).SESSION_SECRET).toBe(placeholder);
    expect(ok({ NODE_ENV: "production", SESSION_SECRET: "a-change-me-in-the-middle-0000" }).isProduction).toBe(
      true,
    );
    expect(ok({ NODE_ENV: "production", SESSION_SECRET: "0123456789abcdef0123456789abcdef" }).isProduction).toBe(
      true,
    );
  });

  test("2. a remote database needs DATABASE_AUTH_TOKEN", () => {
    for (const url of ["libsql://x.turso.io", "https://x.example", "wss://x.example"]) {
      expect(failLines({ ...BASE, DATABASE_URL: url })).toEqual([TOKEN]);
      expect(failLines({ ...BASE, DATABASE_URL: url, DATABASE_AUTH_TOKEN: "" })).toEqual([TOKEN]);
      expect(ok({ DATABASE_URL: url, DATABASE_AUTH_TOKEN: "t" }).databaseKind).toBe("remote");
    }
    expect(ok({ DATABASE_URL: "file:./x.db" }).databaseKind).toBe("file");
  });

  test("3. resend needs MAIL_API_KEY (and, as a real transport, MAIL_FROM)", () => {
    expect(failLines({ ...BASE, MAIL_TRANSPORT: "resend", MAIL_FROM: "a@b.c" })).toEqual([API_KEY]);
    expect(failLines({ ...BASE, MAIL_TRANSPORT: "resend", MAIL_FROM: "a@b.c", MAIL_API_KEY: "" })).toEqual([
      API_KEY,
    ]);
    expect(ok({ MAIL_TRANSPORT: "resend", MAIL_FROM: "a@b.c", MAIL_API_KEY: "k" }).mailTransport).toBe("resend");
  });

  test("4. a real transport needs MAIL_FROM", () => {
    expect(failLines({ ...BASE, MAIL_TRANSPORT: "smtp", MAIL_HOST: "h" })).toEqual([FROM]);
    expect(failLines({ ...BASE, MAIL_TRANSPORT: "smtp", MAIL_HOST: "h", MAIL_FROM: "" })).toEqual([FROM]);
    expect(ok({ MAIL_TRANSPORT: "smtp", MAIL_HOST: "h", MAIL_FROM: "a@b.c" }).mailFrom).toBe("a@b.c");
    // the console transport sends nothing and needs no sender
    expect(ok({ MAIL_TRANSPORT: "console" }).mailTransport).toBe("console");
  });

  test("5. smtp needs MAIL_HOST", () => {
    expect(failLines({ ...BASE, MAIL_TRANSPORT: "smtp", MAIL_FROM: "a@b.c" })).toEqual([HOST]);
    expect(failLines({ ...BASE, MAIL_TRANSPORT: "smtp", MAIL_FROM: "a@b.c", MAIL_HOST: "" })).toEqual([HOST]);
  });

  test("6. smtp with MAIL_SECURITY=none refuses credentials", () => {
    const smtp = { ...BASE, MAIL_TRANSPORT: "smtp", MAIL_HOST: "h", MAIL_FROM: "a@b.c" };
    expect(failLines({ ...smtp, MAIL_SECURITY: "none", MAIL_USER: "u" })).toEqual([CREDENTIALS]);
    expect(ok({ MAIL_TRANSPORT: "smtp", MAIL_HOST: "h", MAIL_FROM: "a@b.c", MAIL_SECURITY: "none" }).mailSecurity).toBe(
      "none",
    );
    expect(ok({ MAIL_TRANSPORT: "smtp", MAIL_HOST: "h", MAIL_FROM: "a@b.c", MAIL_SECURITY: "none", MAIL_USER: "" }).mailSecurity).toBe(
      "none",
    );
    expect(ok({ MAIL_TRANSPORT: "smtp", MAIL_HOST: "h", MAIL_FROM: "a@b.c", MAIL_SECURITY: "tls", MAIL_USER: "u" }).MAIL_USER).toBe(
      "u",
    );
    expect(ok({ MAIL_TRANSPORT: "smtp", MAIL_HOST: "h", MAIL_FROM: "a@b.c", MAIL_USER: "u" }).MAIL_USER).toBe("u");
    // the rule is about smtp: a forced-console env (test) never trips it
    expect(ok({ NODE_ENV: "test", MAIL_TRANSPORT: "smtp", MAIL_SECURITY: "none", MAIL_USER: "u" }).mailTransport).toBe(
      "console",
    );
  });

  test("several refinements report together, in declaration order", () => {
    expect(
      failLines({
        DATABASE_URL: "libsql://x.turso.io",
        SESSION_SECRET: "change-me-to-a-32-byte-random-hex-string-0000000",
        NODE_ENV: "production",
        MAIL_TRANSPORT: "smtp",
        MAIL_SECURITY: "none",
        MAIL_USER: "u",
      }),
    ).toEqual([PLACEHOLDER, TOKEN, FROM, HOST, CREDENTIALS]);
    expect(failLines({ ...BASE, MAIL_TRANSPORT: "resend" })).toEqual([API_KEY, FROM]);
  });
});
