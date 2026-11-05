/**
 * The HTTP vocabulary of the Effect layer (plan `docs/plans/e7-http-api.md` E7-T02; P4 to P10, P13), proven over mini
 * APIs served in memory by `testHttpApp` (`apps/api/test/support/http.ts`):
 * - P6: `chain` takes middlewares in EXECUTION order; an API chain runs before a group chain before an endpoint chain;
 * - P7: `ApiErrorBoundary` answers every family member, a `Schema.SchemaError` (422 with `details` in de and en), a
 *   `DatabaseError` and a defect with the envelope, `Retry-After` and the log lines of Hono's `onErrorHandler` (both
 *   write them through `logBoundaryFailure`; the literals are the ones `apps/api/test/errors.test.ts` pins);
 * - P4: `jsonBody` (no or a non-JSON content type decodes `{}`, malformed JSON is `400 bad_request`), a body read twice,
 *   `rawJsonOr` keeps the caller's refusal, `rawJsonOrDie` makes a malformed body a 500, `queryParams` / `queryParam` /
 *   `queryRecord`, `header`, `clientIp`, `requestLocale`;
 * - P3: a `params` schema naming every `:name` of the path matches, a partial one does not (`toRouterPath`'s `::`);
 * - P8: a cookie set before a failure is on the error response, with the attribute set of `apps/api/src/lib/cookies.ts`;
 * - P10: `created` with `Location`, `noContent`, `redirect`, `fromWeb`;
 * - P13: three apps in one process (two over the same API, one over another) answer only their own routes, no
 *   `Method … already declared`, no global middleware leaks, and the handlers see the runtime's own `AppLayer`;
 * - P9: an `UNINTERRUPTIBLE` handler finishes when the client aborts, an interruptible one does not.
 */
import { DEFAULT_LOCALE, type Locale, serverText } from "@toon/shared";
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { Effect, Layer, Schema } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware } from "effect/http-api";
import { Database } from "../src/db/database.ts";
import { env } from "../src/env.ts";
import { clearSessionCookie, setSessionCookie } from "../src/http/cookies.ts";
import { ApiErrorBoundary, chain, coreApi, UNINTERRUPTIBLE } from "../src/http/middleware.ts";
import {
  clientIp,
  header,
  jsonBody,
  pathOf,
  queryParam,
  queryParams,
  queryRecord,
  rawJsonOr,
  rawJsonOrDie,
  requestLocale,
} from "../src/http/request.ts";
import { created, fromWeb, json, noContent, redirect } from "../src/http/response.ts";
import {
  ApiFailure,
  BadRequest,
  Conflict,
  DatabaseError,
  errorBody,
  Forbidden,
  Internal,
  InvalidCredentials,
  NotFound,
  PayloadTooLarge,
  RateLimited,
  toApiError,
  Unauthorized,
  UnsupportedMediaType,
  ValidationFailed,
} from "../src/lib/errors.ts";
import { decode } from "../src/lib/validate.ts";
import { runtime } from "../src/runtime.ts";
import { testHttpApp } from "./support/http.ts";

const LOCALES: readonly Locale[] = ["de", "en"];

// ---------------------------------------------------------------------------------------------------------------
// P6: the order mini API (three recording middlewares through `chain`, at endpoint, group and API scope)
// ---------------------------------------------------------------------------------------------------------------

const trail: string[] = [];

class TrailApi extends HttpApiMiddleware.Service<TrailApi>()("test/http-foundation/TrailApi") {}
class TrailGroup extends HttpApiMiddleware.Service<TrailGroup>()("test/http-foundation/TrailGroup") {}
class TrailFirst extends HttpApiMiddleware.Service<TrailFirst>()("test/http-foundation/TrailFirst") {}
class TrailSecond extends HttpApiMiddleware.Service<TrailSecond>()("test/http-foundation/TrailSecond") {}
class TrailThird extends HttpApiMiddleware.Service<TrailThird>()("test/http-foundation/TrailThird") {}

const recording = (name: string): HttpApiMiddleware.HttpApiMiddleware<never, never, never> => (httpEffect) =>
  Effect.andThen(
    Effect.sync(() => trail.push(name)),
    httpEffect,
  );

