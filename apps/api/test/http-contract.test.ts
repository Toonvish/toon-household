/**
 * The HTTP contract of the API, captured from the Hono app (docs/EFFECT.md E8; plan
 * `docs/plans/e7-http-api.md` P18, task E7-T01).
 *
 * A table of rows `{ id, method, path, as, headers, body, expect }` run through `app.request` over the
 * walkthrough of `docs/plans/m7-harden.md` section 9.3 plus the header rows of plan section 4. Every
 * expected value below is a literal CAPTURED from the running Hono app (2026-11-05, tree `16b104d82`),
 * never derived from the code under test. This file is the oracle the Effect server of E7-T11 must pass
 * UNCHANGED: a row that has to change there is a recorded deviation, not an edit.
 *
 * Reading the table
 *   - `path` and `message` are templates: `{hid}` and the like are filled from the fixtures built in
 *     `beforeAll` (users, households, cookies); the test name keeps the template, so it is stable.
 *   - `as` picks a session cookie; no `as` sends none. `headers` carry the rest (`Origin`, locale, ...).
 *   - `expect.headers`: a string is an exact value, `null` means the header is ABSENT, `true` means
 *     present with any value, `{ regex }` is a pattern for a value that carries a generated id, and
 *     `{ cookie }` is the attribute set of the one `Set-Cookie` header.
 *   - Rows of a section run in order: a few flip state on purpose (module disable/enable, a replayed
 *     mutation, a logout) and say so.
 *
 * Fixtures: the file builds its own users and households (no other test file's rows) on the shared test
 * DB, and restores every seam it flips (`setMailer`, `setVerifiedEmailRequired`, `setImportDbForTests`,
 * `setOcrEngine`, `setOcrImportEnabled`) in `afterAll`.
 *
 * Observations that differ from what `docs/API.md` or the plan expected (recorded, never "fixed" here):
 *   - the CORS headers (`Access-Control-Allow-Origin` = the first WEB_ORIGIN, `-Allow-Credentials`,
 *     `-Expose-Headers`, `Vary: Origin`) are sent on EVERY `/api/*` response, also without an `Origin`
 *     request header and also to a foreign `Origin` (the origin function falls back to `webOrigins[0]`);
 *     the foreign preflight is `204` with the same headers, so the browser, not the server, refuses it;
 *   - `/uploads/*` carries the security headers but no CORS headers (the cors middleware is `/api/*`);
 *   - `POST /api/households` with a malformed JSON body is Hono's own `400 bad_request`, message
 *     "Anfrage fehlgeschlagen" / "Request failed" (not a `server.auth.invalidJsonBody` text);
 *   - the register cookie's `Max-Age` is the session's remaining seconds (30 days minus a second or so).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { setVerifiedEmailRequired } from "../src/core/services/auth/verifiedEmail.ts";
import { ConsoleMailer, setMailer } from "../src/core/services/mail/index.ts";
import { createDatabase, db } from "../src/db/client.ts";
import { runMigrations } from "./support/bridges/migrate.ts";
import { householdMembers, households, users } from "../src/db/schema.ts";
import { env } from "../src/env.ts";
import { app } from "../src/index.ts";
import { setOcrImportEnabled } from "../src/modules/recipe/services/import/capabilities.ts";
import { setImportDbForTests } from "../src/modules/recipe/services/import/db.ts";
import { setOcrEngine } from "../src/modules/recipe/services/ocr/index.ts";
import { createFakeOcrEngine, makeTestPng } from "./import/helpers.ts";
import {
  addMember,
  createPlainHousehold,
  createUser,
  enableFinance,
  type TestUser,
} from "./support/finance-harness.ts";

/* ------------------------------------------------------------------------------------------------
 * The row model
 * ---------------------------------------------------------------------------------------------- */

type Ctx = Record<string, string>;

interface CookieExpectation {
  name: string;
  /** "set" = a non-empty value, "empty" = the clearing cookie. */
  value: "set" | "empty";
  /** Every attribute but `Max-Age`, in any order (so `Secure` absent is asserted by omission). */
  attributes: string[];
  /** Inclusive bounds of `Max-Age` in seconds. */
  maxAge: [number, number];
}

/** string = exact value; null = absent; true = present; regex / cookie = pattern. */
type Matcher = string | null | true | { regex: string } | { cookie: CookieExpectation };

interface Row {
  id: string;
  method: string;
  /** Template: `{hid}` etc. are resolved from the fixtures. */
  path: string;
  /** Fixture key of the user whose session cookie rides along (`owner`, `member`, ...). */
  as?: string;
  headers?: Record<string, string>;
  /** JSON body (a function reads the fixtures); sent with `Content-Type: application/json`. */
  body?: Record<string, unknown> | ((ctx: Ctx) => Record<string, unknown>);
  /** An exact raw body (malformed JSON, ...); `headers` carry its content type. */
  raw?: string;
  expect: {
    status: number;
    code?: string;
    /** Exact `error.message` (template). */
    message?: string;
    headers?: Record<string, Matcher>;
    /** The response body is the empty string. */
    empty?: boolean;
    /** Runs on the parsed JSON body. */
    check?: (json: any, ctx: Ctx) => void;
  };
}

const ctx: Ctx = {};
const cookies: Record<string, string> = {};

function fill(template: string): string {
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (_, key: string) => {
    const value = ctx[key];
    if (value === undefined) throw new Error(`no fixture "${key}" for template ${template}`);
    return value;
  });
}

