/**
 * The subscription feed through the real app (plan `docs/plans/m9-calendar-feed.md` M9-T05; P2-P7, P13; ADR 0017):
 *
 * - management `…/calendar/feed`: create 201 with the url shape, GET never carries a token or a url, PATCH keeps the
 *   token, PATCH 404 without a link, a replace kills the old url, DELETE 204 twice, `403 email_unverified` on each write
 *   under the verified-e-mail gate (reads pass), no cookie 401, a non-member 403, the module off `404 module_disabled`;
 * - the public route `GET /api/calendar/feed/:file`: reachable WITHOUT a cookie (a foreign cookie is ignored), 200 with
 *   the four headers and a parseable body, the SAME 404 body for an unknown, malformed, rotated or revoked token, a
 *   removed member and a disabled module, ETag -> 304, HEAD 200 without a body, an unknown token never 429 (no bucket), the 61st fetch in an hour 429 with
 *   `Retry-After`, `last_used_at` set by a fetch;
 * - the request log over the real routes never prints the token.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { DateTime, Effect, Layer } from "effect";
import { checkIn } from "../src/core/services/auth/rateLimit.ts";
import { hashToken } from "../src/core/services/auth/tokens.ts";
import { setVerifiedEmailRequired } from "../src/core/services/auth/verifiedEmail.ts";
import { db } from "../src/db/client.ts";
import { users } from "../src/db/schema.ts";
import { globalHttpLayer } from "../src/http/global.ts";
import { httpMiddlewareLayer } from "../src/http/middleware-layer.ts";
import { API_MODULES } from "../src/modules/index.ts";
import { CALENDAR_FEED_RULE, feedRateLimitKey } from "../src/modules/calendar/services/feed/tokens.service.ts";
import { moduleRoutesLayer } from "../src/modules/mount.ts";
import { runMigrations } from "./support/bridges/migrate.ts";
import { calendarNameOf, feedPathOf, parseIcsEvents } from "./support/calendar-feed.ts";
import {
  type TestUser,
  addMember,
  body,
  calendarPath,
  call,
  createCalendarHousehold,
  createUser,
  enableCalendar,
} from "./support/calendar-harness.ts";
import { testHttpApp } from "./support/http.ts";
import { addCalendarDays } from "@toon/shared";

await runMigrations(db);

afterAll(() => {
  setVerifiedEmailRequired(null);
});

/** The live Clock's date in Berlin, as the feed computes it (the route runs on the live clock). */
function berlinToday(): string {
  return DateTime.formatIsoDate(DateTime.makeZonedUnsafe(DateTime.nowUnsafe(), { timeZone: "Europe/Berlin" }));
}

interface Created {
  url: string;
  scope: string;
  createdAt: string;
  lastUsedAt: string | null;
}

interface ErrorBody {
  error: { code: string; message: string };
}

async function home(label: string): Promise<{ owner: TestUser; householdId: string }> {
  const owner = await createUser("Eric");
  const householdId = await createCalendarHousehold(owner, `${label} ${crypto.randomUUID().slice(0, 6)}`);
  return { owner, householdId };
}

async function createLink(householdId: string, user: TestUser, scope: "all" | "mine" = "all"): Promise<Created> {
  const response = await call(calendarPath(householdId, "/feed"), { method: "POST", cookie: user.cookie, body: { scope } });
  if (response.status !== 201) throw new Error(`create link failed: ${response.status} ${await response.text()}`);
  return body<Created>(response);
}

const fetchFeed = (url: string, headers: Record<string, string> = {}, method = "GET") =>
  call(feedPathOf(url), { method, headers });

