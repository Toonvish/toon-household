/**
 * The error family and the one boundary mapper (`apps/api/src/lib/errors.ts`, docs/EFFECT.md E6, plan e2 P4).
 *
 * Every body below is a LITERAL equal to what `ApiError.x(...).toBody(locale)` and `onErrorHandler` returned at
 * `6991769c9`, before the family existed (computed from that code, then pasted): a tagged class and the legacy helper
 * it replaces render byte-identically, in both locales. The constructor shapes today's module code passes never throw,
 * every family member is `instanceof ApiError`, and `DatabaseError` is outside the family.
 */
import type { Locale } from "@toon/shared";
import { ALL_ISSUES, serverText } from "@toon/shared";
import { afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { Effect, Schema } from "effect";
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import {
  ApiError,
  type ApiErrorFamily,
  ApiFailure,
  BadRequest,
  Conflict,
  DatabaseError,
  Forbidden,
  Internal,
  InvalidCredentials,
  NotFound,
  PayloadTooLarge,
  RateLimited,
  UnsupportedMediaType,
  Unauthorized,
  ValidationFailed,
  errorBody,
  isApiError,
  toApiError,
} from "../src/lib/errors.ts";
import { fallbackRoutesLayer } from "../src/http/global.ts";
import { coreApi, UNINTERRUPTIBLE } from "../src/http/middleware.ts";
import { jsonBody } from "../src/http/request.ts";
import { json } from "../src/http/response.ts";
import { db } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { app } from "../src/index.ts";
import { decode } from "../src/lib/validate.ts";
import { createPlainHousehold, createUser } from "./support/finance-harness.ts";
import { testHttpApp } from "./support/http.ts";

interface Body {
  error: { code: string; message: string; details?: unknown };
}

/** The pinned envelope of one error in both locales (the 6991769c9 output). */
interface Pinned {
  readonly status: number;
  readonly de: Body;
  readonly en: Body;
}

const BAD_REQUEST: Pinned = {
  status: 400,
  de: { error: { code: "bad_request", message: "Ungültige Anfrage" } },
  en: { error: { code: "bad_request", message: "Invalid request" } },
};
const BAD_REQUEST_DETAILS: Pinned = {
  status: 400,
  de: { error: { code: "bad_request", message: "Ungültige Anfrage", details: { field: "x" } } },
  en: { error: { code: "bad_request", message: "Invalid request", details: { field: "x" } } },
};
const UNAUTHORIZED: Pinned = {
  status: 401,
  de: { error: { code: "unauthorized", message: "Nicht angemeldet" } },
  en: { error: { code: "unauthorized", message: "Not signed in" } },
};
const INVALID_CREDENTIALS: Pinned = {
  status: 401,
  de: { error: { code: "invalid_credentials", message: "E-Mail oder Passwort ist falsch" } },
  en: { error: { code: "invalid_credentials", message: "Email or password is incorrect" } },
};
const FORBIDDEN: Pinned = {
  status: 403,
  de: { error: { code: "forbidden", message: "Keine Berechtigung" } },
  en: { error: { code: "forbidden", message: "Not permitted" } },
};
const FORBIDDEN_NO_ACCESS: Pinned = {
  status: 403,
  de: { error: { code: "forbidden", message: "Kein Zugriff auf diese Gruppe" } },
  en: { error: { code: "forbidden", message: "No access to this group" } },
};
const NOT_FOUND: Pinned = {
  status: 404,
  de: { error: { code: "not_found", message: "Nicht gefunden" } },
  en: { error: { code: "not_found", message: "Not found" } },
};
const ROUTE_UNKNOWN: Pinned = {
  status: 404,
  de: { error: { code: "not_found", message: "Route GET /api/nope existiert nicht" } },
  en: { error: { code: "not_found", message: "Route GET /api/nope does not exist" } },
};
const CONFLICT: Pinned = {
  status: 409,
  de: { error: { code: "conflict", message: "Konflikt" } },
  en: { error: { code: "conflict", message: "Conflict" } },
};
const EMAIL_TAKEN: Pinned = {
  status: 409,
  de: { error: { code: "email_taken", message: "Diese E-Mail-Adresse ist bereits registriert" } },
  en: { error: { code: "email_taken", message: "This email address is already registered" } },
};
const PAYLOAD_TOO_LARGE: Pinned = {
  status: 413,
  de: { error: { code: "payload_too_large", message: "Datei ist zu groß (max. 15 MB)" } },
  en: { error: { code: "payload_too_large", message: "File is too large (max. 15 MB)" } },
};
const UNSUPPORTED_MEDIA_TYPE: Pinned = {
  status: 415,
  de: { error: { code: "unsupported_media_type", message: "Dateityp wird nicht unterstützt" } },
  en: { error: { code: "unsupported_media_type", message: "File type is not supported" } },
};
const ISSUES = [{ path: "name", code: "too_small", message: "x" }];
const VALIDATION_FAILED: Pinned = {
  status: 422,
  de: { error: { code: "validation_failed", message: "Eingabe ist ungültig", details: ISSUES } },
  en: { error: { code: "validation_failed", message: "Input is invalid", details: ISSUES } },
};
const VALIDATION_FAILED_BARE: Pinned = {
  status: 422,
  de: { error: { code: "validation_failed", message: "Eingabe ist ungültig" } },
  en: { error: { code: "validation_failed", message: "Input is invalid" } },
};
const INTERNAL: Pinned = {
  status: 500,
  de: { error: { code: "internal_error", message: "Interner Serverfehler" } },
  en: { error: { code: "internal_error", message: "Internal server error" } },
};
const RATE_LIMITED_7: Pinned = {
  status: 429,
  de: { error: { code: "rate_limited", message: "Zu viele Versuche. Bitte in 7 Sekunden erneut probieren." } },
  en: { error: { code: "rate_limited", message: "Too many attempts. Please try again in 7 seconds." } },
};
const NESTED = { nested: { list: [1, "a"] } };
const MEMBER_HAS_LEDGER: Pinned = {
  status: 409,
  de: {
    error: {
      code: "member_has_ledger",
      message: "Zu dieser Person gibt es noch Buchungen. Sie müssen zuerst entfernt werden.",
      details: NESTED,
    },
  },
  en: {
    error: {
      code: "member_has_ledger",
      message: "There are still transactions for this person. Remove them first.",
      details: NESTED,
    },
  },
};
const MODULE_DISABLED: Pinned = {
  status: 404,
  de: { error: { code: "module_disabled", message: "Dieses Modul ist für diesen Haushalt nicht aktiviert." } },
  en: { error: { code: "module_disabled", message: "This module is not enabled for this household." } },
};
const REQUEST_FAILED_403: Pinned = {
  status: 403,
  de: { error: { code: "forbidden", message: "Anfrage fehlgeschlagen" } },
  en: { error: { code: "forbidden", message: "Request failed" } },
};

const LOCALES: ReadonlyArray<Locale> = ["de", "en"];

/** A family member, the legacy helper it replaces, and the pinned envelope both render. */
const CASES: ReadonlyArray<{
  readonly name: string;
  readonly tagged: () => ApiErrorFamily;
  readonly legacy: () => ApiError;
  readonly pinned: Pinned;
}> = [
  { name: "BadRequest", tagged: () => new BadRequest(), legacy: () => ApiError.badRequest(), pinned: BAD_REQUEST },
  {
    name: "BadRequest with details",
    tagged: () => new BadRequest({ details: { field: "x" } }),
    legacy: () => ApiError.badRequest("server.error.badRequest", { field: "x" }),
    pinned: BAD_REQUEST_DETAILS,
  },
  { name: "Unauthorized", tagged: () => new Unauthorized(), legacy: () => ApiError.unauthorized(), pinned: UNAUTHORIZED },
  {
    name: "InvalidCredentials",
    tagged: () => new InvalidCredentials(),
    legacy: () => ApiError.invalidCredentials(),
    pinned: INVALID_CREDENTIALS,
  },
  { name: "Forbidden", tagged: () => new Forbidden(), legacy: () => ApiError.forbidden(), pinned: FORBIDDEN },
  {
    name: "Forbidden with a text",
    tagged: () => new Forbidden({ text: "server.group.noAccess" }),
    legacy: () => ApiError.forbidden("server.group.noAccess"),
    pinned: FORBIDDEN_NO_ACCESS,
  },
  { name: "NotFound", tagged: () => new NotFound(), legacy: () => ApiError.notFound(), pinned: NOT_FOUND },
  {
    name: "NotFound with placeholder values",
    tagged: () =>
      new NotFound({ text: { key: "server.error.routeUnknown", values: { method: "GET", path: "/api/nope" } } }),
    legacy: () => ApiError.notFound({ key: "server.error.routeUnknown", values: { method: "GET", path: "/api/nope" } }),
    pinned: ROUTE_UNKNOWN,
  },
  { name: "Conflict", tagged: () => new Conflict(), legacy: () => ApiError.conflict(), pinned: CONFLICT },
  {
    name: "Conflict with a code",
    tagged: () => new Conflict({ code: "email_taken", text: "server.auth.emailTaken" }),
    legacy: () => ApiError.conflict("email_taken", "server.auth.emailTaken"),
    pinned: EMAIL_TAKEN,
  },
  {
    name: "PayloadTooLarge",
    tagged: () => new PayloadTooLarge(),
    legacy: () => ApiError.payloadTooLarge(),
    pinned: PAYLOAD_TOO_LARGE,
  },
  {
    name: "UnsupportedMediaType",
    tagged: () => new UnsupportedMediaType(),
    legacy: () => ApiError.unsupportedMediaType(),
    pinned: UNSUPPORTED_MEDIA_TYPE,
  },
  {
    name: "ValidationFailed",
    tagged: () => new ValidationFailed({ details: ISSUES }),
    legacy: () => ApiError.validationFailed(ISSUES),
    pinned: VALIDATION_FAILED,
  },
  {
    name: "ValidationFailed without details",
    tagged: () => new ValidationFailed({ details: undefined }),
    legacy: () => ApiError.validationFailed(undefined),
    pinned: VALIDATION_FAILED_BARE,
  },
  { name: "Internal", tagged: () => new Internal(), legacy: () => ApiError.internal(), pinned: INTERNAL },
  {
    name: "RateLimited",
    tagged: () => new RateLimited({ retryAfterSeconds: 7 }),
    legacy: () => new ApiError(429, "rate_limited", { key: "server.error.tooManyAttempts", values: { seconds: 7 } }),
    pinned: RATE_LIMITED_7,
  },
  {
    name: "ApiFailure",
    tagged: () => new ApiFailure({ status: 404, code: "module_disabled", text: "server.module.disabled" }),
    legacy: () => new ApiError(404, "module_disabled", "server.module.disabled"),
    pinned: MODULE_DISABLED,
  },
  {
    name: "ApiFailure with object details",
    tagged: () =>
      new ApiFailure({ status: 409, code: "member_has_ledger", text: "server.household.memberHasLedger", details: NESTED }),
    legacy: () => new ApiError(409, "member_has_ledger", "server.household.memberHasLedger", NESTED),
    pinned: MEMBER_HAS_LEDGER,
  },
];

describe("every class and every legacy helper renders the 6991769c9 envelope", () => {
  for (const { name, tagged, legacy, pinned } of CASES) {
    test(name, () => {
      const error = tagged();
      const old = legacy();
      expect(error.status).toBe(pinned.status);
      expect(old.status).toBe(pinned.status);
      for (const locale of LOCALES) {
        expect(errorBody(error, locale)).toEqual(pinned[locale]);
        expect(old.toBody(locale)).toEqual(pinned[locale]);
      }
      // The default locale is the deployment's (de), and `message` is the English text the log shows.
      expect(old.toBody()).toEqual(pinned.de);
      expect(errorBody(error)).toEqual(pinned.de);
      expect(error.message).toBe(pinned.en.error.message);
      expect(old.message).toBe(pinned.en.error.message);
      expect(old.name).toBe("ApiError");
    });
  }
});

describe("the constructor shapes today's code passes never throw", () => {
  test("ApiError.validationFailed(undefined) is 422 validation_failed without details", () => {
    const error = ApiError.validationFailed(undefined);
    expect(error.status).toBe(422);
    expect(error.code).toBe("validation_failed");
    expect(error.details).toBeUndefined();
    expect("details" in error.toBody("en").error).toBe(false);
  });

  test("new ApiError(409, …, object details) keeps the details as given", () => {
    const error = new ApiError(409, "member_has_ledger", "server.household.memberHasLedger", NESTED);
    expect(error.status).toBe(409);
    expect(error.details).toEqual(NESTED);
    expect(error.toBody("de")).toEqual(MEMBER_HAS_LEDGER.de);
  });

  test("new ApiError(429, rate_limited, { key, values })", () => {
    const error = new ApiError(429, "rate_limited", {
      key: "server.error.tooManyAttempts",
      values: { seconds: 7 },
    });
    expect(error.toBody("en")).toEqual(RATE_LIMITED_7.en);
  });

  test("new ValidationFailed({ details: undefined }) and new NotFound() take their defaults", () => {
    const failed = new ValidationFailed({ details: undefined });
    expect(failed.status).toBe(422);
    expect(failed.text).toBe("server.error.validationFailed");
    expect(errorBody(failed, "de")).toEqual(VALIDATION_FAILED_BARE.de);
    expect(new NotFound().text).toBe("server.error.notFound");
    expect(new Conflict().code).toBe("conflict");
  });

  test("odd values a module may pass (a details array of anything, a numeric-looking code) do not throw", () => {
    // Constructed outside `expect(() => …)`: Bun's `toThrow` treats a RETURNED Error as thrown.
    const array = new ApiError(422, "ocr_failed", "server.ocr.noTextDetected", [null, 1, { a: undefined }]);
    expect(array.details).toEqual([null, 1, { a: undefined }]);
    const fn = (): undefined => undefined;
    const odd = new ApiError(504, "504", "server.error.internal", fn);
    expect(odd.details).toBe(fn);
    const nullDetails = new ApiFailure({ status: 400, code: "x", text: "server.error.badRequest", details: null });
    expect(errorBody(nullDetails, "en")).toEqual({ error: { code: "x", message: "Invalid request", details: null } });
  });
});

describe("instanceof ApiError and isApiError", () => {
  test("every family member and every legacy instance is instanceof ApiError and isApiError", () => {
    expect(new ApiError(429, "rate_limited", "server.error.badRequest")).toBeInstanceOf(ApiError);
    for (const { tagged, legacy } of CASES) {
      expect(tagged()).toBeInstanceOf(ApiError);
      expect(isApiError(tagged())).toBe(true);
      expect(legacy()).toBeInstanceOf(ApiError);
      expect(isApiError(legacy())).toBe(true);
    }
  });

  test("DatabaseError, a plain Error, a string and a look-alike object are not", () => {
    const database = new DatabaseError({ cause: new Error("SQLITE_BUSY") });
    expect(database instanceof ApiError).toBe(false);
    expect(isApiError(database)).toBe(false);
    expect(new Error("x") instanceof ApiError).toBe(false);
    expect(isApiError(new Error("x"))).toBe(false);
    expect(isApiError("ManagedRuntime disposed")).toBe(false);
    expect(isApiError({ _tag: "NotFound", status: 404 })).toBe(false);
  });

  test("a family member raised in an Effect fails with itself and keeps its tag", async () => {
    const error = await Effect.runPromise(Effect.flip(Effect.fail(new NotFound())));
    expect(error._tag).toBe("NotFound");
    const caught = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* new Conflict({ code: "email_taken", text: "server.auth.emailTaken" });
      }).pipe(Effect.catchTag("Conflict", (conflict) => Effect.succeed(conflict.code))),
    );
    expect(caught).toBe("email_taken");
  });
});