const TrailLayers = Layer.mergeAll(
  Layer.succeed(TrailApi)(recording("api")),
  Layer.succeed(TrailGroup)(recording("group")),
  Layer.succeed(TrailFirst)(recording("first")),
  Layer.succeed(TrailSecond)(recording("second")),
  Layer.succeed(TrailThird)(recording("third")),
);

const OrderGroup = HttpApiGroup.make("foundation.order")
  .add(
    HttpApiEndpoint.get("getThree", "/order/three").pipe(chain(TrailFirst, TrailSecond, TrailThird)),
    HttpApiEndpoint.get("getReversed", "/order/reversed").pipe(chain(TrailThird, TrailSecond, TrailFirst)),
  )
  .pipe(chain(TrailGroup));

const OrderApi = HttpApi.make("foundation.order").add(OrderGroup).pipe(chain(ApiErrorBoundary, TrailApi));

const orderHandlers = HttpApiBuilder.group(OrderApi, "foundation.order", (handlers) =>
  handlers
    .handle(
      "getThree",
      Effect.fn("foundation.order.getThree")(function* () {
        trail.push("handler");
        return json({ trail });
      }),
      UNINTERRUPTIBLE,
    )
    .handle(
      "getReversed",
      Effect.fn("foundation.order.getReversed")(function* () {
        trail.push("handler");
        return json({ trail });
      }),
      UNINTERRUPTIBLE,
    ),
);

// ---------------------------------------------------------------------------------------------------------------
// The probe mini API (the boundary, the request readers, the responses, the cookies)
// ---------------------------------------------------------------------------------------------------------------

