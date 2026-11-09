/**
 * A module's PUBLIC routes (ADR 0017; plan `docs/plans/m9-calendar-feed.md` M9-T02, P2, P15):
 *
 *   (a) `logPathOf` redacts every path below `/api/<id>/feed/` and leaves every other path as `pathOf` reads it;
 *   (b) `moduleRoutesLayer` refuses at layer build a public endpoint with a session middleware, with a second
 *       middleware, outside `/api/<id>/feed/`, with a method other than GET, and a USER path below `/api/<id>/feed/`;
 *       each failure names the module, the endpoint and the rule;
 *   (c) a well-built public API serves without a cookie (a foreign cookie is ignored), HEAD falls back to its GET, an
 *       unknown path below the prefix is the global JSON 404 (no public catch-all);
 *   (d) neither the request log nor the boundary's failure log ever prints the credential segment.
 */
import { afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { Effect, Layer, Schema } from "effect";
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { db } from "../src/db/client.ts";
import { globalHttpLayer } from "../src/http/global.ts";
import {
  ApiErrorBoundary,
  chain,
  publicModuleApi,
  RequireSession,
  RequireVerifiedEmail,
  UNINTERRUPTIBLE,
  userModuleApi,
} from "../src/http/middleware.ts";
import { httpMiddlewareLayer } from "../src/http/middleware-layer.ts";
import { logPathOf } from "../src/http/request.ts";
import { json } from "../src/http/response.ts";
import { moduleRoutesLayer } from "../src/modules/mount.ts";
import type { ApiModule, ModuleHttpApi } from "../src/modules/types.ts";
import { runMigrations } from "./support/bridges/migrate.ts";
import { createUser } from "./support/calendar-harness.ts";
import { testHttpApp } from "./support/http.ts";

beforeAll(async () => {
  await runMigrations(db);
});

const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcde";

/* ------------------------------ (a) logPathOf ------------------------------ */

describe("(a) logPathOf (P15)", () => {
  const cases: Array<[string, string]> = [
    [`/api/calendar/feed/${TOKEN}.ics`, "/api/calendar/feed/<redacted>.ics"],
    [`http://localhost/api/calendar/feed/${TOKEN}.ics?x=1#h`, "/api/calendar/feed/<redacted>.ics"],
    [`/api/calendar/feed/${TOKEN}`, "/api/calendar/feed/<redacted>"],
    [`/api/calendar/feed/a/b/${TOKEN}.ics`, "/api/calendar/feed/<redacted>.ics"],
    [`/api/recipe/feed/whatever`, "/api/recipe/feed/<redacted>"],
    // M9-fix: the router collapses runs of `/` and matches case-insensitively, so these are served and must redact.
    [`/api//calendar/feed/${TOKEN}.ics`, "/api/calendar/feed/<redacted>.ics"],
    [`//api/calendar/feed/${TOKEN}.ics`, "/api/calendar/feed/<redacted>.ics"],
    [`/api/calendar//feed/${TOKEN}.ics`, "/api/calendar/feed/<redacted>.ics"],
    [`/api/calendar/feed//${TOKEN}.ics`, "/api/calendar/feed/<redacted>.ics"],
    [`http://localhost//api///calendar//feed/${TOKEN}.ics?x=1`, "/api/calendar/feed/<redacted>.ics"],
    [`/API/Calendar/FEED/${TOKEN}.ics`, "/API/Calendar/FEED/<redacted>.ics"],
    [`/api/calendar/feed/${TOKEN}.ICS/`, "/api/calendar/feed/<redacted>.ics"],
    [`/api/calendar/%66eed/${TOKEN}.ics`, "/api/calendar/feed/<redacted>.ics"],
    ["/api//households/h1/calendar/feed", "/api//households/h1/calendar/feed"],
    ["/api/calendar/feed/", "/api/calendar/feed/"],
    ["/api/households/h1/calendar/feed", "/api/households/h1/calendar/feed"],
    ["/api/households/h1/calendar/occurrences?from=2027-01-01", "/api/households/h1/calendar/occurrences"],
    ["/uploads/a.jpg?sig=secret&exp=1", "/uploads/a.jpg"],
    ["/api/health", "/api/health"],
  ];
  for (const [url, expected] of cases) {
    test(`${url} -> ${expected}`, () => {
      expect(logPathOf(url)).toBe(expected);
    });
  }
});

/* ------------------------- the fake public module ------------------------- */

/** One public group: `GET /feed/:file` echoes the file, `GET /feed/boom/:file` dies (a 500 the boundary logs). */
const FeedGroup = HttpApiGroup.make("test.feedPublic").add(
  HttpApiEndpoint.get("feed", "/feed/:file", { params: { file: Schema.String } }),
  HttpApiEndpoint.get("boom", "/feed/boom/:file", { params: { file: Schema.String } }),
);
const FeedApi = publicModuleApi("calendar", HttpApi.make("test.feedPublic").add(FeedGroup));
const feedHandlers = HttpApiBuilder.group(FeedApi, "test.feedPublic", (handlers) =>
  handlers
    .handle(
      "feed",
      Effect.fn("test.feedPublic.feed")(function* ({ params }) {
        return json({ ok: true, file: params.file });
      }),
      UNINTERRUPTIBLE,
    )
    .handle(
      "boom",
      Effect.fn("test.feedPublic.boom")(function* () {
        return yield* Effect.die("kaputt");
      }),
      UNINTERRUPTIBLE,
    ),
);

function publicModule(contribution: ModuleHttpApi): ApiModule {
  return { id: "calendar", schema: {}, publicApi: contribution };
}

/** An in-memory app serving `modules` through `moduleRoutesLayer` (and, with `logLine`, the request log). */
function moduleApp(modules: readonly ApiModule[], logLine?: (line: string) => void) {
  const routes =
    logLine === undefined
      ? moduleRoutesLayer(modules)
      : Layer.mergeAll(
          globalHttpLayer({ requestLog: true, logLine, webDistDir: null, webOrigins: [] }),
          moduleRoutesLayer(modules),
        );
  return testHttpApp([], Layer.empty, routes.pipe(Layer.provideMerge(httpMiddlewareLayer())));
}

/** The error message the build of `module` dies with (the first request rejects with it). */
async function buildFailure(module: ApiModule, path: string): Promise<string> {
  const failure = await moduleApp([module])
    .request(path)
    .then(
      () => undefined,
      (error: unknown) => error,
    );
  expect(failure).toBeDefined();
  return String(failure instanceof Error ? failure.message : failure);
}

/* ---------------------------- (b) the assertions ---------------------------- */

describe("(b) moduleRoutesLayer refuses a miswired public API at build (P2)", () => {
  test("a public endpoint behind RequireSession dies", async () => {
    const Group = HttpApiGroup.make("test.sessionFeed").add(
      HttpApiEndpoint.get("feed", "/feed/:file", { params: { file: Schema.String } }),
    );
    const Api = HttpApi.make("test.sessionFeed")
      .add(Group)
      .prefix("/api/calendar")
      .pipe(chain(ApiErrorBoundary, RequireSession));
    const handlers = HttpApiBuilder.group(Api, "test.sessionFeed", (h) =>
      h.handle("feed", Effect.fn("test.sessionFeed.feed")(function* () {
        return json({});
      })),
    );
    const message = await buildFailure(publicModule({ apis: [Api], handlers }), "/api/calendar/feed/x.ics");
    expect(message).toContain('module "calendar"');
    expect(message).toContain("test.sessionFeed.feed");
    expect(message).toContain("GET /api/calendar/feed/:file");
    expect(message).toContain("exactly one middleware, ApiErrorBoundary");
  });

  test("a public endpoint with a second middleware (a group chain) dies", async () => {
    const Group = HttpApiGroup.make("test.gatedFeed")
      .add(HttpApiEndpoint.get("feed", "/feed/:file", { params: { file: Schema.String } }))
      .pipe(chain(RequireVerifiedEmail));
    const Api = publicModuleApi("calendar", HttpApi.make("test.gatedFeed").add(Group));
    const handlers = HttpApiBuilder.group(Api, "test.gatedFeed", (h) =>
      h.handle("feed", Effect.fn("test.gatedFeed.feed")(function* () {
        return json({});
      })),
    );
    const message = await buildFailure(publicModule({ apis: [Api], handlers }), "/api/calendar/feed/x.ics");
    expect(message).toContain("test.gatedFeed.feed");
    expect(message).toContain("exactly one middleware, ApiErrorBoundary");
  });

  test("a public endpoint outside /api/<id>/feed/ dies", async () => {
    const Group = HttpApiGroup.make("test.strayFeed").add(
      HttpApiEndpoint.get("feed", "/export/:file", { params: { file: Schema.String } }),
    );
    const Api = publicModuleApi("calendar", HttpApi.make("test.strayFeed").add(Group));
    const handlers = HttpApiBuilder.group(Api, "test.strayFeed", (h) =>
      h.handle("feed", Effect.fn("test.strayFeed.feed")(function* () {
        return json({});
      })),
    );
    const message = await buildFailure(publicModule({ apis: [Api], handlers }), "/api/calendar/export/x.ics");
    expect(message).toContain("GET /api/calendar/export/:file");
    expect(message).toContain("the path must lie below /api/calendar/feed/");
  });

  test("a public POST dies", async () => {
    const Group = HttpApiGroup.make("test.postFeed").add(
      HttpApiEndpoint.post("feed", "/feed/:file", { params: { file: Schema.String } }),
    );
    const Api = publicModuleApi("calendar", HttpApi.make("test.postFeed").add(Group));
    const handlers = HttpApiBuilder.group(Api, "test.postFeed", (h) =>
      h.handle("feed", Effect.fn("test.postFeed.feed")(function* () {
        return json({});
      })),
    );
    const message = await buildFailure(publicModule({ apis: [Api], handlers }), "/api/calendar/feed/x.ics");
    expect(message).toContain("POST /api/calendar/feed/:file");
    expect(message).toContain("a public endpoint must be a GET");
  });

  test("a USER path below /api/<id>/feed/ dies (the log redaction would hide a session route)", async () => {
    const Group = HttpApiGroup.make("test.userFeed").add(HttpApiEndpoint.get("list", "/feed/mine"));
    const Api = userModuleApi("calendar", HttpApi.make("test.userFeed").add(Group));
    const handlers = HttpApiBuilder.group(Api, "test.userFeed", (h) =>
      h.handle("list", Effect.fn("test.userFeed.list")(function* () {
        return json({});
      })),
    );
    const module: ApiModule = { id: "calendar", schema: {}, userApi: { apis: [Api], handlers } };
    const message = await buildFailure(module, "/api/calendar/feed/mine");
    expect(message).toContain("test.userFeed.list");
    expect(message).toContain("a user path must not lie below /api/calendar/feed/");
  });
});

/* --------------------------- (c) serving, (d) logs --------------------------- */

describe("(c) a well-built public API serves without a session", () => {
  const app = moduleApp([publicModule({ apis: [FeedApi], handlers: feedHandlers })]);

  test("GET without a cookie is 200; a foreign or garbage cookie is ignored", async () => {
    const anonymous = await app.request(`/api/calendar/feed/${TOKEN}.ics`);
    expect(anonymous.status).toBe(200);
    expect(await anonymous.json()).toEqual({ ok: true, file: `${TOKEN}.ics` });

    const someone = await createUser("Fremd");
    for (const cookie of [someone.cookie, "toon_session=garbage"]) {
      const response = await app.request(`/api/calendar/feed/${TOKEN}.ics`, { headers: { Cookie: cookie } });
      expect(response.status).toBe(200);
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });

  test("HEAD falls back to the GET: 200, no body", async () => {
    const head = await app.request(`/api/calendar/feed/${TOKEN}.ics`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  test("an unknown path below the prefix has no catch-all of its own (not answered by the module)", async () => {
    // The mini app has no fallback route: an unmatched path is the router's own 404, not a module answer.
    const deeper = await app.request(`/api/calendar/feed/a/b/${TOKEN}.ics`);
    expect(deeper.status).toBe(404);
  });
});

describe("(d) the credential never reaches a log line (P15)", () => {
  let errors: ReturnType<typeof spyOn> | undefined;
  afterEach(() => {
    errors?.mockRestore();
    errors = undefined;
  });

  test("the request log prints the redacted path on both lines", async () => {
    const lines: string[] = [];
    const app = moduleApp([publicModule({ apis: [FeedApi], handlers: feedHandlers })], (line) => lines.push(line));
    const response = await app.request(`/api/calendar/feed/${TOKEN}.ics?probe=1`);
    expect(response.status).toBe(200);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("<-- GET /api/calendar/feed/<redacted>.ics");
    expect(lines[1]).toMatch(/^--> GET \/api\/calendar\/feed\/<redacted>\.ics \S+ \d+(ms|s)$/);
    for (const line of lines) {
      expect(line).not.toContain(TOKEN);
      expect(line).not.toContain("probe");
    }
  });

  test("the boundary's 500 log line prints the redacted path", async () => {
    const logged: unknown[][] = [];
    errors = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logged.push(args);
    });
    const lines: string[] = [];
    const app = moduleApp([publicModule({ apis: [FeedApi], handlers: feedHandlers })], (line) => lines.push(line));
    const response = await app.request(`/api/calendar/feed/boom/${TOKEN}.ics`);
    expect(response.status).toBe(500);
    const text = logged.map((args) => args.map(String).join(" ")).join("\n");
    expect(text).toContain("[api] GET /api/calendar/feed/<redacted>.ics ->");
    expect(text).not.toContain(TOKEN);
    expect(lines.join("\n")).not.toContain(TOKEN);
  });
});