function parseCookie(header: string | null): { name: string; value: string; attrs: string[]; maxAge: number } {
  if (header === null) throw new Error("expected a Set-Cookie header, got none");
  const [pair = "", ...rest] = header.split("; ");
  const eq = pair.indexOf("=");
  const attrs = rest.filter((part) => !part.startsWith("Max-Age="));
  const maxAge = rest.find((part) => part.startsWith("Max-Age="));
  return {
    name: pair.slice(0, eq),
    value: pair.slice(eq + 1),
    attrs,
    maxAge: maxAge === undefined ? Number.NaN : Number(maxAge.slice("Max-Age=".length)),
  };
}

function assertHeaders(response: Response, expected: Record<string, Matcher>, label: string): void {
  for (const [name, matcher] of Object.entries(expected)) {
    const actual = response.headers.get(name);
    const where = `${label}: header ${name}`;
    if (matcher === null) {
      expect(actual, `${where} must be absent`).toBeNull();
    } else if (matcher === true) {
      expect(actual, `${where} must be present`).not.toBeNull();
    } else if (typeof matcher === "string") {
      expect(actual, where).toBe(fill(matcher));
    } else if ("regex" in matcher) {
      expect(actual, `${where} must be present`).not.toBeNull();
      expect(actual ?? "", where).toMatch(new RegExp(fill(matcher.regex)));
    } else {
      const cookie = parseCookie(actual);
      expect(cookie.name, `${where} name`).toBe(matcher.cookie.name);
      if (matcher.cookie.value === "empty") expect(cookie.value, `${where} value`).toBe("");
      else expect(cookie.value.length, `${where} value`).toBeGreaterThan(0);
      expect([...cookie.attrs].sort(), `${where} attributes`).toEqual([...matcher.cookie.attributes].sort());
      expect(cookie.maxAge, `${where} Max-Age`).toBeGreaterThanOrEqual(matcher.cookie.maxAge[0]);
      expect(cookie.maxAge, `${where} Max-Age`).toBeLessThanOrEqual(matcher.cookie.maxAge[1]);
    }
  }
}

/** Sends one row through the app and asserts it; returns the response (body already read) and its JSON. */
async function runRow(row: Row): Promise<{ response: Response; json: any }> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(row.headers ?? {})) headers[name] = fill(value);
  if (row.as !== undefined) {
    const cookie = cookies[row.as];
    if (cookie === undefined) throw new Error(`no session for "${row.as}"`);
    headers.cookie = cookie;
  }
  let body: string | undefined;
  if (row.raw !== undefined) {
    body = row.raw;
  } else if (row.body !== undefined) {
    const value = typeof row.body === "function" ? row.body(ctx) : row.body;
    body = JSON.stringify(value);
    headers["content-type"] = "application/json";
  }
  const label = `${row.id} ${row.method} ${row.path}`;
  const response = await app.request(fill(row.path), { method: row.method, headers, body });
  const text = await response.text();
  expect(response.status, `${label}: status (body ${text.slice(0, 300)})`).toBe(row.expect.status);
  let json: any;
  try {
    json = text.length > 0 ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (row.expect.empty === true) expect(text, `${label}: body must be empty`).toBe("");
  if (row.expect.code !== undefined) expect(json?.error?.code, `${label}: error.code`).toBe(row.expect.code);
  if (row.expect.message !== undefined) {
    expect(json?.error?.message, `${label}: error.message`).toBe(fill(row.expect.message));
  }
  if (row.expect.headers !== undefined) assertHeaders(response, row.expect.headers, label);
  row.expect.check?.(json, ctx);
  return { response, json };
}

/** One `test` per row, named `<id> <METHOD> <path> -> <status>`. */
function defineRows(rows: Row[]): void {
  for (const row of rows) {
    test(`${row.id} ${row.method} ${row.path} -> ${row.expect.status}`, async () => {
      await runRow(row);
    });
  }
}

/* ------------------------------------------------------------------------------------------------
 * Literals captured from the Hono app
 * ---------------------------------------------------------------------------------------------- */

const ORIGIN = "http://localhost:5173";
const EVIL = "https://evil.example";

/** The COMPLETE security-header set of `middleware/securityHeaders.ts` (Hono `secureHeaders`), plus the absent ones. */
const SECURITY: Record<string, Matcher> = {
  "content-security-policy":
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob: https:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src blob:",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "cross-origin-resource-policy": "same-site",
  "cross-origin-opener-policy": "same-origin",
  "origin-agent-cluster": "?1",
  "x-dns-prefetch-control": "off",
  "x-download-options": "noopen",
  "x-permitted-cross-domain-policies": "none",
  "x-xss-protection": "0",
  "strict-transport-security": null,
  "permissions-policy": null,
  "x-powered-by": null,
};

/** The CORS headers of every non-preflight `/api/*` response. */
const CORS: Record<string, Matcher> = {
  "access-control-allow-origin": ORIGIN,
  "access-control-allow-credentials": "true",
  "access-control-expose-headers": "Content-Disposition,Location",
  vary: "Origin",
};

/** The CORS headers of a preflight `OPTIONS` (answered by the cors middleware with 204). */
const PREFLIGHT: Record<string, Matcher> = {
  "access-control-allow-origin": ORIGIN,
  "access-control-allow-credentials": "true",
  "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
  "access-control-allow-headers": "Content-Type,Authorization",
  "access-control-expose-headers": "Content-Disposition,Location",
  "access-control-max-age": "86400",
  vary: "Origin, Access-Control-Request-Headers",
  "content-type": null,
};