const NameBody = Schema.Struct({ name: Schema.String });
const TagQuery = Schema.Struct({
  tag: Schema.optional(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
  page: Schema.optional(Schema.String),
});

const FAILURES = {
  badRequest: () => new BadRequest(),
  unauthorized: () => new Unauthorized(),
  invalidCredentials: () => new InvalidCredentials(),
  forbidden: () => new Forbidden({ text: "server.group.noAccess" }),
  notFound: () => new NotFound(),
  conflict: () => new Conflict({ code: "email_taken", text: "server.auth.emailTaken" }),
  payloadTooLarge: () => new PayloadTooLarge(),
  unsupportedMediaType: () => new UnsupportedMediaType(),
  validationFailed: () => new ValidationFailed({ details: [{ path: "x" }] }),
  internal: () => new Internal(),
  rateLimited: () => new RateLimited({ retryAfterSeconds: 7 }),
  apiFailure: () => new ApiFailure({ status: 404, code: "module_disabled", text: "server.module.disabled" }),
  apiFailure501: () => new ApiFailure({ status: 501, code: "ocr_disabled", text: "server.import.ocrDisabled" }),
} as const;
type FailureKind = keyof typeof FAILURES;

let databaseSeen: unknown;
let finished = { uninterruptible: false, interruptible: false };

const ProbeGroup = HttpApiGroup.make("foundation.probe").add(
  HttpApiEndpoint.get("getFailByKind", "/fail/:kind", { params: { kind: Schema.String } }),
  HttpApiEndpoint.get("getDefect", "/defect"),
  HttpApiEndpoint.get("getDatabase", "/database"),
  HttpApiEndpoint.post("postJson", "/json"),
  HttpApiEndpoint.post("postJsonTwice", "/json-twice"),
  HttpApiEndpoint.post("postRawOr", "/raw-or"),
  HttpApiEndpoint.post("postRawDie", "/raw-die"),
  HttpApiEndpoint.get("getQuery", "/query"),
  HttpApiEndpoint.get("getRequestInfo", "/request-info"),
  HttpApiEndpoint.get("getCookieThenFail", "/cookie-then-fail"),
  HttpApiEndpoint.get("getClearThenFail", "/clear-then-fail"),
  HttpApiEndpoint.post("postCreated", "/created"),
  HttpApiEndpoint.delete("deleteNoContent", "/no-content"),
  HttpApiEndpoint.get("getRedirect", "/redirect"),
  HttpApiEndpoint.get("getFromWeb", "/from-web"),
  HttpApiEndpoint.get("getItemsByAByB", "/items/:a/:b", { params: { a: Schema.String, b: Schema.String } }),
  HttpApiEndpoint.get("getPartialByAByB", "/partial/:a/:b", { params: { a: Schema.String } }),
  HttpApiEndpoint.get("getDatabaseIdentity", "/database-identity"),
  HttpApiEndpoint.get("getSlowUninterruptible", "/slow-uninterruptible"),
  HttpApiEndpoint.get("getSlowInterruptible", "/slow-interruptible"),
);

const ProbeApi = coreApi(HttpApi.make("foundation.probe").add(ProbeGroup.prefix("/probe")));

const probeHandlers = HttpApiBuilder.group(ProbeApi, "foundation.probe", (handlers) =>
  handlers
    .handle(
      "getFailByKind",
      Effect.fn("foundation.probe.getFailByKind")(function* ({ params }) {
        const make = FAILURES[params.kind as FailureKind];
        if (!make) return yield* new NotFound();
        return yield* make();
      }),
      UNINTERRUPTIBLE,
    )
    .handle(
      "getDefect",
      Effect.fn("foundation.probe.getDefect")(function* () {
        return yield* Effect.die(new Error("a bug"));
      }),
      UNINTERRUPTIBLE,
    )
    .handle(
      "getDatabase",
      Effect.fn("foundation.probe.getDatabase")(function* () {
        return yield* new DatabaseError({ cause: new Error("SQLITE_BUSY") });
      }),
      UNINTERRUPTIBLE,
    )
    .handle(
      "postJson",
      Effect.fn("foundation.probe.postJson")(function* () {
        const body = yield* jsonBody(NameBody);
        return json(body);
      }),
      UNINTERRUPTIBLE,
    )
    .handle(
      "postJsonTwice",
      Effect.fn("foundation.probe.postJsonTwice")(function* () {
        const body = yield* jsonBody(NameBody);
        const raw = yield* rawJsonOrDie;
        return json({ body, raw });
      }),
      UNINTERRUPTIBLE,
    )
    .handle(
      "postRawOr",
      Effect.fn("foundation.probe.postRawOr")(function* () {
        const raw = yield* rawJsonOr(() => new BadRequest({ text: "server.import.invalidJsonBody" }));
        return json({ raw });
      }),
      UNINTERRUPTIBLE,
    )
    .handle(
      "postRawDie",
      Effect.fn("foundation.probe.postRawDie")(function* () {
        const raw = yield* rawJsonOrDie;
        return json({ raw });
      }),
      UNINTERRUPTIBLE,
    )
    .handle(
      "getQuery",
      Effect.fn("foundation.probe.getQuery")(function* () {
        const query = yield* queryParams(TagQuery);
        return json({ query, first: yield* queryParam("tag"), missing: (yield* queryParam("nope")) ?? null, record: yield* queryRecord });
      }),
      UNINTERRUPTIBLE,
    )
    .handle(
      "getRequestInfo",
      Effect.fn("foundation.probe.getRequestInfo")(function* () {
        return json({ ip: yield* clientIp, locale: yield* requestLocale, custom: (yield* header("X-Custom")) ?? null });
      }),
      UNINTERRUPTIBLE,
    )
    .handle(
      "getCookieThenFail",
      Effect.fn("foundation.probe.getCookieThenFail")(function* () {
        yield* setSessionCookie("session-abc", Date.now() + 30 * 24 * 60 * 60 * 1000);
        return yield* new NotFound();
      }),
      UNINTERRUPTIBLE,
    )
    .handle(
      "getClearThenFail",
      Effect.fn("foundation.probe.getClearThenFail")(function* () {
        yield* clearSessionCookie;
        return yield* new Unauthorized();
      }),
      UNINTERRUPTIBLE,
    )
    .handle(
      "postCreated",
      Effect.fn("foundation.probe.postCreated")(function* () {
        return created({ id: "x1" }, "/probe/items/x1");
      }),
      UNINTERRUPTIBLE,
    )
    .handle(
      "deleteNoContent",
      Effect.fn("foundation.probe.deleteNoContent")(function* () {
        return noContent();
      }),
      UNINTERRUPTIBLE,
    )
    .handle(
      "getRedirect",
      Effect.fn("foundation.probe.getRedirect")(function* () {
        return redirect("/somewhere?x=1");
      }),
      UNINTERRUPTIBLE,
    )
    .handle(
      "getFromWeb",
      Effect.fn("foundation.probe.getFromWeb")(function* () {
        return fromWeb(
          new Response("raw bytes", {
            headers: { "content-type": "text/plain", "content-disposition": 'inline; filename="a.txt"' },
          }),
        );
      }),
      UNINTERRUPTIBLE,
    )
    .handle(
      "getItemsByAByB",
      Effect.fn("foundation.probe.getItemsByAByB")(function* ({ params }) {
        return json(params);
      }),
      UNINTERRUPTIBLE,
    )
    .handle(
      "getPartialByAByB",
      Effect.fn("foundation.probe.getPartialByAByB")(function* ({ params }) {
        return json(params);
      }),
      UNINTERRUPTIBLE,
    )
    .handle(
      "getDatabaseIdentity",
      Effect.fn("foundation.probe.getDatabaseIdentity")(function* () {
        databaseSeen = yield* Database;
        return noContent();
      }),
      UNINTERRUPTIBLE,
    )
    .handle(
      "getSlowUninterruptible",
      Effect.fn("foundation.probe.getSlowUninterruptible")(function* () {
        yield* Effect.sleep("150 millis");
        finished = { ...finished, uninterruptible: true };
        return noContent();
      }),
      UNINTERRUPTIBLE,
    )
    .handle(
      "getSlowInterruptible",
      Effect.fn("foundation.probe.getSlowInterruptible")(function* () {
        yield* Effect.sleep("150 millis");
        finished = { ...finished, interruptible: true };
        return noContent();
      }),
    ),
);

const probe = testHttpApp([ProbeApi], probeHandlers);
const order = testHttpApp([OrderApi], orderHandlers, TrailLayers);

const get = (path: string, locale: Locale, init: RequestInit = {}) =>
  probe.request(path, { ...init, headers: { "accept-language": locale, ...(init.headers ?? {}) } });

let errorSpy: ReturnType<typeof spyOn> | undefined;
afterEach(() => {
  errorSpy?.mockRestore();
  errorSpy = undefined;
});

describe("P6: chain runs middlewares in the listed order; API, then group, then endpoint", () => {
  test("chain(First, Second, Third) on the endpoint, a group chain and an API chain", async () => {
    trail.length = 0;
    const response = await order.request("/order/three");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ trail: ["api", "group", "first", "second", "third", "handler"] });
  });

  test("the reversed listing runs reversed (the order is chain's, not the tags')", async () => {
    trail.length = 0;
    const response = await order.request("/order/reversed");
    expect(await response.json()).toEqual({ trail: ["api", "group", "third", "second", "first", "handler"] });
  });

  test("chain attaches the LAST listed first: the endpoint's middleware set ends with the outermost", () => {
    const endpoint = HttpApiEndpoint.get("x", "/x").pipe(chain(TrailFirst, TrailSecond, TrailThird));
    expect([...endpoint.middlewares]).toEqual([TrailThird, TrailSecond, TrailFirst]);
  });
});