describe("toApiError, the one mapper", () => {
  test("a family member is returned as is", () => {
    const notFound = new NotFound();
    expect(toApiError(notFound, "de")).toBe(notFound);
    const legacy = ApiError.conflict("email_taken", "server.auth.emailTaken");
    expect(toApiError(legacy, "de")).toBe(legacy);
  });

  test("a Schema.SchemaError is 422 validation_failed with the toValidationIssues details", () => {
    let thrown: unknown;
    try {
      Schema.decodeUnknownSync(Schema.Struct({ name: Schema.String }), ALL_ISSUES)({});
    } catch (error) {
      thrown = error;
    }
    const de = toApiError(thrown, "de");
    expect(de._tag).toBe("ValidationFailed");
    expect(errorBody(de, "de")).toEqual({
      error: {
        code: "validation_failed",
        message: "Eingabe ist ungültig",
        details: [
          {
            path: "name",
            code: "invalid_type",
            message: "Ungültiger Wert",
            i18n: { key: "server.zod.invalid_type", values: { field: "name", facet: "string" } },
          },
        ],
      },
    });
    expect(errorBody(toApiError(thrown, "en"), "en")).toEqual({
      error: {
        code: "validation_failed",
        message: "Input is invalid",
        details: [
          {
            path: "name",
            code: "invalid_type",
            message: "Invalid value",
            i18n: { key: "server.zod.invalid_type", values: { field: "name", facet: "string" } },
          },
        ],
      },
    });
  });

  test("a DatabaseError, a plain Error and the string \"ManagedRuntime disposed\" are Internal", () => {
    for (const value of [new DatabaseError({ cause: new Error("SQLITE_BUSY") }), new Error("boom"), "ManagedRuntime disposed"]) {
      const mapped = toApiError(value, "de");
      expect(mapped._tag).toBe("Internal");
      expect(mapped.status).toBe(500);
      for (const locale of LOCALES) expect(errorBody(mapped, locale)).toEqual(INTERNAL[locale]);
    }
  });
});