const JSON_CT = "application/json";
const PASSWORD = "geheimes-passwort-123";
const NO_ACCOUNT_CORS: Record<string, Matcher> = {
  "access-control-allow-origin": null,
  "access-control-allow-credentials": null,
  "access-control-expose-headers": null,
  vary: null,
};
const SESSION_COOKIE_SET: CookieExpectation = {
  name: "toon_session",
  value: "set",
  attributes: ["HttpOnly", "Path=/", "SameSite=Lax"],
  maxAge: [2_592_000 - 5, 2_592_000 + 5],
};
const SESSION_COOKIE_CLEARED: CookieExpectation = {
  name: "toon_session",
  value: "empty",
  attributes: ["HttpOnly", "Path=/", "SameSite=Lax"],
  maxAge: [0, 0],
};

const DE_INVALID_JSON = "Der Anfrage-Body ist kein gültiges JSON";
const EN_INVALID_JSON = "The request body is not valid JSON";
const DE_IMPORT_INVALID_JSON = "Der Request-Body ist kein gültiges JSON.";
const EN_IMPORT_INVALID_JSON = "The request body is not valid JSON.";
const DE_UNAUTHORIZED = "Nicht angemeldet";
const DE_ORIGIN = "Diese Anfrage kam nicht aus der App und wurde abgelehnt.";
const DE_NO_ACCESS = "Kein Zugriff auf diese Gruppe";
const DE_ADMIN_NEEDED = "Dafür brauchst du Administratorrechte in dieser Gruppe";
const DE_NOT_PARTICIPANT = "Du nimmst an der Haushaltskasse dieses Haushalts nicht teil.";
const DE_UNVERIFIED =
  "Bitte bestätige zuerst deine E-Mail-Adresse. Bis dahin kannst du nur mitlesen und Einladungen annehmen.";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/* ------------------------------------------------------------------------------------------------
 * Fixtures
 * ---------------------------------------------------------------------------------------------- */

interface FinanceHousehold {
  hid: string;
  partner: TestUser;
}

/** A household whose finance ledger is enabled: `owner` in slot 1, a hidden `partner` in slot 2, `member` plain. */
async function financeHousehold(owner: TestUser, member: TestUser, name: string): Promise<FinanceHousehold> {
  const hid = await createPlainHousehold(owner, name);
  const partner = await createUser("Partner");
  await addMember(owner, hid, partner);
  await addMember(owner, hid, member);
  const enabled = await enableFinance(owner, hid, owner, partner);
  expect(enabled.status).toBe(200);
  return { hid, partner };
}

let mailerInstalled = false;
let gateFlipped = false;

beforeAll(async () => {
  await runMigrations(db);
  // The register rows mail a confirmation link; keep it silent (restored in afterAll).
  setMailer(new ConsoleMailer(() => undefined));
  mailerInstalled = true;
  // The CORS and origin rows below are literals for exactly this configuration.
  expect(env.webOrigins).toEqual([ORIGIN]);

  const owner = await createUser("Owner");
  const member = await createUser("Member");
  const outsider = await createUser("Outsider");
  const logoutUser = await createUser("Logout");
  for (const [key, user] of Object.entries({ owner, member, outsider, logout: logoutUser })) {
    cookies[key] = user.cookie;
    ctx[`${key}Id`] = user.id;
  }
  ctx.ownerEmail = owner.email;

  const main = await financeHousehold(owner, member, "Vertrag");
  ctx.hid = main.hid;
  ctx.partnerId = main.partner.id;
  ctx.ohid = (await financeHousehold(owner, member, "Vertrag Herkunft")).hid;
  const modules = await financeHousehold(owner, member, "Vertrag Module");
  ctx.mhid = modules.hid;
  ctx.mpartnerId = modules.partner.id;
  ctx.fhid = (await financeHousehold(owner, member, "Vertrag Finanzen")).hid;
  ctx.unknownId = crypto.randomUUID();
  ctx.unknownId2 = crypto.randomUUID();
  ctx.regEmail = `contract-${crypto.randomUUID().slice(0, 8)}@example.com`;

  // An UNCONFIRMED account with its own household, made while the verified-e-mail gate is off (row 13).
  const unconfirmed = await createUser("Unconfirmed");
  await db.update(users).set({ emailVerified: false, emailVerifiedAt: null }).where(eq(users.id, unconfirmed.id));
  cookies.unconfirmed = unconfirmed.cookie;
  ctx.unconfirmedId = unconfirmed.id;
  ctx.uhid = await createPlainHousehold(unconfirmed, "Unbestätigt");
});

afterAll(() => {
  if (gateFlipped) setVerifiedEmailRequired(null);
  if (mailerInstalled) setMailer(null);
});

/* ------------------------------------------------------------------------------------------------
 * 1 Health
 * ---------------------------------------------------------------------------------------------- */

describe("1 health", () => {
  defineRows([
    { id: "1a", method: "GET", path: "/api/health", expect: { status: 200, headers: { "content-type": JSON_CT } } },
    {
      id: "1b",
      method: "HEAD",
      path: "/api/health",
      expect: { status: 200, empty: true, headers: { "content-type": JSON_CT } },
    },
  ]);

  test("1c GET /api/health -> 200 body keys in order", async () => {
    const { json } = await runRow({ id: "1c", method: "GET", path: "/api/health", expect: { status: 200 } });
    expect(Object.keys(json)).toEqual(["ok", "status", "version", "time", "database", "modules", "features"]);
    expect(json.ok).toBe(true);
    expect(json.status).toBe("ok");
    expect(json.database).toBe("file");
    expect(json.modules).toEqual(["recipe", "finance"]);
    expect(Object.keys(json.features)).toEqual(["verifiedEmailRequired", "ocrImport", "pdfImport"]);
  });
});