describe("P7: ApiErrorBoundary renders every failure as onErrorHandler did", () => {
  for (const [kind, make] of Object.entries(FAILURES)) {
    test(`${kind}: status, body in de and en${kind === "rateLimited" ? ", Retry-After" : ""}`, async () => {
      if (make().status >= 500) errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
      for (const locale of LOCALES) {
        const response = await get(`/probe/fail/${kind}`, locale);
        const expected = make();
        expect(response.status).toBe(expected.status);
        expect(response.headers.get("content-type")).toBe("application/json");
        expect(await response.json()).toEqual(errorBody(expected, locale));
        expect(response.headers.get("retry-after")).toBe(kind === "rateLimited" ? "7" : null);
      }
    });
  }

  test("a 5xx family member logs status, code, the English message and the stack (the errors.test.ts line)", async () => {
    errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
    expect((await probe.request("/probe/fail/apiFailure501")).status).toBe(501);
    expect((await probe.request("/probe/fail/internal")).status).toBe(500);
    expect(errorSpy).toHaveBeenCalledTimes(2);
    const [line, stack] = errorSpy.mock.calls[0] as [string, unknown];
    expect(line).toBe(`[api] GET /probe/fail/apiFailure501 -> 501 ocr_disabled: ${serverText("en", "server.import.ocrDisabled")}`);
    expect(typeof stack).toBe("string");
    expect(stack as string).toContain("http-foundation.test.ts");
    const [internalLine] = errorSpy.mock.calls[1] as [string, unknown];
    expect(internalLine).toBe(`[api] GET /probe/fail/internal -> 500 internal_error: ${serverText("en", "server.error.internal")}`);
  });

  test("a 4xx family member logs nothing outside development", async () => {
    errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
    const warnSpy = spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect((await probe.request("/probe/fail/notFound?x=1")).status).toBe(404);
      expect(errorSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("a defect answers 500 internal_error and logs the original value under the pathname (no query)", async () => {
    errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
    for (const locale of LOCALES) {
      const response = await get("/probe/defect?secret=1", locale);
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual(errorBody(new Internal(), locale));
    }
    const [prefix, logged] = errorSpy.mock.calls[0] as [string, unknown];
    expect(prefix).toBe("[api] GET /probe/defect ->");
    expect((logged as Error).message).toBe("a bug");
  });

  test("a DatabaseError answers 500 internal_error and logs its cause", async () => {
    errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
    const response = await probe.request("/probe/database");
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual(errorBody(new Internal(), DEFAULT_LOCALE));
    const [prefix, logged] = errorSpy.mock.calls[0] as [string, unknown];
    expect(prefix).toBe("[api] GET /probe/database ->");
    expect(logged).toBeInstanceOf(Error);
    expect((logged as Error).message).toBe("SQLITE_BUSY");
  });

  test("a Schema.SchemaError is 422 validation_failed with the toValidationIssues details in de and en", async () => {
    const refusal = await Effect.runPromise(Effect.flip(decode(NameBody, {})));
    for (const locale of LOCALES) {
      const response = await get("/probe/json", locale, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: 3 }),
      });
      expect(response.status).toBe(422);
      const body = (await response.json()) as { error: { code: string; details: unknown[] } };
      expect(body.error.code).toBe("validation_failed");
      expect(body.error.details.length).toBeGreaterThan(0);
      expect(body as unknown).toEqual(errorBody(toApiError(await Effect.runPromise(Effect.flip(decode(NameBody, { name: 3 }))), locale), locale));
      expect(errorBody(toApiError(refusal, locale), locale).error.code).toBe("validation_failed");
    }
  });
});