describe("management: …/calendar/feed (P13)", () => {
  test("POST creates (201, url shape, no lastUsedAt); GET shows it without token or url; PATCH keeps the token", async () => {
    const { owner, householdId } = await home("Abo");
    const before = await call(calendarPath(householdId, "/feed"), { cookie: owner.cookie });
    expect(before.status).toBe(200);
    expect(await before.json()).toEqual({ feed: null });

    const created = await createLink(householdId, owner, "mine");
    expect(Object.keys(created).sort()).toEqual(["createdAt", "lastUsedAt", "scope", "url"]);
    expect(created).toMatchObject({ scope: "mine", lastUsedAt: null });
    expect(created.url).toMatch(/^https?:\/\/[^/]+\/api\/calendar\/feed\/[A-Za-z0-9_-]{43}\.ics$/);
    const token = created.url.slice(created.url.lastIndexOf("/") + 1, -".ics".length);

    const got = await call(calendarPath(householdId, "/feed"), { cookie: owner.cookie });
    const text = await got.text();
    expect(JSON.parse(text)).toEqual({ feed: { scope: "mine", createdAt: created.createdAt, lastUsedAt: null } });
    expect(text).not.toContain(token);
    expect(text).not.toContain("url");

    const patched = await call(calendarPath(householdId, "/feed"), { method: "PATCH", cookie: owner.cookie, body: { scope: "all" } });
    expect(patched.status).toBe(200);
    const patchedText = await patched.text();
    expect(JSON.parse(patchedText)).toEqual({ feed: { scope: "all", createdAt: created.createdAt, lastUsedAt: null } });
    expect(patchedText).not.toContain(token);
    expect((await fetchFeed(created.url)).status).toBe(200);
  });

  test("POST again REPLACES the link: the old url is 404 at once, the new one 200", async () => {
    const { owner, householdId } = await home("Neu");
    const first = await createLink(householdId, owner);
    expect((await fetchFeed(first.url)).status).toBe(200);
    const second = await createLink(householdId, owner);
    expect(second.url).not.toBe(first.url);
    expect((await fetchFeed(first.url)).status).toBe(404);
    expect((await fetchFeed(second.url)).status).toBe(200);
  });

  test("PATCH without a link is 404; DELETE is 204 twice and ends the link; a bad scope is 422", async () => {
    const { owner, householdId } = await home("Ende");
    const missing = await call(calendarPath(householdId, "/feed"), { method: "PATCH", cookie: owner.cookie, body: { scope: "all" } });
    expect(missing.status).toBe(404);
    expect((await body<ErrorBody>(missing)).error.code).toBe("not_found");
    const created = await createLink(householdId, owner);
    for (let round = 0; round < 2; round += 1) {
      const removed = await call(calendarPath(householdId, "/feed"), { method: "DELETE", cookie: owner.cookie });
      expect(removed.status).toBe(204);
      expect(await removed.text()).toBe("");
    }
    expect((await fetchFeed(created.url)).status).toBe(404);
    expect(await body<unknown>(await call(calendarPath(householdId, "/feed"), { cookie: owner.cookie }))).toEqual({ feed: null });
    const invalid = await call(calendarPath(householdId, "/feed"), { method: "POST", cookie: owner.cookie, body: { scope: "everything" } });
    expect(invalid.status).toBe(422);
    expect((await body<ErrorBody>(invalid)).error.code).toBe("validation_failed");
  });

  test("each member has their own link; one's DELETE leaves the other's", async () => {
    const { owner, householdId } = await home("Zwei");
    const robin = await createUser("Robin");
    await addMember(owner, householdId, robin);
    const ownerLink = await createLink(householdId, owner);
    const robinLink = await createLink(householdId, robin, "mine");
    await call(calendarPath(householdId, "/feed"), { method: "DELETE", cookie: robin.cookie });
    expect((await fetchFeed(robinLink.url)).status).toBe(404);
    expect((await fetchFeed(ownerLink.url)).status).toBe(200);
  });

  test("the chain: no cookie 401, a non-member 403, the calendar off 404 module_disabled", async () => {
    const { owner, householdId } = await home("Kette");
    const stranger = await createUser("Fremd");
    for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
      const anonymous = await call(calendarPath(householdId, "/feed"), { method, body: method === "GET" || method === "DELETE" ? undefined : { scope: "all" } });
      expect(anonymous.status).toBe(401);
      const foreign = await call(calendarPath(householdId, "/feed"), {
        method,
        cookie: stranger.cookie,
        body: method === "GET" || method === "DELETE" ? undefined : { scope: "all" },
      });
      expect(foreign.status).toBe(403);
    }
    const off = await call(`/api/households/${householdId}/modules/calendar`, { method: "DELETE", cookie: owner.cookie });
    expect(off.status).toBe(204);
    const disabled = await call(calendarPath(householdId, "/feed"), { cookie: owner.cookie });
    expect(disabled.status).toBe(404);
    expect((await body<ErrorBody>(disabled)).error.code).toBe("module_disabled");
  });

  test("an unconfirmed account under the gate: every write 403 email_unverified, the read passes", async () => {
    const { owner, householdId } = await home("Gate");
    await createLink(householdId, owner);
    await db.update(users).set({ emailVerified: false, emailVerifiedAt: null }).where(eq(users.id, owner.id));
    setVerifiedEmailRequired(true);
    try {
      for (const [method, payload] of [
        ["POST", { scope: "all" }],
        ["PATCH", { scope: "mine" }],
        ["DELETE", undefined],
      ] as const) {
        const refused = await call(calendarPath(householdId, "/feed"), { method, cookie: owner.cookie, body: payload });
        expect(refused.status).toBe(403);
        expect((await body<ErrorBody>(refused)).error.code).toBe("email_unverified");
      }
      const read = await call(calendarPath(householdId, "/feed"), { cookie: owner.cookie });
      expect(read.status).toBe(200);
      expect((await body<{ feed: { scope: string } }>(read)).feed.scope).toBe("all");
    } finally {
      setVerifiedEmailRequired(null);
    }
  });
});