/* ---------------------------------------------------------------------------------------------------------------
 * ApiErrorBoundary through a mini API served in memory (plan `docs/plans/e7-http-api.md` P7, E7-T04): the same bodies,
 * headers and log lines `onErrorHandler` and `notFoundHandler` produced through a tiny Hono app before.
 * ------------------------------------------------------------------------------------------------------------- */

const REQUEST_FAILED_400: Pinned = {
  status: 400,
  de: { error: { code: "bad_request", message: "Anfrage fehlgeschlagen" } },
  en: { error: { code: "bad_request", message: "Request failed" } },
};

const NameBody = Schema.Struct({ name: Schema.String });

const BoundaryGroup = HttpApiGroup.make("errors.boundary").add(
  HttpApiEndpoint.get("getRateLimited", "/rate-limited"),
  HttpApiEndpoint.get("getLegacyRateLimited", "/legacy-rate-limited"),
  HttpApiEndpoint.get("getDefect", "/defect"),
  HttpApiEndpoint.get("getDatabase", "/database"),
  HttpApiEndpoint.get("getNotFound", "/not-found"),
  HttpApiEndpoint.get("getOcr", "/ocr"),
  HttpApiEndpoint.get("getLegacyInternal", "/legacy"),
  HttpApiEndpoint.post("postDecode", "/decode"),
);
const BoundaryApi = coreApi(HttpApi.make("errors.boundary").add(BoundaryGroup));