describe("P4: reading a request keeps Hono's semantics", () => {
  test("jsonBody without a content type decodes {} (here: a 422 for the missing name)", async () => {
    const response = await probe.request("/probe/json", { method: "POST", body: JSON.stringify({ name: "x" }) });
    expect(response.status).toBe(422);
  });

  test("jsonBody with text/plain decodes {}", async () => {
    const response = await probe.request("/probe/json", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ name: "x" }),
    });
    expect(response.status).toBe(422);
  });

  test("jsonBody reads application/json and application/vnd.x+json; charset=utf-8", async () => {
    for (const contentType of ["application/json", "application/vnd.x+json; charset=utf-8"]) {
      const response = await probe.request("/probe/json", {
        method: "POST",
        headers: { "content-type": contentType },
        body: JSON.stringify({ name: "x", extra: 1 }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ name: "x" });
    }
  });

  test("malformed or empty JSON is 400 bad_request with server.error.requestFailed", async () => {
    for (const body of ["{nope", ""]) {
      for (const locale of LOCALES) {
        const response = await get("/probe/json", locale, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        });
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: { code: "bad_request", message: serverText(locale, "server.error.requestFailed") },
        });
      }
    }
  });

  test("a valid body is read twice: jsonBody, then rawJsonOrDie", async () => {
    const response = await probe.request("/probe/json-twice", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "x", extra: 1 }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ body: { name: "x" }, raw: { name: "x", extra: 1 } });
  });

  test("rawJsonOr fails with exactly the caller's refusal (server.import.invalidJsonBody, de and en)", async () => {
    for (const locale of LOCALES) {
      const response = await get("/probe/raw-or", locale, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{nope",
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "bad_request", message: serverText(locale, "server.import.invalidJsonBody") },
      });
    }
    const ok = await probe.request("/probe/raw-or", { method: "POST", body: '{"a":[1]}' });
    expect(await ok.json()).toEqual({ raw: { a: [1] } });
  });

  test("rawJsonOrDie on an empty text/plain body is a 500 internal_error (a defect, never a 400)", async () => {
    errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
    const response = await probe.request("/probe/raw-die", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "",
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual(errorBody(new Internal(), DEFAULT_LOCALE));
    const [prefix, logged] = errorSpy.mock.calls[0] as [string, unknown];
    expect(prefix).toBe("[api] POST /probe/raw-die ->");
    expect(logged).toBeInstanceOf(SyntaxError);
  });

  test("queryParams: a repeated key is an array, a single one a string; queryParam is the first value", async () => {
    const repeated = await probe.request("/probe/query?tag=a&tag=b&page=2");
    expect(await repeated.json()).toEqual({
      query: { tag: ["a", "b"], page: "2" },
      first: "a",
      missing: null,
      record: { tag: "a", page: "2" },
    });
    const single = await probe.request("/probe/query?tag=a%20b");
    expect(await single.json()).toEqual({ query: { tag: "a b" }, first: "a b", missing: null, record: { tag: "a b" } });
  });

  test("header, requestLocale and clientIp without TRUST_PROXY (no socket in memory: unknown)", async () => {
    const response = await probe.request("/probe/request-info", {
      headers: { "accept-language": "en-US,en;q=0.9", "x-custom": "yes", "x-forwarded-for": "1.2.3.4" },
    });
    expect(await response.json()).toEqual({ ip: "unknown", locale: "en", custom: "yes" });
    const fallback = await probe.request("/probe/request-info", { headers: { "accept-language": "fr" } });
    expect(await fallback.json()).toEqual({ ip: "unknown", locale: env.defaultLocale, custom: null });
  });

  test("clientIp with TRUST_PROXY: the LAST X-Forwarded-For entry, then X-Real-IP, then CF-Connecting-IP", async () => {
    const mutableEnv = env as { trustProxy: boolean };
    const before = mutableEnv.trustProxy;
    mutableEnv.trustProxy = true;
    try {
      const ip = async (headers: Record<string, string>) =>
        ((await (await probe.request("/probe/request-info", { headers })).json()) as { ip: string }).ip;
      expect(await ip({ "x-forwarded-for": "6.6.6.6, 1.2.3.4", "x-real-ip": "9.9.9.9" })).toBe("1.2.3.4");
      expect(await ip({ "x-real-ip": "9.9.9.9", "cf-connecting-ip": "8.8.8.8" })).toBe("9.9.9.9");
      expect(await ip({ "cf-connecting-ip": "8.8.8.8" })).toBe("8.8.8.8");
      expect(await ip({})).toBe("unknown");
    } finally {
      mutableEnv.trustProxy = before;
    }
  });

  test("pathOf is Hono's getPath: no query or hash, percent-decoded with %25 kept", () => {
    expect(pathOf("/api/nope?x=1#h")).toBe("/api/nope");
    expect(pathOf("http://localhost/api/a%20b?x")).toBe("/api/a b");
    expect(pathOf("/api/a%25b")).toBe("/api/a%25b");
    expect(pathOf("/api/%E0%A4%A")).toBe("/api/%E0%A4%A");
  });
});

