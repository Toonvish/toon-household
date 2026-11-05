/**
 * The API's one decode path (`apps/api/src/lib/validate.ts`, plan e1 P8/P9) and its error boundary
 * (`toApiError` in `apps/api/src/lib/errors.ts`): a refused value is `422 validation_failed` whose `details` are
 * `toValidationIssues` in the negotiated locale (ADR 0013), whatever schema kind refused it.
 */
import { describe, expect, test } from "bun:test";
import {
  ALL_ISSUES,
  CoercedInt,
  Email,
  type Locale,
  Str,
  Uuid,
  lowercase,
  max,
  maxLength,
  min,
  minLength,
  toValidationIssues,
  trim,
} from "@toon/shared";
import { Effect, Option, Result, Schema } from "effect";
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { coreApi, UNINTERRUPTIBLE } from "../src/http/middleware.ts";
import { jsonBody, queryParams, rawJsonOrDie } from "../src/http/request.ts";
import { json } from "../src/http/response.ts";
import { type Decodable, type Decoded, decode, decodeOption, decodeOrThrow } from "../src/lib/validate.ts";
import { type InMemoryApp, testHttpApp } from "./support/http.ts";

/** `true` only when `A` and `B` are the same type (readonly and optional modifiers included). */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: Array<{ path: string; code: string; message: string; i18n?: { key: string; values: unknown } }>;
  };
}

const LOCALES: ReadonlyArray<Locale> = ["de", "en"];

const UUID = "6f1c1c64-5d3b-4f63-9a51-0d6c7f1d2a10";

const Body = Schema.Struct({
  name: Str.pipe(trim).check(minLength(1)),
  email: Str.check(maxLength(254)).pipe(trim, lowercase, Schema.decodeTo(Email)),
});
const Query = Schema.Struct({
  limit: CoercedInt.check(min(1), max(100)).pipe(Schema.withDecodingDefault(Effect.succeed(24))),
  offset: CoercedInt.check(min(0)).pipe(Schema.withDecodingDefault(Effect.succeed(0))),
});
const Params = Schema.Struct({ id: Uuid });

/**
 * One mini API per schema kind: a JSON body (`jsonBody`), a query (`queryParams`), a route param (declared as a
 * string, decoded in the handler as the ports do, plan P3) and a handler that decodes by hand and throws.
 */
const ValidateGroup = HttpApiGroup.make("validate.probe").add(
  HttpApiEndpoint.post("postBody", "/body"),
  HttpApiEndpoint.get("getList", "/list"),
  HttpApiEndpoint.get("getItem", "/items/:id", { params: { id: Schema.String } }),
  HttpApiEndpoint.post("postByHand", "/by-hand"),
  HttpApiEndpoint.post("postTyped", "/typed"),
);
const ValidateApi = coreApi(HttpApi.make("validate.probe").add(ValidateGroup));

const validateHandlers = HttpApiBuilder.group(ValidateApi, "validate.probe", (handlers) =>
  handlers
    .handle(
      "postBody",
      Effect.fn("validate.probe.postBody")(function* () {
        return json({ value: yield* jsonBody(Body) });
      }),
      UNINTERRUPTIBLE,
    )
    .handle(
      "getList",
      Effect.fn("validate.probe.getList")(function* () {
        return json({ value: yield* queryParams(Query) });
      }),
      UNINTERRUPTIBLE,
    )
    .handle(
      "getItem",
      Effect.fn("validate.probe.getItem")(function* ({ params }) {
        return json({ value: yield* decode(Params, params) });
      }),
      UNINTERRUPTIBLE,
    )
    .handle(
      "postByHand",
      Effect.fn("validate.probe.postByHand")(function* () {
        // decodeOrThrow throws the SchemaError synchronously: a defect the boundary maps to the same 422.
        return json({ value: decodeOrThrow(Body, yield* rawJsonOrDie) });
      }),
      UNINTERRUPTIBLE,
    )
    .handle(
      "postTyped",
      Effect.fn("validate.probe.postTyped")(function* () {
        const value = yield* jsonBody(Body);
        const sameAsValid: Equals<typeof value, { name: string; email: string }> = true;
        value.name = value.name.toUpperCase();
        return json({ value, sameAsValid });
      }),
      UNINTERRUPTIBLE,
    ),
);

function postJson(app: InMemoryApp, path: string, payload: unknown, locale: Locale = "de"): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept-Language": locale },
    body: JSON.stringify(payload),
  });
}

function get(app: InMemoryApp, path: string, locale: Locale = "de"): Promise<Response> {
  return app.request(path, { headers: { "Accept-Language": locale } });
}