const boundaryHandlers = HttpApiBuilder.group(BoundaryApi, "errors.boundary", (handlers) =>
  handlers
    .handle(
      "getRateLimited",
      Effect.fn("errors.boundary.getRateLimited")(function* () {
        return yield* new RateLimited({ retryAfterSeconds: 7 });
      }),
      UNINTERRUPTIBLE,
    )
    .handle(
      "getLegacyRateLimited",
      Effect.fn("errors.boundary.getLegacyRateLimited")(function* () {
        // The legacy class a module still throws: a defect to the Effect, the same value `Cause.squash` hands over.
        throw new ApiError(429, "rate_limited", { key: "server.error.tooManyAttempts", values: { seconds: 7 } });
      }),
      UNINTERRUPTIBLE,
    )
    .handle(
      "getDefect",
      Effect.fn("errors.boundary.getDefect")(function* () {
        return yield* Effect.die(new Error("a bug"));
      }),
      UNINTERRUPTIBLE,
    )
    .handle(
      "getDatabase",
      Effect.fn("errors.boundary.getDatabase")(function* () {
        return yield* new DatabaseError({ cause: new Error("SQLITE_BUSY") });
      }),
      UNINTERRUPTIBLE,
    )
    .handle(
      "getNotFound",
      Effect.fn("errors.boundary.getNotFound")(function* () {
        return yield* new NotFound();
      }),
      UNINTERRUPTIBLE,
    )
    .handle(
      "getOcr",
      Effect.fn("errors.boundary.getOcr")(function* () {
        return yield* new ApiFailure({ status: 501, code: "ocr_disabled", text: "server.import.ocrDisabled" });
      }),
      UNINTERRUPTIBLE,
    )
    .handle(
      "getLegacyInternal",
      Effect.fn("errors.boundary.getLegacyInternal")(function* () {
        throw ApiError.internal();
      }),
      UNINTERRUPTIBLE,
    )
    .handle(
      "postDecode",
      Effect.fn("errors.boundary.postDecode")(function* () {
        return json(yield* jsonBody(NameBody));
      }),
      UNINTERRUPTIBLE,
    ),
);