describe("P3: params name every :name of the full path", () => {
  test("a full params schema matches and decodes the names", async () => {
    const response = await probe.request("/probe/items/one/two");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ a: "one", b: "two" });
  });

  test("a partial params schema turns the undeclared :b into a literal ':' and the route stops matching", async () => {
    const response = await probe.request("/probe/partial/one/two");
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });
});

describe("P8: cookies", () => {
  test("a cookie set before a failure is on the error response, with Path, HttpOnly, SameSite=Lax and Max-Age in seconds", async () => {
    const response = await probe.request("/probe/cookie-then-fail");
    expect(response.status).toBe(404);
    const cookie = response.headers.get("set-cookie") ?? "";
    const [pair, ...attributes] = cookie.split("; ");
    expect(pair).toBe("toon_session=session-abc");
    const maxAge = Number(attributes.find((a) => a.startsWith("Max-Age="))?.slice("Max-Age=".length));
    expect(Math.abs(maxAge - 30 * 24 * 60 * 60)).toBeLessThanOrEqual(5);
    expect(new Set(attributes.filter((a) => !a.startsWith("Max-Age=")))).toEqual(new Set(["Path=/", "HttpOnly", "SameSite=Lax"]));
  });

  test("clearing writes the empty value with Max-Age=0 and no Expires, on the 401", async () => {
    const response = await probe.request("/probe/clear-then-fail");
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBe("toon_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax");
  });
});