/* ------------------------------------------------------------------------------------------------
 * 2 Security headers
 * ---------------------------------------------------------------------------------------------- */

describe("2 security headers", () => {
  defineRows([
    { id: "2a", method: "GET", path: "/api/health", expect: { status: 200, headers: SECURITY } },
    { id: "2b", method: "GET", path: "/api/nope", expect: { status: 404, code: "not_found", headers: SECURITY } },
    {
      id: "2c",
      method: "OPTIONS",
      path: "/api/auth/login",
      headers: { origin: ORIGIN, "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
      expect: { status: 204, empty: true, headers: SECURITY },
    },
  ]);
});

/* ------------------------------------------------------------------------------------------------
 * 3 CORS (also on error responses: the dev web app at :5173 reads a 401 and a 422 because of these)
 * ---------------------------------------------------------------------------------------------- */

describe("3 cors", () => {
  const trusted = { origin: ORIGIN };
  defineRows([
    {
      id: "3a",
      method: "OPTIONS",
      path: "/api/auth/login",
      headers: { origin: ORIGIN, "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
      expect: { status: 204, empty: true, headers: { ...PREFLIGHT, ...SECURITY } },
    },
    {
      id: "3b",
      method: "OPTIONS",
      path: "/api/auth/login",
      headers: { origin: EVIL, "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
      // The server answers a foreign preflight with the TRUSTED origin; the browser then refuses it.
      expect: { status: 204, empty: true, headers: { ...PREFLIGHT, ...SECURITY } },
    },
    {
      id: "3c",
      method: "GET",
      path: "/api/health",
      headers: trusted,
      expect: { status: 200, headers: { ...CORS, ...SECURITY, "access-control-allow-methods": null, "access-control-max-age": null } },
    },
    {
      id: "3d",
      method: "GET",
      path: "/api/auth/me",
      headers: trusted,
      expect: { status: 401, code: "unauthorized", message: DE_UNAUTHORIZED, headers: { ...CORS, ...SECURITY } },
    },
    {
      id: "3e",
      method: "POST",
      path: "/api/households",
      as: "owner",
      headers: trusted,
      body: {},
      expect: {
        status: 422,
        code: "validation_failed",
        message: "Eingabe ist ungültig",
        headers: { ...CORS, ...SECURITY },
      },
    },
    {
      id: "3f",
      method: "GET",
      path: "/api/households/{hid}/recipe/nope",
      headers: trusted,
      expect: { status: 401, code: "unauthorized", message: DE_UNAUTHORIZED, headers: { ...CORS, ...SECURITY } },
    },
    {
      id: "3g",
      method: "POST",
      path: "/api/households/{fhid}/finance/transactions",
      as: "owner",
      headers: { origin: EVIL },
      body: { kind: "MINE_SPLIT", amountCents: 100, description: "Fremd" },
      expect: { status: 403, code: "forbidden", message: DE_ORIGIN, headers: { ...CORS, ...SECURITY } },
    },
  ]);
});

/* ------------------------------------------------------------------------------------------------
 * 4 Origin guard
 * ---------------------------------------------------------------------------------------------- */

describe("4 origin guard", () => {
  const booking = { kind: "MINE_SPLIT", amountCents: 100, description: "Herkunft" };
  defineRows([
    {
      id: "4a",
      method: "POST",
      path: "/api/households/{ohid}/finance/transactions",
      as: "owner",
      headers: { origin: EVIL },
      body: booking,
      expect: { status: 403, code: "forbidden", message: DE_ORIGIN },
    },
    {
      id: "4b",
      method: "POST",
      path: "/api/households/{ohid}/finance/transactions",
      as: "owner",
      headers: { "sec-fetch-site": "cross-site" },
      body: booking,
      expect: { status: 403, code: "forbidden", message: DE_ORIGIN },
    },
    {
      id: "4c",
      method: "POST",
      path: "/api/households/{ohid}/finance/transactions",
      as: "owner",
      headers: { origin: ORIGIN },
      body: booking,
      expect: {
        status: 201,
        headers: { location: { regex: `^/api/households/{ohid}/finance/transactions/${UUID}$` } },
      },
    },
  ]);
});

/* ------------------------------------------------------------------------------------------------
 * 5 Auth
 * ---------------------------------------------------------------------------------------------- */

describe("5 auth", () => {
  // In order: the account registered in 5a is the one 5b and 5c log into.
  defineRows([
    {
      id: "5a",
      method: "POST",
      path: "/api/auth/register",
      body: (c) => ({ email: c.regEmail, name: "Registriert", password: PASSWORD }),
      expect: { status: 201, headers: { "set-cookie": { cookie: SESSION_COOKIE_SET }, "content-type": JSON_CT } },
    },
    {
      id: "5b",
      method: "POST",
      path: "/api/auth/login",
      body: (c) => ({ email: c.regEmail, password: PASSWORD }),
      expect: { status: 200, headers: { "set-cookie": { cookie: SESSION_COOKIE_SET } } },
    },
    {
      id: "5c",
      method: "POST",
      path: "/api/auth/login",
      body: (c) => ({ email: c.regEmail, password: "falsch-falsch-123" }),
      expect: {
        status: 401,
        code: "invalid_credentials",
        message: "E-Mail oder Passwort ist falsch",
        headers: { "set-cookie": null },
      },
    },
    {
      id: "5d",
      method: "POST",
      path: "/api/auth/login",
      headers: { "content-type": "text/plain" },
      raw: JSON.stringify({ email: "x@example.com", password: PASSWORD }),
      expect: { status: 400, code: "bad_request", message: DE_INVALID_JSON },
    },
    {
      id: "5e",
      method: "POST",
      path: "/api/auth/login",
      headers: { "content-type": "application/json" },
      raw: "{nope",
      expect: { status: 400, code: "bad_request", message: DE_INVALID_JSON },
    },
    {
      id: "5f",
      method: "POST",
      path: "/api/auth/login",
      headers: { "content-type": "application/json", "accept-language": "en" },
      raw: "{nope",
      expect: { status: 400, code: "bad_request", message: EN_INVALID_JSON },
    },
    {
      id: "5g",
      method: "GET",
      path: "/api/auth/me",
      as: "owner",
      expect: {
        status: 200,
        check: (json, c) => {
          expect(json.user.id).toBe(c.ownerId);
          expect(Object.keys(json)).toEqual(["user", "households", "activeHouseholdId"]);
        },
      },
    },
    {
      id: "5h",
      method: "GET",
      path: "/api/auth/me",
      expect: {
        status: 401,
        code: "unauthorized",
        message: DE_UNAUTHORIZED,
        headers: { "set-cookie": null },
      },
    },
    {
      id: "5i",
      method: "GET",
      path: "/api/auth/me",
      headers: { cookie: "toon_session=deadbeef" },
      expect: {
        status: 401,
        code: "unauthorized",
        message: DE_UNAUTHORIZED,
        headers: { "set-cookie": { cookie: SESSION_COOKIE_CLEARED } },
      },
    },
    {
      id: "5j",
      method: "GET",
      path: "/api/auth/sessions",
      as: "owner",
      expect: {
        status: 200,
        check: (json) => {
          expect(json.items.length).toBeGreaterThanOrEqual(1);
          expect(json.items.filter((item: { current: boolean }) => item.current)).toHaveLength(1);
        },
      },
    },
    {
      id: "5k",
      method: "POST",
      path: "/api/auth/logout",
      as: "logout",
      expect: { status: 204, empty: true, headers: { "set-cookie": { cookie: SESSION_COOKIE_CLEARED } } },
    },
  ]);
});

/* ------------------------------------------------------------------------------------------------
 * 6 Households
 * ---------------------------------------------------------------------------------------------- */

describe("6 households", () => {
  defineRows([
    {
      id: "6a",
      method: "GET",
      path: "/api/households",
      as: "member",
      expect: {
        status: 200,
        check: (json, c) => {
          expect(json.items.some((item: { id: string }) => item.id === c.hid)).toBe(true);
        },
      },
    },
    {
      id: "6b",
      method: "GET",
      path: "/api/households/{hid}",
      as: "member",
      expect: {
        status: 200,
        check: (json, c) => {
          expect(json.household.id).toBe(c.hid);
          expect(json.household.role).toBe("member");
          expect(Object.keys(json)).toEqual(["household", "members"]);
        },
      },
    },
    {
      id: "6c",
      method: "GET",
      path: "/api/households/{unknownId}",
      as: "member",
      expect: { status: 404, code: "not_found", message: "Gruppe nicht gefunden" },
    },
    {
      id: "6d",
      method: "GET",
      path: "/api/households/{hid}",
      as: "outsider",
      expect: { status: 403, code: "forbidden", message: DE_NO_ACCESS },
    },
    {
      id: "6e",
      method: "POST",
      path: "/api/households",
      as: "owner",
      body: { name: "Neu angelegt" },
      expect: { status: 201, headers: { location: { regex: `^/api/households/${UUID}$` } } },
    },
    {
      id: "6f",
      method: "POST",
      path: "/api/households",
      as: "owner",
      headers: { "content-type": "text/plain" },
      raw: JSON.stringify({ name: "Neu angelegt" }),
      // The schema saw `{}`: a text/plain body is not parsed as JSON.
      expect: {
        status: 422,
        code: "validation_failed",
        message: "Eingabe ist ungültig",
        check: (json) => {
          expect(json.error.details).toEqual([
            {
              path: "name",
              code: "invalid_type",
              message: "Ungültiger Wert",
              i18n: { key: "server.zod.invalid_type", values: { field: "name", facet: "string" } },
            },
          ]);
        },
      },
    },
    {
      id: "6g",
      method: "POST",
      path: "/api/households",
      as: "owner",
      headers: { "content-type": "application/json" },
      raw: "{nope",
      // Hono's own 400, not a server.auth.invalidJsonBody text.
      expect: { status: 400, code: "bad_request", message: "Anfrage fehlgeschlagen" },
    },
    {
      id: "6h",
      method: "POST",
      path: "/api/households",
      as: "owner",
      headers: { "content-type": "application/json", "accept-language": "en" },
      raw: "{nope",
      expect: { status: 400, code: "bad_request", message: "Request failed" },
    },
  ]);
});

/* ------------------------------------------------------------------------------------------------
 * 7 Members and invites
 * ---------------------------------------------------------------------------------------------- */

describe("7 members and invites", () => {
  defineRows([
    {
      id: "7a",
      method: "GET",
      path: "/api/households/{hid}/members",
      as: "member",
      expect: {
        status: 200,
        check: (json) => {
          expect(json.items.length).toBeGreaterThanOrEqual(3);
        },
      },
    },
    { id: "7b", method: "GET", path: "/api/households/{hid}/invites", as: "owner", expect: { status: 200 } },
    {
      id: "7c",
      method: "GET",
      path: "/api/households/{hid}/invites",
      as: "member",
      expect: { status: 403, code: "forbidden", message: DE_ADMIN_NEEDED },
    },
    {
      id: "7d",
      method: "GET",
      path: "/api/households/invites/nope",
      expect: { status: 404, code: "not_found", message: "Diese Einladung ist ungültig" },
    },
    {
      id: "7e",
      method: "POST",
      path: "/api/households/{hid}/members",
      as: "owner",
      body: { displayName: "Oma" },
      expect: {
        status: 201,
        headers: { location: { regex: `^/api/households/{hid}/members/${UUID}$` } },
        check: (json) => {
          expect(json.member.hasAccount).toBe(false);
          expect(json.member.user.name).toBe("Oma");
          expect(json.member.user.email).toBeNull();
        },
      },
    },
  ]);
});

/* ------------------------------------------------------------------------------------------------
 * 8 Modules (a household of its own: the rows flip the finance module off and on again, in order)
 * ---------------------------------------------------------------------------------------------- */

describe("8 modules", () => {
  defineRows([
    {
      id: "8a",
      method: "DELETE",
      path: "/api/households/{mhid}/modules/finance",
      as: "owner",
      expect: { status: 204, empty: true, headers: { "content-type": null } },
    },
    {
      id: "8b",
      method: "DELETE",
      path: "/api/households/{mhid}/modules/finance",
      as: "owner",
      expect: { status: 204, empty: true },
    },
    {
      id: "8c",
      method: "GET",
      path: "/api/households/{mhid}/finance/balance",
      as: "owner",
      expect: {
        status: 404,
        code: "module_disabled",
        message: "Dieses Modul ist für diesen Haushalt nicht aktiviert.",
      },
    },
    {
      id: "8d",
      method: "POST",
      path: "/api/households/{mhid}/modules/finance",
      as: "member",
      body: {},
      expect: { status: 403, code: "forbidden", message: DE_ADMIN_NEEDED },
    },
    {
      id: "8e",
      method: "POST",
      path: "/api/households/{mhid}/modules/finance",
      as: "owner",
      body: (c) => ({
        settings: {
          participants: [
            { userId: c.ownerId, memberSlot: 1 },
            { userId: c.mpartnerId, memberSlot: 2 },
          ],
        },
      }),
      expect: {
        status: 200,
        check: (json) => {
          expect(json.household.modules).toContain("finance");
        },
      },
    },
    {
      id: "8f",
      method: "GET",
      path: "/api/households/{mhid}/finance/balance",
      as: "owner",
      expect: { status: 200 },
    },
  ]);
});

/* ------------------------------------------------------------------------------------------------
 * 9 Uploads
 * ---------------------------------------------------------------------------------------------- */

describe("9 uploads", () => {
  defineRows([
    {
      id: "9a",
      method: "GET",
      path: "/uploads/nope.jpg",
      expect: {
        status: 404,
        code: "not_found",
        message: "Route GET /uploads/nope.jpg existiert nicht",
        headers: { "content-type": JSON_CT, ...SECURITY, ...NO_ACCOUNT_CORS },
      },
    },
    {
      id: "9b",
      method: "HEAD",
      path: "/uploads/nope.jpg",
      expect: { status: 404, empty: true, headers: { ...SECURITY, ...NO_ACCOUNT_CORS } },
    },
  ]);
});

/* ------------------------------------------------------------------------------------------------
 * 10 Recipe
 * ---------------------------------------------------------------------------------------------- */

describe("10 recipe", () => {
  defineRows([
    {
      id: "10a",
      method: "GET",
      path: "/api/households/{hid}/recipe/recipes?limit=1",
      as: "member",
      expect: {
        status: 200,
        check: (json) => {
          expect(json.limit).toBe(1);
          expect(Array.isArray(json.items)).toBe(true);
        },
      },
    },
    { id: "10b", method: "GET", path: "/api/households/{hid}/recipe/shopping-lists", as: "member", expect: { status: 200 } },
    { id: "10c", method: "GET", path: "/api/recipe/cards", as: "member", expect: { status: 200 } },
    {
      id: "10d",
      method: "GET",
      path: "/api/recipe/cards",
      expect: { status: 401, code: "unauthorized", message: DE_UNAUTHORIZED },
    },
    {
      id: "10f",
      method: "POST",
      path: "/api/recipe/cards",
      as: "member",
      headers: { "content-type": "application/json" },
      raw: "{nope",
      expect: { status: 400, code: "bad_request", message: DE_INVALID_JSON },
    },
    {
      id: "10g",
      method: "POST",
      path: "/api/recipe/cards",
      as: "member",
      headers: { "content-type": "application/json", "accept-language": "en" },
      raw: "{nope",
      expect: { status: 400, code: "bad_request", message: EN_INVALID_JSON },
    },
    {
      id: "10h",
      method: "POST",
      path: "/api/households/{hid}/recipe/imports/text",
      as: "member",
      headers: { "content-type": "application/json" },
      raw: "{nope",
      expect: { status: 400, code: "bad_request", message: DE_IMPORT_INVALID_JSON },
    },
    {
      id: "10i",
      method: "POST",
      path: "/api/households/{hid}/recipe/imports/text",
      as: "member",
      headers: { "content-type": "application/json", "accept-language": "en" },
      raw: "{nope",
      expect: { status: 400, code: "bad_request", message: EN_IMPORT_INVALID_JSON },
    },
    // The two `keepOnlySentKeys(…, c.req.json(), …)` routes: a text/plain empty body passes the
    // validator as `{}`, then `c.req.json()` throws, a defect of `Effect.promise`: 500, not 400.
    {
      id: "10j",
      method: "PATCH",
      path: "/api/households/{hid}/recipe/recipes/{unknownId}",
      as: "member",
      headers: { "content-type": "text/plain" },
      expect: { status: 500, code: "internal_error", message: "Interner Serverfehler" },
    },
    {
      id: "10k",
      method: "PATCH",
      path: "/api/households/{hid}/recipe/collections/{unknownId}",
      as: "member",
      headers: { "content-type": "text/plain" },
      expect: { status: 500, code: "internal_error", message: "Interner Serverfehler" },
    },
    // P14: the module catch-alls must not shadow HEAD -> GET.
    {
      id: "10l",
      method: "HEAD",
      path: "/api/households/{hid}/recipe/shopping-lists",
      as: "member",
      expect: { status: 200, empty: true, headers: { "content-type": JSON_CT } },
    },
  ]);

  describe("10e import source", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "toon-contract-"));
    const { client, db: importDb } = createDatabase({ url: `file:${join(tempDir, "import.db")}` });
    let storedFile: string | null = null;
    let seamsFlipped = false;

    beforeAll(async () => {
      await runMigrations(importDb);
      // The import routes write to their own file DB (a transaction); it needs the FK targets.
      await importDb.insert(users).values({
        id: ctx.ownerId as string,
        email: `contract-import-${ctx.ownerId}@toon.test`,
        name: "Owner",
        emailVerifiedAt: Date.now(),
      });
      await importDb.insert(households).values({ id: ctx.hid as string, name: "Vertrag", createdBy: ctx.ownerId as string });
      await importDb
        .insert(householdMembers)
        .values({ id: crypto.randomUUID(), householdId: ctx.hid as string, userId: ctx.ownerId as string, role: "owner" });
      seamsFlipped = true;
      setImportDbForTests(importDb);
      setOcrImportEnabled(true);
    });

    afterAll(() => {
      if (seamsFlipped) {
        setImportDbForTests(null);
        setOcrEngine(null);
        setOcrImportEnabled(null);
      }
      client.close();
      rmSync(tempDir, { recursive: true, force: true });
      if (storedFile !== null) rmSync(join(env.uploadDir, storedFile), { force: true });
    });

    test(
      "10e GET /api/households/{hid}/recipe/imports/{draftId}/source -> 200",
      async () => {
        setOcrEngine(createFakeOcrEngine({ text: "Titel\nZutaten\n100 g Mehl\n2 Eier\nZubereitung\n1. Verruehren." }));
        const form = new FormData();
        form.append("file", new Blob([await makeTestPng(300, 200)], { type: "image/png" }), "quelle.png");
        const created = await app.request(`/api/households/${ctx.hid}/recipe/imports/image`, {
          method: "POST",
          headers: { cookie: cookies.owner as string },
          body: form,
        });
        expect(created.status).toBe(201);
        const draft = ((await created.json()) as { draft: { id: string; sourceMeta: { storedPath: string } } }).draft;
        storedFile = draft.sourceMeta.storedPath;
        ctx.draftId = draft.id;
        ctx.storedPath = draft.sourceMeta.storedPath;

        await runRow({
          id: "10e",
          method: "GET",
          path: "/api/households/{hid}/recipe/imports/{draftId}/source",
          as: "owner",
          expect: {
            status: 200,
            headers: {
              "content-type": "image/png",
              "cache-control": "private, max-age=3600",
              "content-disposition": 'inline; filename="{storedPath}"',
              ...SECURITY,
              ...CORS,
            },
          },
        });
        // A non-member of the household: the module chain refuses before the handler.
        await runRow({
          id: "10e2",
          method: "GET",
          path: "/api/households/{hid}/recipe/imports/{draftId}/source",
          as: "outsider",
          expect: { status: 403, code: "forbidden", message: DE_NO_ACCESS },
        });
      },
      60_000,
    );
  });
});