describe("validate with shared schemas", () => {
  const app = testHttpApp([ValidateApi], validateHandlers);

  /** What the adapter makes of `input` for `schema`: the expected `details`. */
  function issuesOf(schema: Decodable, input: unknown, locale: Locale) {
    const result = Schema.decodeUnknownResult(schema as Schema.Decoder<unknown, never>, ALL_ISSUES)(input);
    if (Result.isSuccess(result)) throw new Error("the input was expected to fail");
    return toValidationIssues(result.failure.issue, locale);
  }

  test("a refused body is 422 validation_failed with the adapter's details in de and en", async () => {
    const payload = { name: " ", email: "nope" };
    for (const locale of LOCALES) {
      const res = await postJson(app, "/body", payload, locale);
      expect(res.status).toBe(422);
      const body = (await res.json()) as ErrorBody;
      expect(body.error.code).toBe("validation_failed");
      expect(body.error.details).toEqual(issuesOf(Body, payload, locale));
      expect(body.error.details?.map((d) => [d.path, d.code])).toEqual([
        ["name", "too_small"],
        ["email", "invalid_format"],
      ]);
      expect(body.error.details?.every((d) => (d.i18n?.key ?? "").length > 0)).toBe(true);
    }
    const [de, en] = await Promise.all(LOCALES.map((l) => postJson(app, "/body", payload, l).then((r) => r.json())));
    expect((de as ErrorBody).error.details?.[0]?.message).not.toBe((en as ErrorBody).error.details?.[0]?.message);
  });

  test("a valid body reaches the handler decoded through jsonBody", async () => {
    const res = await postJson(app, "/body", { name: "  Kim ", email: " KIM@Example.ORG ", extra: 1 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ value: { name: "Kim", email: "kim@example.org" } });
  });

  test("a query is decoded with its defaults and coercions", async () => {
    expect(await (await get(app, "/list")).json()).toEqual({ value: { limit: 24, offset: 0 } });
    expect(await (await get(app, "/list?limit=5&offset=10")).json()).toEqual({ value: { limit: 5, offset: 10 } });
  });

  test("a JSON route without a JSON Content-Type validates {}", async () => {
    const res = await app.request("/body", {
      method: "POST",
      headers: { "Content-Type": "text/plain", "Accept-Language": "en" },
      body: JSON.stringify({ name: "Kim", email: "kim@example.org" }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.details).toEqual(issuesOf(Body, {}, "en"));
    expect(body.error.details?.map((d) => [d.path, d.code])).toEqual([
      ["name", "invalid_type"],
      ["email", "invalid_type"],
    ]);
  });

  test("malformed JSON is 400 bad_request", async () => {
    const res = await app.request("/body", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe("bad_request");
    expect(body.error.details).toBeUndefined();
  });

  test("a repeated query key is refused", async () => {
    const res = await get(app, "/list?limit=1&limit=2", "en");
    expect(res.status).toBe(422);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.details).toEqual(issuesOf(Query, { limit: ["1", "2"] }, "en"));
    expect(body.error.details?.map((d) => d.path)).toEqual(["limit"]);
  });

  test("a route param is validated", async () => {
    expect(await (await get(app, `/items/${UUID}`)).json()).toEqual({ value: { id: UUID } });
    const res = await get(app, "/items/not-a-uuid", "en");
    expect(res.status).toBe(422);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.details).toEqual(issuesOf(Params, { id: "not-a-uuid" }, "en"));
    expect(body.error.details?.map((d) => [d.path, d.code])).toEqual([["id", "invalid_format"]]);
  });

  test("decodeOrThrow behind ApiErrorBoundary gives the same envelope", async () => {
    const payload = { name: "", email: "nope" };
    for (const locale of LOCALES) {
      const viaValidate = await postJson(app, "/body", payload, locale);
      const byHand = await postJson(app, "/by-hand", payload, locale);
      expect(byHand.status).toBe(422);
      expect(await byHand.json()).toEqual(await viaValidate.json());
    }
    const ok = await postJson(app, "/by-hand", { name: " Kim", email: "Kim@Example.org" });
    expect(await ok.json()).toEqual({ value: { name: "Kim", email: "kim@example.org" } });
  });

  test("decodeOption returns the decoded value or Option.none() and never throws", () => {
    expect(decodeOption(Body, { name: " Kim ", email: "KIM@example.org" })).toEqual(
      Option.some({ name: "Kim", email: "kim@example.org" }),
    );
    expect(Option.isNone(decodeOption(Body, { name: "", email: "nope" }))).toBe(true);
    expect(() => decodeOption(Body, 42)).not.toThrow();
    expect(Option.isNone(decodeOption(Body, 42))).toBe(true);
  });

  test("compile time: jsonBody and Decoded give the decoded, mutable type", async () => {
    // The `Equals` check on the type `jsonBody` yields sits in the `postTyped` handler above (a tsc error otherwise).
    const decodedIsMutable: Equals<Decoded<typeof Body>, { name: string; email: string }> = true;
    const queryDecoded: Equals<Decoded<typeof Query>, { limit: number; offset: number }> = true;
    expect([decodedIsMutable, queryDecoded]).toEqual([true, true]);
    const res = await postJson(app, "/typed", { name: "kim", email: "kim@example.org" });
    expect(await res.json()).toEqual({ value: { name: "KIM", email: "kim@example.org" }, sameAsValid: true });
  });
});