describe("P10: responses", () => {
  test("created: 201, JSON and Location", async () => {
    const response = await probe.request("/probe/created", { method: "POST" });
    expect(response.status).toBe(201);
    expect(response.headers.get("location")).toBe("/probe/items/x1");
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({ id: "x1" });
  });

  test("noContent: 204 without a body or content type", async () => {
    const response = await probe.request("/probe/no-content", { method: "DELETE" });
    expect(response.status).toBe(204);
    expect(response.headers.get("content-type")).toBeNull();
    expect(await response.text()).toBe("");
  });

  test("redirect: 302 with Location", async () => {
    const response = await probe.request("/probe/redirect");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/somewhere?x=1");
  });

  test("fromWeb keeps the body and the headers of the web Response", async () => {
    const response = await probe.request("/probe/from-web");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain");
    expect(response.headers.get("content-disposition")).toBe('inline; filename="a.txt"');
    expect(await response.text()).toBe("raw bytes");
  });
});

describe("P13: in-memory apps are isolated and share the runtime's AppLayer", () => {
  test("two apps over the same API and a third over another answer only their own routes; no global middleware leaks", async () => {
    const globalHeader = HttpRouter.middleware(
      (httpEffect) => Effect.map(httpEffect, HttpServerResponse.setHeader("x-test-global", "second")),
      { global: true },
    );
    const first = testHttpApp([ProbeApi], probeHandlers);
    const second = testHttpApp([ProbeApi], probeHandlers, globalHeader);
    const third = testHttpApp([OrderApi], orderHandlers, TrailLayers);

    const a = await first.request("/probe/items/a/b");
    const b = await second.request("/probe/items/a/b");
    const c = await third.request("/order/three");
    expect([a.status, b.status, c.status]).toEqual([200, 200, 200]);
    expect(a.headers.get("x-test-global")).toBeNull();
    expect(b.headers.get("x-test-global")).toBe("second");
    expect(c.headers.get("x-test-global")).toBeNull();

    expect((await third.request("/probe/items/a/b")).status).toBe(404);
    expect((await first.request("/order/three")).status).toBe(404);
    expect((await second.request("/order/three")).status).toBe(404);
    expect((await probe.request("/order/three")).status).toBe(404);
  });

  test("a handler sees the Database the runtime built (AppLayer found in the parent memo map, not rebuilt)", async () => {
    const response = await probe.request("/probe/database-identity");
    expect(response.status).toBe(204);
    expect(databaseSeen).toBe(await runtime.runPromise(Database));
  });
});

describe("P9: UNINTERRUPTIBLE", () => {
  test("an uninterruptible handler finishes when the client aborts; an interruptible one is interrupted", async () => {
    finished = { uninterruptible: false, interruptible: false };
    for (const path of ["/probe/slow-uninterruptible", "/probe/slow-interruptible"]) {
      const controller = new AbortController();
      const pending = probe.request(path, { signal: controller.signal }).catch(() => undefined);
      await Bun.sleep(30);
      controller.abort();
      await pending;
    }
    await Bun.sleep(300);
    expect(finished).toEqual({ uninterruptible: true, interruptible: false });
  });
});