describe("ApiErrorBoundary through a mini API (the cases onErrorHandler and notFoundHandler answered)", () => {
  const boundary = testHttpApp([BoundaryApi], boundaryHandlers, fallbackRoutesLayer({ webDistDir: null }));

  const get = (path: string, locale: Locale, init: RequestInit = {}) =>
    boundary.request(path, { ...init, headers: { "accept-language": locale, ...(init.headers ?? {}) } });

  let errorSpy: ReturnType<typeof spyOn> | undefined;
  afterEach(() => {
    errorSpy?.mockRestore();
    errorSpy = undefined;
  });

  test("a RateLimited answers 429 with Retry-After; a legacy 429 ApiError gets no header, as before", async () => {
    for (const locale of LOCALES) {
      const response = await get("/rate-limited", locale);
      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("7");
      expect(await response.json()).toEqual(RATE_LIMITED_7[locale]);
      const legacy = await get("/legacy-rate-limited", locale);
      expect(legacy.status).toBe(429);
      expect(legacy.headers.get("retry-after")).toBeNull();
      expect(await legacy.json()).toEqual(RATE_LIMITED_7[locale]);
    }
  });

  test("a defect answers 500 internal_error and logs the original value", async () => {
    errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
    const response = await get("/defect", "en");
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual(INTERNAL.en);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [prefix, logged] = errorSpy.mock.calls[0] as [string, unknown];
    expect(prefix).toBe("[api] GET /defect ->");
    expect((logged as Error).message).toBe("a bug");
  });

  test("a 5xx family member logs status, code, the English message and the stack", async () => {
    errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
    expect((await boundary.request("/ocr")).status).toBe(501);
    expect((await boundary.request("/legacy")).status).toBe(500);
    expect(errorSpy).toHaveBeenCalledTimes(2);
    const [line, stack] = errorSpy.mock.calls[0] as [string, unknown];
    expect(line).toBe(`[api] GET /ocr -> 501 ocr_disabled: ${serverText("en", "server.import.ocrDisabled")}`);
    expect(typeof stack).toBe("string");
    expect(stack as string).toContain("errors.test.ts");
    const [legacyLine, legacyStack] = errorSpy.mock.calls[1] as [string, unknown];
    expect(legacyLine).toBe(`[api] GET /legacy -> 500 internal_error: ${serverText("en", "server.error.internal")}`);
    expect(typeof legacyStack).toBe("string");
  });

  test("a DatabaseError answers 500 internal_error and logs its cause", async () => {
    errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
    const response = await get("/database", "de");
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual(INTERNAL.de);
    const [prefix, logged] = errorSpy.mock.calls[0] as [string, unknown];
    expect(prefix).toBe("[api] GET /database ->");
    expect(logged).toBeInstanceOf(Error);
    expect((logged as Error).message).toBe("SQLITE_BUSY");
  });

  test("a NotFound failure renders 404", async () => {
    for (const locale of LOCALES) {
      const response = await get("/not-found", locale);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual(NOT_FOUND[locale]);
    }
  });

  test("an unknown route renders server.error.routeUnknown", async () => {
    for (const locale of LOCALES) {
      const response = await get("/api/nope", locale);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual(ROUTE_UNKNOWN[locale]);
    }
  });

  test("a malformed JSON body is the 400 bad_request Hono's HTTPException(400) was, with server.error.requestFailed", async () => {
    for (const locale of LOCALES) {
      const response = await get("/decode", locale, {
        method: "POST",
        body: "{not json",
        headers: { "content-type": "application/json" },
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual(REQUEST_FAILED_400[locale]);
    }
  });

  test("decode fails with the SchemaError the boundary renders as 422", async () => {
    const response = await get("/decode", "en", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
    });
    expect(response.status).toBe(422);
    const body = (await response.json()) as Body;
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.details).toEqual([
      {
        path: "name",
        code: "invalid_type",
        message: "Invalid value",
        i18n: { key: "server.zod.invalid_type", values: { field: "name", facet: "string" } },
      },
    ]);
    const ok = await get("/decode", "en", {
      method: "POST",
      body: JSON.stringify({ name: "Kim", extra: 1 }),
      headers: { "content-type": "application/json" },
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ name: "Kim" });
  });
});