describe("the feed: GET /api/calendar/feed/:file (P2-P7)", () => {
  test("200 without a cookie, the four headers, a parseable calendar of the household", async () => {
    const { owner, householdId } = await home("Feed");
    const today = berlinToday();
    await call(calendarPath(householdId, "/entries"), {
      method: "POST",
      cookie: owner.cookie,
      body: { kind: "event", title: "Elternabend, Raum 3", allDay: false, startDate: addCalendarDays(today, 2), startTime: "19:30" },
    });
    const { url } = await createLink(householdId, owner);

    const response = await fetchFeed(url);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe('inline; filename="haushalt.ics"');
    expect(response.headers.get("cache-control")).toBe("private, max-age=300");
    expect(response.headers.get("etag")).toMatch(/^"[0-9a-f]{64}"$/);
    expect(response.headers.get("set-cookie")).toBeNull();
    // The global security headers apply as to every response.
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");

    const text = await response.text();
    expect(text.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(calendarNameOf(text)).toMatch(/^Haushalt · Feed \w+$/);
    const events = parseIcsEvents(text);
    expect(events.map((item) => item.summary)).toEqual(["Elternabend, Raum 3"]);
    expect(events[0]!.raw.get("DTSTART;TZID=Europe/Berlin")).toBe(`${addCalendarDays(today, 2).replace(/-/g, "")}T193000`);
    expect(events[0]!.description).toBe("Für: Alle");

    const link = await body<{ feed: { lastUsedAt: string | null } }>(await call(calendarPath(householdId, "/feed"), { cookie: owner.cookie }));
    expect(link.feed.lastUsedAt).not.toBeNull();
  });

  test("a foreign or garbage cookie changes nothing", async () => {
    const { owner, householdId } = await home("Keks");
    const stranger = await createUser("Fremd");
    const { url } = await createLink(householdId, owner);
    const plain = await (await fetchFeed(url)).text();
    for (const cookie of [stranger.cookie, owner.cookie, "toon_session=nonsense"]) {
      const response = await fetchFeed(url, { Cookie: cookie });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(plain);
    }
  });

  test("every refusal is the SAME 404: malformed, unknown, rotated, revoked, a removed member, the calendar off", async () => {
    const { owner, householdId } = await home("Nein");
    const robin = await createUser("Robin");
    await addMember(owner, householdId, robin);
    const rotated = await createLink(householdId, owner);
    await createLink(householdId, owner);
    const revoked = await createLink(householdId, robin);
    const robinsSecond = (await call(calendarPath(householdId, "/feed"), { method: "DELETE", cookie: robin.cookie })).status;
    expect(robinsSecond).toBe(204);
    const leaver = await createUser("Geht");
    await addMember(owner, householdId, leaver);
    const leaverLink = await createLink(householdId, leaver);
    expect((await call(`/api/households/${householdId}/members/${leaver.id}`, { method: "DELETE", cookie: owner.cookie })).status).toBe(204);

    const other = await home("Aus");
    const offLink = await createLink(other.householdId, other.owner);
    expect((await call(`/api/households/${other.householdId}/modules/calendar`, { method: "DELETE", cookie: other.owner.cookie })).status).toBe(204);

    const paths = [
      "/api/calendar/feed/kurz.ics",
      `/api/calendar/feed/${"a".repeat(43)}.txt`,
      `/api/calendar/feed/${"a".repeat(43)}`,
      `/api/calendar/feed/${"%2F".repeat(15)}.ics`,
      `/api/calendar/feed/${"A".repeat(43)}.ics`,
      feedPathOf(rotated.url),
      feedPathOf(revoked.url),
      feedPathOf(leaverLink.url),
      feedPathOf(offLink.url),
    ];
    const bodies = new Set<string>();
    for (const path of paths) {
      const response = await call(path);
      expect([path, response.status]).toEqual([path, 404]);
      bodies.add(await response.text());
    }
    expect(bodies.size).toBe(1);
    const [only] = [...bodies];
    expect(JSON.parse(only!)).toEqual({ error: { code: "not_found", message: expect.any(String) } });

    // Enabling the calendar again brings the disabled household's link back (its row was kept).
    await enableCalendar(other.owner, other.householdId);
    expect((await fetchFeed(offLink.url)).status).toBe(200);
  });

  test("If-None-Match with the ETag (also weak, in a list, or *) answers 304 with ETag and Cache-Control, no body", async () => {
    const { owner, householdId } = await home("Etag");
    const { url } = await createLink(householdId, owner);
    const first = await fetchFeed(url);
    const etag = first.headers.get("etag")!;
    for (const value of [etag, `W/${etag}`, `"nope", ${etag}`, "*"]) {
      const cached = await fetchFeed(url, { "If-None-Match": value });
      expect(cached.status).toBe(304);
      expect(cached.headers.get("etag")).toBe(etag);
      expect(cached.headers.get("cache-control")).toBe("private, max-age=300");
      expect(await cached.text()).toBe("");
    }
    expect((await fetchFeed(url, { "If-None-Match": '"something-else"' })).status).toBe(200);

    // A change to the calendar changes the ETag.
    await call(calendarPath(householdId, "/entries"), {
      method: "POST",
      cookie: owner.cookie,
      body: { kind: "event", title: "Neu", allDay: true, startDate: berlinToday() },
    });
    const changed = await fetchFeed(url, { "If-None-Match": etag });
    expect(changed.status).toBe(200);
    expect(changed.headers.get("etag")).not.toBe(etag);
  });

  test("HEAD answers 200 with the headers and no body", async () => {
    const { owner, householdId } = await home("Kopf");
    const { url } = await createLink(householdId, owner);
    const head = await fetchFeed(url, {}, "HEAD");
    expect(head.status).toBe(200);
    expect(head.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(head.headers.get("etag")).toMatch(/^"[0-9a-f]{64}"$/);
    expect(await head.text()).toBe("");
  });

  test("60 fetches an hour per token; the 61st is 429 with Retry-After (a 304 counts)", async () => {
    const { owner, householdId } = await home("Limit");
    const { url } = await createLink(householdId, owner);
    const first = await fetchFeed(url);
    expect(first.status).toBe(200);
    const etag = first.headers.get("etag")!;
    for (let fetch = 2; fetch <= 60; fetch += 1) {
      const response = await fetchFeed(url, fetch % 2 === 0 ? { "If-None-Match": etag } : {});
      expect(response.status).toBe(fetch % 2 === 0 ? 304 : 200);
    }
    const limited = await fetchFeed(url);
    expect(limited.status).toBe(429);
    expect((await body<ErrorBody>(limited)).error.code).toBe("rate_limited");
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    // Another member's link has a bucket of its own.
    const robin = await createUser("Robin");
    await addMember(owner, householdId, robin);
    expect((await fetchFeed((await createLink(householdId, robin)).url)).status).toBe(200);
  });

  test("an unknown token opens no rate-limit bucket: the 61st miss is still 404 (M9-T09 review)", async () => {
    const guess = `/api/calendar/feed/${"Q".repeat(43)}.ics`;
    for (let fetch = 1; fetch <= 61; fetch += 1) {
      const response = await call(guess);
      expect([fetch, response.status]).toEqual([fetch, 404]);
    }
    // The guess's bucket is untouched: this first recorded attempt leaves 59 of 60.
    const probe = await Effect.runPromise(checkIn(feedRateLimitKey(hashToken("Q".repeat(43))), CALENDAR_FEED_RULE));
    expect(probe.remaining).toBe(CALENDAR_FEED_RULE.limit - 1);
  });

  test("a stored link of a household with the calendar off is 404 on every fetch, never 429 (M9-fix: never say which)", async () => {
    const { owner, householdId } = await home("AusLimit");
    const { url } = await createLink(householdId, owner);
    expect((await call(`/api/households/${householdId}/modules/calendar`, { method: "DELETE", cookie: owner.cookie })).status).toBe(204);
    for (let fetch = 1; fetch <= 61; fetch += 1) {
      const response = await fetchFeed(url);
      expect([fetch, response.status]).toEqual([fetch, 404]);
    }
    // The refused link opened no bucket: this first recorded attempt leaves 59 of 60.
    const token = url.slice(url.lastIndexOf("/") + 1, -".ics".length);
    const probe = await Effect.runPromise(checkIn(feedRateLimitKey(hashToken(token)), CALENDAR_FEED_RULE));
    expect(probe.remaining).toBe(CALENDAR_FEED_RULE.limit - 1);
  });

  test("other methods on the feed path are not served by the feed (the global JSON 404)", async () => {
    const { owner, householdId } = await home("Methode");
    const { url } = await createLink(householdId, owner);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await fetchFeed(url, {}, method);
      expect([method, response.status]).toEqual([method, 404]);
    }
    expect((await fetchFeed(url)).status).toBe(200);
  });
});

describe("the request log over the real feed route (P15)", () => {
  test("both lines show /api/calendar/feed/<redacted>.ics, never the token", async () => {
    const { owner, householdId } = await home("Log");
    const { url } = await createLink(householdId, owner);
    const token = url.slice(url.lastIndexOf("/") + 1, -".ics".length);
    const lines: string[] = [];
    const logged = testHttpApp(
      [],
      Layer.empty,
      Layer.mergeAll(
        globalHttpLayer({ requestLog: true, logLine: (line) => lines.push(line), webDistDir: null, webOrigins: [] }),
        moduleRoutesLayer(API_MODULES),
      ).pipe(Layer.provideMerge(httpMiddlewareLayer())),
    );
    const ok = await logged.request(feedPathOf(url));
    expect(ok.status).toBe(200);
    const unknown = await logged.request(`/api/calendar/feed/${"B".repeat(43)}.ics`);
    expect(unknown.status).toBe(404);
    expect(lines).toHaveLength(4);
    expect(lines.filter((line) => line.includes("/api/calendar/feed/<redacted>.ics"))).toHaveLength(4);
    expect(lines.join("\n")).not.toContain(token);
    expect(lines.join("\n")).not.toContain("B".repeat(43));
  });

  test("a path the router serves despite doubled slashes or another case is redacted too (M9-fix)", async () => {
    const { owner, householdId } = await home("LogSlash");
    const { url } = await createLink(householdId, owner);
    const token = url.slice(url.lastIndexOf("/") + 1, -".ics".length);
    const lines: string[] = [];
    const logged = testHttpApp(
      [],
      Layer.empty,
      Layer.mergeAll(
        globalHttpLayer({ requestLog: true, logLine: (line) => lines.push(line), webDistDir: null, webOrigins: [] }),
        moduleRoutesLayer(API_MODULES),
      ).pipe(Layer.provideMerge(httpMiddlewareLayer())),
    );
    const variants = [
      `/api//calendar/feed/${token}.ics`,
      `//api/calendar/feed/${token}.ics`,
      `/api/calendar//feed/${token}.ics`,
      `/API/Calendar/Feed/${token}.ics`,
    ];
    for (const path of variants) {
      const response = await logged.request(path);
      // The router serves every variant: the redaction must follow it.
      expect([path, response.status]).toEqual([path, 200]);
    }
    expect(lines).toHaveLength(variants.length * 2);
    expect(lines.every((line) => /\/api\/calendar\/feed\/<redacted>\.ics/i.test(line))).toBe(true);
    expect(lines.join("\n")).not.toContain(token);
  });
});
