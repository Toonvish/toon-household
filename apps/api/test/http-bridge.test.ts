/**
 * The transitional bridge (plan `docs/plans/e7-http-api.md` P1, P13; E7-T03): `effectBridge(api, handlers, mountedAt)`
 * (`apps/api/src/http/bridge.ts`) serves a mini `HttpApi` through a mini Hono app built like `apps/api/src/index.ts`
 * (`onErrorHandler`, `notFoundHandler`, `app.route(mountedAt, bridge)`):
 * - status, body, `Location` and `Set-Cookie` of the Effect response pass through, an Effect refusal too;
 * - an unknown path under the bridge mount answers the Hono app's own JSON 404;
 * - `app.routes` lists the bridged `METHOD path`s (what `apps/api/test/api-doc.test.ts` reads until E7-T11);
 * - two bridges of two different mini APIs in one Hono app, plus a third bridge of the first API in a second Hono app,
 *   each answer their own routes: every bridge has its own `HttpRouter` (a shared one would have thrown `Method …
 *   already declared` when the third was built, or served the other API's routes).
 * E7-T11 deletes this file together with the bridge.
 */
import { DEFAULT_LOCALE } from "@toon/shared";
import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { Hono } from "hono";
import { apiRoutes, effectBridge, effectBridgeHandler } from "../src/http/bridge.ts";
import { setSessionCookie } from "../src/http/cookies.ts";
import { coreApi, UNINTERRUPTIBLE } from "../src/http/middleware.ts";
import { created, json, noContent, redirect } from "../src/http/response.ts";
import { errorBody, NotFound, notFoundHandler, onErrorHandler, routeUnknown } from "../src/lib/errors.ts";
import type { AppEnv } from "../src/lib/types.ts";

// ---------------------------------------------------------------------------------------------------------------
// Two mini APIs: "bridge.alpha" at /alpha, "bridge.beta" at /beta
// ---------------------------------------------------------------------------------------------------------------

const ThingParams = { thingId: Schema.String };

const AlphaGroup = HttpApiGroup.make("bridge.alpha")
  .add(
    HttpApiEndpoint.get("get", "/"),
    HttpApiEndpoint.get("getPing", "/ping"),
    HttpApiEndpoint.post("postThings", "/things"),
    HttpApiEndpoint.get("getGo", "/go"),
    HttpApiEndpoint.get("getThingsByThingId", "/things/:thingId", { params: ThingParams }),
    HttpApiEndpoint.delete("deleteThingsByThingId", "/things/:thingId", { params: ThingParams }),
  )
  .prefix("/alpha");
const AlphaApi = coreApi(HttpApi.make("bridge.alpha").add(AlphaGroup));

const alphaHandlers = HttpApiBuilder.group(AlphaApi, "bridge.alpha", (handlers) =>
  handlers
    .handle(
      "get",
      Effect.fn("bridge.alpha.get")(function* () {
        return json({ api: "alpha", root: true });
      }),
      UNINTERRUPTIBLE,
    )
    .handle(
      "getPing",
      Effect.fn("bridge.alpha.getPing")(function* () {
        return json({ api: "alpha" });
      }),
      UNINTERRUPTIBLE,
    )
    .handle(
      "postThings",
      Effect.fn("bridge.alpha.postThings")(function* () {
        yield* setSessionCookie("bridged-session", Date.now() + 60 * 60 * 1000);
        return created({ id: "t1" }, "/alpha/things/t1");
      }),
      UNINTERRUPTIBLE,
    )
    .handle(
      "getGo",
      Effect.fn("bridge.alpha.getGo")(function* () {
        return redirect("/elsewhere?from=alpha");
      }),
      UNINTERRUPTIBLE,
    )
    .handle(
      "getThingsByThingId",
      Effect.fn("bridge.alpha.getThingsByThingId")(function* ({ params }) {
        if (params.thingId !== "t1") return yield* new NotFound();
        return json({ id: params.thingId });
      }),
      UNINTERRUPTIBLE,
    )
    .handle(
      "deleteThingsByThingId",
      Effect.fn("bridge.alpha.deleteThingsByThingId")(function* () {
        return noContent();
      }),
      UNINTERRUPTIBLE,
    ),
);

const BetaGroup = HttpApiGroup.make("bridge.beta")
  .add(HttpApiEndpoint.get("getPing", "/ping"))
  .prefix("/beta");
const BetaApi = coreApi(HttpApi.make("bridge.beta").add(BetaGroup));

const betaHandlers = HttpApiBuilder.group(BetaApi, "bridge.beta", (handlers) =>
  handlers.handle(
    "getPing",
    Effect.fn("bridge.beta.getPing")(function* () {
      return json({ api: "beta" });
    }),
    UNINTERRUPTIBLE,
  ),
);