/* ---------------------------------------------------------------------------------------------------------------
 * The served app (plan `docs/plans/e7-http-api.md` P13, E7-T11): what the tiny Hono app over `onErrorHandler`,
 * `notFoundHandler` and the Hono context helpers (`requireUser`, `requireMembership`, `currentUser`,
 * `currentMembership`) answered before the cutover, now through `app` (HttpApiBuilder's in-memory handler of
 * `src/http/app.ts`): the route-unknown 404, the 401 of a missing session (`RequireSession`) and the 403 of a
 * non-member (`RequireHouseholdMember`), same bodies in both locales. The helpers themselves have no caller left and
 * leave with their Hono sections (E7-T12); the pure `HTTPException` mapping keeps its test above
 * (`honoExceptionToApiError`).
 * ------------------------------------------------------------------------------------------------------------- */
describe("the served app answers what onErrorHandler and the Hono context helpers answered", () => {
  beforeAll(async () => {
    await runMigrations(db);
  });

  const get = (path: string, locale: Locale, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { "accept-language": locale, ...(init.headers ?? {}) } });

  test("an unknown route renders server.error.routeUnknown (notFoundHandler)", async () => {
    for (const locale of LOCALES) {
      const response = await get("/api/nope", locale);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual(ROUTE_UNKNOWN[locale]);
    }
  });

  test("no session renders 401 unauthorized (requireUser / currentUser)", async () => {
    for (const locale of LOCALES) {
      for (const path of ["/api/auth/me", `/api/households/${crypto.randomUUID()}`]) {
        const response = await get(path, locale);
        expect(response.status).toBe(401);
        expect(await response.json()).toEqual(UNAUTHORIZED[locale]);
      }
    }
  });

  test("a non-member renders 403 forbidden with server.group.noAccess (requireMembership / currentMembership)", async () => {
    const owner = await createUser("Errors owner");
    const stranger = await createUser("Errors stranger");
    const householdId = await createPlainHousehold(owner, "Errors household");
    for (const locale of LOCALES) {
      const response = await get(`/api/households/${householdId}`, locale, { headers: { Cookie: stranger.cookie } });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual(FORBIDDEN_NO_ACCESS[locale]);
    }
  });
});