/* ------------------------------------------------------------------------------------------------
 * 11 Finance
 * ---------------------------------------------------------------------------------------------- */

describe("11 finance", () => {
  const mutationId = crypto.randomUUID();
  const booking = { kind: "MINE_SPLIT", amountCents: 1234, description: "Vertrag", mutationId };
  let firstId = "";

  // In order: 11e books, 11f replays the same mutation, 11h settles against the balance 11e left (617 ct).
  defineRows([
    {
      id: "11a",
      method: "GET",
      path: "/api/households/{fhid}/finance/balance",
      as: "owner",
      expect: {
        status: 200,
        check: (json, c) => {
          expect(json.balanceCents).toBe(0);
          expect(json.viewerUserId).toBe(c.ownerId);
        },
      },
    },
    {
      id: "11b",
      method: "GET",
      path: "/api/households/{fhid}/finance/balance",
      as: "member",
      expect: { status: 403, code: "finance_not_participant", message: DE_NOT_PARTICIPANT },
    },
    {
      id: "11c",
      method: "GET",
      path: "/api/households/{fhid}/finance/transactions",
      as: "member",
      expect: { status: 403, code: "finance_not_participant", message: DE_NOT_PARTICIPANT },
    },
    {
      id: "11d",
      method: "GET",
      path: "/api/households/{fhid}/finance/participants",
      as: "member",
      expect: {
        status: 200,
        check: (json) => {
          expect(json.items.map((item: { memberSlot: number }) => item.memberSlot)).toEqual([1, 2]);
        },
      },
    },
    {
      id: "11e",
      method: "POST",
      path: "/api/households/{fhid}/finance/transactions",
      as: "owner",
      body: booking,
      expect: {
        status: 201,
        headers: { location: { regex: `^/api/households/{fhid}/finance/transactions/${UUID}$` } },
        check: (json) => {
          firstId = json.id;
          expect(json.amountCents).toBe(1234);
          expect(json.splitMode).toBe("SPLIT_EQUAL");
        },
      },
    },
    {
      id: "11f",
      method: "POST",
      path: "/api/households/{fhid}/finance/transactions",
      as: "owner",
      body: booking,
      // A replayed mutation id applies nothing and answers 200 with the SAME row.
      expect: {
        status: 200,
        headers: { location: null },
        check: (json) => {
          expect(json.id).toBe(firstId);
          expect(json.amountCents).toBe(1234);
        },
      },
    },
    {
      id: "11g",
      method: "POST",
      path: "/api/households/{fhid}/finance/transactions",
      as: "owner",
      body: { kind: "MINE_SPLIT", amountCents: 0, description: "Null" },
      expect: { status: 422, code: "transaction_amount_zero", message: "Der Betrag darf nicht 0 sein." },
    },
    {
      id: "11h",
      method: "POST",
      path: "/api/households/{fhid}/finance/settlements",
      as: "owner",
      body: { expectedBalanceCents: 0 },
      expect: {
        status: 409,
        code: "balance_stale",
        message: "Der Saldo hat sich geändert. Er steht jetzt bei 6,17\u00a0€.",
        check: (json) => {
          expect(json.error.details).toEqual({ currentBalanceCents: 617 });
        },
      },
    },
  ]);
});