/** A Hono app built like `apps/api/src/index.ts` around the bridges. */
function honoApp(mounts: ReadonlyArray<readonly [string, Hono<AppEnv>]>): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.onError(onErrorHandler);
  app.notFound(notFoundHandler);
  for (const [mountedAt, bridge] of mounts) app.route(mountedAt, bridge);
  return app;
}

// Built at module scope, as the route files build theirs (the web handlers are built on the first request).
const first = honoApp([
  ["/alpha", effectBridge(AlphaApi, alphaHandlers, "/alpha")],
  ["/beta", effectBridge(BetaApi, betaHandlers, "/beta")],
]);
const second = honoApp([["/alpha", effectBridge(AlphaApi, alphaHandlers, "/alpha")]]);

describe("the bridge passes the Effect response through", () => {
  test("status and JSON body", async () => {
    const response = await first.request("/alpha/ping");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({ api: "alpha" });
  });

  test("the bare mount ('/' relative) answers", async () => {
    const response = await first.request("/alpha");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ api: "alpha", root: true });
  });

  test("201 with Location and the Set-Cookie of the Effect cookies", async () => {
    const response = await first.request("/alpha/things", { method: "POST" });
    expect(response.status).toBe(201);
    expect(response.headers.get("location")).toBe("/alpha/things/t1");
    expect(await response.json()).toEqual({ id: "t1" });
    const [pair, ...attributes] = (response.headers.get("set-cookie") ?? "").split("; ");
    expect(pair).toBe("toon_session=bridged-session");
    expect(attributes).toContain("HttpOnly");
    expect(attributes).toContain("Path=/");
  });

  test("302 with Location", async () => {
    const response = await first.request("/alpha/go");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/elsewhere?from=alpha");
  });

  test("a path param reaches the handler; a refusal is the Effect boundary's envelope", async () => {
    const found = await first.request("/alpha/things/t1");
    expect(found.status).toBe(200);
    expect(await found.json()).toEqual({ id: "t1" });
    const missing = await first.request("/alpha/things/t2");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual(errorBody(new NotFound(), DEFAULT_LOCALE));
  });

  test("204 without a body", async () => {
    const response = await first.request("/alpha/things/t1", { method: "DELETE" });
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });

  test("an unknown path under the mount answers the Hono app's own 404", async () => {
    const response = await first.request("/alpha/nope");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual(errorBody(routeUnknown("GET", "/alpha/nope"), DEFAULT_LOCALE));
    const wrongMethod = await first.request("/alpha/ping", { method: "POST" });
    expect(wrongMethod.status).toBe(404);
    expect(await wrongMethod.json()).toEqual(errorBody(routeUnknown("POST", "/alpha/ping"), DEFAULT_LOCALE));
  });
});

describe("the bridge registers exactly the API's routes", () => {
  test("apiRoutes lists every endpoint with its full path, in group and endpoint order", () => {
    expect(apiRoutes(AlphaApi)).toEqual([
      { method: "GET", path: "/alpha" },
      { method: "GET", path: "/alpha/ping" },
      { method: "POST", path: "/alpha/things" },
      { method: "GET", path: "/alpha/go" },
      { method: "GET", path: "/alpha/things/:thingId" },
      { method: "DELETE", path: "/alpha/things/:thingId" },
    ]);
  });

  test("app.routes lists the bridged METHOD paths of both bridges, and nothing else", () => {
    const listed = first.routes.map((route) => `${route.method} ${route.path}`);
    expect(listed).toEqual([
      "GET /alpha",
      "GET /alpha/ping",
      "POST /alpha/things",
      "GET /alpha/go",
      "GET /alpha/things/:thingId",
      "DELETE /alpha/things/:thingId",
      "GET /beta/ping",
    ]);
  });

  test("a mount the API's paths do not lie below is refused at construction", () => {
    expect(() => effectBridge(BetaApi, betaHandlers, "/alpha")).toThrow("is not below the mount");
  });
});

describe("three bridges in two Hono apps each answer their own routes (P13)", () => {
  test("the first app serves alpha and beta, the second alpha only", async () => {
    const results = await Promise.all([
      first.request("/alpha/ping"),
      first.request("/beta/ping"),
      second.request("/alpha/ping"),
      second.request("/beta/ping"),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 404]);
    expect(await results[0]!.json()).toEqual({ api: "alpha" });
    expect(await results[1]!.json()).toEqual({ api: "beta" });
    expect(await results[2]!.json()).toEqual({ api: "alpha" });
  });

  test("each bridge's Effect router holds its own API only", async () => {
    const beta = effectBridgeHandler(BetaApi, betaHandlers);
    const alpha = effectBridgeHandler(AlphaApi, alphaHandlers);
    expect((await beta.request("/beta/ping")).status).toBe(200);
    expect((await beta.request("/alpha/ping")).status).toBe(404);
    expect((await alpha.request("/alpha/ping")).status).toBe(200);
    expect((await alpha.request("/beta/ping")).status).toBe(404);
  });
});