/* ------------------------------------------------------------------------------------------------
 * 12 Unknown routes (the 401 -> 403 -> 404 order of the module chain)
 * ---------------------------------------------------------------------------------------------- */

describe("12 unknown routes", () => {
  defineRows([
    {
      id: "12a",
      method: "GET",
      path: "/api/nope",
      expect: { status: 404, code: "not_found", message: "Route GET /api/nope existiert nicht" },
    },
    {
      id: "12b",
      method: "GET",
      path: "/api/households/{hid}/recipe/nope",
      expect: { status: 401, code: "unauthorized", message: DE_UNAUTHORIZED },
    },
    {
      id: "12c",
      method: "GET",
      path: "/api/households/{hid}/recipe/nope",
      as: "outsider",
      expect: { status: 403, code: "forbidden", message: DE_NO_ACCESS },
    },
    {
      id: "12d",
      method: "GET",
      path: "/api/households/{hid}/recipe/nope",
      as: "member",
      expect: {
        status: 404,
        code: "not_found",
        message: "Route GET /api/households/{hid}/recipe/nope existiert nicht",
      },
    },
    {
      id: "12e",
      method: "PUT",
      path: "/api/households/{hid}/recipe/recipes",
      as: "member",
      expect: {
        status: 404,
        code: "not_found",
        message: "Route PUT /api/households/{hid}/recipe/recipes existiert nicht",
      },
    },
  ]);
});

/* ------------------------------------------------------------------------------------------------
 * 13 The verified-e-mail gate (the seam is handed back in afterAll)
 * ---------------------------------------------------------------------------------------------- */

describe("13 verified-email gate", () => {
  beforeAll(() => {
    gateFlipped = true;
    setVerifiedEmailRequired(true);
  });
  afterAll(() => {
    setVerifiedEmailRequired(null);
    gateFlipped = false;
  });

  defineRows([
    {
      id: "13a",
      method: "POST",
      path: "/api/households/{uhid}/recipe/recipes",
      as: "unconfirmed",
      expect: { status: 403, code: "email_unverified", message: DE_UNVERIFIED },
    },
    {
      id: "13b",
      method: "GET",
      path: "/api/households/{uhid}/recipe/recipes",
      as: "unconfirmed",
      expect: {
        status: 200,
        check: (json) => {
          expect(json).toEqual({ items: [], total: 0, limit: 24, offset: 0 });
        },
      },
    },
  ]);
});

/* ------------------------------------------------------------------------------------------------
 * 14 Query semantics: a repeated key arrives as an ARRAY, which a scalar query schema refuses (422);
 * nothing is first-wins or last-wins.
 * ---------------------------------------------------------------------------------------------- */

describe("14 query semantics", () => {
  defineRows([
    {
      id: "14a",
      method: "GET",
      path: "/api/households/{hid}/recipe/recipes?limit=1&limit=2",
      as: "member",
      expect: {
        status: 422,
        code: "validation_failed",
        check: (json) => {
          expect(json.error.details).toEqual([
            {
              path: "limit",
              code: "invalid_type",
              message: "Ungültiger Wert",
              i18n: { key: "server.zod.invalid_type", values: { field: "limit", facet: "number" } },
            },
          ]);
        },
      },
    },
    {
      id: "14b",
      method: "GET",
      path: "/api/households/{hid}/recipe/recipes?q=a&q=b",
      as: "member",
      expect: {
        status: 422,
        code: "validation_failed",
        check: (json) => {
          expect(json.error.details).toEqual([
            {
              path: "q",
              code: "invalid_type",
              message: "Ungültiger Wert",
              i18n: { key: "server.zod.invalid_type", values: { field: "q", facet: "string" } },
            },
          ]);
        },
      },
    },
    {
      id: "14c",
      method: "GET",
      path: "/api/households/{fhid}/finance/transactions?kind=MINE_SPLIT&kind=TRANSFER",
      as: "owner",
      expect: {
        status: 422,
        code: "validation_failed",
        check: (json) => {
          expect(json.error.details).toEqual([
            {
              path: "kind",
              code: "invalid_value",
              message: "Eingabe ist ungültig",
              i18n: { key: "server.zod.fallback", values: { field: "kind", facet: "_" } },
            },
          ]);
        },
      },
    },
  ]);
});
