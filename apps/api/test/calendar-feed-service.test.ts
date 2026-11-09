/**
 * The feed services (plan `docs/plans/m9-calendar-feed.md` M9-T04; P3, P4, P7, P8, P9, P10, P12, P14) on the shared test
 * database and the app runtime, time on a `TestClock`:
 *
 *   the window [today - 30, today + 365] around the Clock's date in Europe/Berlin (31 back out, 30 back in, + 365 in,
 *   + 366 out; the Berlin date, not the UTC one), a daily task yielding 396 VEVENTs, scope `mine` (everybody, me,
 *   another; a rotation where every second occurrence is mine; a waste pickup unassigned, mine, another's; car bookings),
 *   skipped omitted and done marked, the locale from `users.locale`, the replaced and the removed token unknown,
 *   `last_used_at` written at most once an hour, and the member-removal hook deleting the leaver's row only.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { db } from "../src/db/client.ts";
import { users } from "../src/db/schema.ts";
import { calendarFeedTokens } from "../src/modules/calendar/schema.ts";
import { CalendarFeed, feedWindow } from "../src/modules/calendar/services/feed/feed.service.ts";
import { CalendarFeedTokens } from "../src/modules/calendar/services/feed/tokens.service.ts";
import { runMigrations } from "./support/bridges/migrate.ts";
import {
  type TestUser,
  addMember,
  addPlaceholder,
  body,
  calendarPath,
  call,
  createCalendarHousehold,
  createUser,
} from "./support/calendar-harness.ts";
import { calendarNameOf, feedFileOf, insertWastePickup, parseIcsEvents } from "./support/calendar-feed.ts";
import { type AppServices, runTest } from "./support/effect.ts";

await runMigrations(db);

/** 2027-03-14 11:00 in Berlin (CET): today is 2027-03-14, the window 2027-02-12 .. 2028-03-13. */
const NOON = Date.UTC(2027, 2, 14, 10, 0);
/** 2027-03-14 23:30 UTC is 2027-03-15 00:30 in Berlin: today is the 15th. */
const AFTER_BERLIN_MIDNIGHT = Date.UTC(2027, 2, 14, 23, 30);

/** Runs `effect` with the TestClock set to `ms`. */
function at<A, E>(ms: number, effect: Effect.Effect<A, E, AppServices>): Promise<A> {
  return runTest(
    Effect.gen(function* () {
      yield* TestClock.setTime(ms);
      return yield* effect;
    }),
    { clock: "test" },
  );
}

const createLink = (householdId: string, userId: string, scope: "all" | "mine", ms = NOON) =>
  at(ms, CalendarFeedTokens.use((tokens) => tokens.create(householdId, userId, scope)));

/** Resolves the url's token and renders the feed at `ms`. */
const render = (url: string, ms = NOON) =>
  at(
    ms,
    Effect.gen(function* () {
      const tokens = yield* CalendarFeedTokens;
      const feed = yield* CalendarFeed;
      return yield* feed.render(yield* tokens.resolve(feedFileOf(url)));
    }),
  );

const resolveFails = (url: string) =>
  at(NOON, Effect.flip(CalendarFeedTokens.use((tokens) => tokens.resolve(feedFileOf(url)))));

async function createEntry(householdId: string, user: TestUser, payload: Record<string, unknown>): Promise<string> {
  const response = await call(calendarPath(householdId, "/entries"), { method: "POST", cookie: user.cookie, body: payload });
  if (response.status !== 201) throw new Error(`create failed: ${response.status} ${await response.text()}`);
  return (await body<{ id: string }>(response)).id;
}

const event = (title: string, startDate: string, extra: Record<string, unknown> = {}) => ({
  kind: "event",
  title,
  allDay: true,
  startDate,
  ...extra,
});

describe("the window (P8)", () => {
  let url = "";
  beforeAll(async () => {
    const owner = await createUser("Eric");
    const home = await createCalendarHousehold(owner, `Fenster ${crypto.randomUUID().slice(0, 6)}`);
    await createEntry(home, owner, event("Vor 31", "2027-02-11"));
    await createEntry(home, owner, event("Vor 30", "2027-02-12"));
    await createEntry(home, owner, event("Lang", "2027-02-08", { endDate: "2027-02-12" }));
    await createEntry(home, owner, event("In 365", "2028-03-13"));
    await createEntry(home, owner, event("In 366", "2028-03-14"));
    url = (await createLink(home, owner.id, "all")).url;
  });

  test("feedWindow: 30 days back, 365 ahead", () => {
    expect(feedWindow("2027-03-14")).toEqual({ from: "2027-02-12", to: "2028-03-13" });
  });

  test("31 days back is out, 30 back is in (a multi-day event reaching into it too), + 365 in, + 366 out", async () => {
    const summaries = parseIcsEvents((await render(url)).body).map((item) => item.summary);
    expect(summaries).toEqual(["Lang", "Vor 30", "In 365"]);
  });

  test("today is the Berlin date: at 23:30 UTC on the 14th the window has moved one day", async () => {
    const summaries = parseIcsEvents((await render(url, AFTER_BERLIN_MIDNIGHT)).body).map((item) => item.summary);
    expect(summaries).toEqual(["In 365", "In 366"]);
  });

  test("an unchanged calendar renders the same body and ETag on every fetch; the ETag is the body's SHA-256", async () => {
    const first = await render(url);
    const second = await render(url);
    expect(second.body).toBe(first.body);
    expect(second.etag).toBe(first.etag);
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(first.body);
    expect(first.etag).toBe(`"${hasher.digest("hex")}"`);
  });
});

describe("a daily task over the whole window", () => {
  test("yields 396 VEVENTs, first and last at the window's edges, UIDs unique and stable", async () => {
    const owner = await createUser("Eric");
    const home = await createCalendarHousehold(owner, `Taeglich ${crypto.randomUUID().slice(0, 6)}`);
    const entryId = await createEntry(home, owner, {
      kind: "task",
      title: "Lüften",
      allDay: true,
      startDate: "2026-01-01",
      repeat: { freq: "daily" },
    });
    const { url } = await createLink(home, owner.id, "all");
    const events = parseIcsEvents((await render(url)).body);
    expect(events).toHaveLength(396);
    expect(events[0]!.dtstart).toBe("20270212");
    expect(events.at(-1)!.dtstart).toBe("20280313");
    expect(events[0]!.uid).toBe(`${entryId}-2027-02-12@toon-household`);
    expect(new Set(events.map((item) => item.uid)).size).toBe(396);
    expect(events[0]!.raw.get("TRANSP")).toBe("TRANSPARENT");
  });
});

describe("scope, states and locale (P9, P10, P12)", () => {
  let owner: TestUser;
  let robin: TestUser;
  let home = "";
  let mine = "";
  let all = "";

  beforeAll(async () => {
    owner = await createUser("Eric");
    home = await createCalendarHousehold(owner, `Meine ${crypto.randomUUID().slice(0, 6)}`);
    robin = await createUser("Robin");
    await addMember(owner, home, robin);
    const kimId = await addPlaceholder(owner, home, "Kim");

    await createEntry(home, owner, event("Für alle", "2027-03-15"));
    await createEntry(home, owner, event("Zahnarzt", "2027-03-16", { allDay: false, startTime: "10:30", attendeeIds: [robin.id] }));
    await createEntry(home, owner, event("Training", "2027-03-16", { attendeeIds: [kimId] }));
    await createEntry(home, owner, {
      kind: "task",
      title: "Blumen gießen",
      allDay: true,
      startDate: "2027-03-14",
      repeat: { freq: "daily", until: "2027-03-21" },
      assigneeMode: "rotate",
      assigneeIds: [owner.id, robin.id],
    });
    await insertWastePickup(home, owner.id, { date: "2027-03-17", category: "waste_rest" });
    await insertWastePickup(home, owner.id, { date: "2027-03-18", category: "waste_bio", assigneeId: robin.id });
    await insertWastePickup(home, owner.id, { date: "2027-03-19", category: "waste_paper", assigneeId: owner.id });
    const car = await call(calendarPath(home, "/resources"), { method: "POST", cookie: owner.cookie, body: { name: "Familienauto" } });
    const carId = (await body<{ id: string }>(car)).id;
    const booking = { kind: "car", allDay: false, startTime: "08:00", endTime: "12:00", resourceId: carId };
    await createEntry(home, owner, { ...booking, title: "Arbeit", startDate: "2027-03-22", attendeeIds: [robin.id] });
    await createEntry(home, owner, { ...booking, title: "Baumarkt", startDate: "2027-03-23", attendeeIds: [owner.id] });

    const skipped = await createEntry(home, owner, event("Abgesagt", "2027-03-24"));
    const put = await call(calendarPath(home, `/entries/${skipped}/occurrences/2027-03-24`), {
      method: "PUT",
      cookie: owner.cookie,
      body: { status: "skipped" },
    });
    expect(put.status).toBe(200);
    const done = await call(calendarPath(home, "/occurrences?from=2027-03-15&to=2027-03-15"), { cookie: owner.cookie });
    const flowers = (await body<{ items: Array<{ entryId: string; title: string }> }>(done)).items.find(
      (item) => item.title === "Blumen gießen",
    )!;
    const mark = await call(calendarPath(home, `/entries/${flowers.entryId}/occurrences/2027-03-15`), {
      method: "PUT",
      cookie: robin.cookie,
      body: { status: "done" },
    });
    expect(mark.status).toBe(200);

    mine = (await createLink(home, robin.id, "mine")).url;
    all = (await createLink(home, owner.id, "all")).url;
  });

  test("scope mine: for everybody, naming me, my rotation turns, my or nobody's pickups, my car bookings", async () => {
    const rendered = await render(mine);
    expect(parseIcsEvents(rendered.body).map((item) => item.summary)).toEqual([
      "✓ Blumen gießen · Robin", // 15th (ordinal 1)
      "Für alle", // 15th
      "Zahnarzt", // 16th, timed
      "Restmüll", // 17th, nobody's pickup (a waste pickup sorts first on its day)
      "Blumen gießen · Robin", // 17th (ordinal 3)
      "Biotonne", // 18th, Robin's pickup
      "Blumen gießen · Robin", // 19th
      "Blumen gießen · Robin", // 21st
      "Familienauto: Arbeit · Robin", // 22nd
    ]);
    expect(calendarNameOf(rendered.body)).toMatch(/^Haushalt · Meine \w+ \(meine Termine\)$/);
  });

  test("scope all: everything but the skipped occurrence; the done one is marked", async () => {
    const events = parseIcsEvents((await render(all)).body);
    const summaries = events.map((item) => item.summary);
    expect(summaries.filter((summary) => summary.startsWith("Blumen gießen") || summary.startsWith("✓ Blumen"))).toEqual([
      "Blumen gießen · Eric",
      "✓ Blumen gießen · Robin",
      "Blumen gießen · Eric",
      "Blumen gießen · Robin",
      "Blumen gießen · Eric",
      "Blumen gießen · Robin",
      "Blumen gießen · Eric",
      "Blumen gießen · Robin",
    ]);
    expect(summaries).toContain("Training");
    expect(summaries).toContain("Papiertonne");
    expect(summaries).toContain("Familienauto: Baumarkt · Eric");
    expect(summaries).not.toContain("Abgesagt");
    expect(summaries).toHaveLength(8 + 3 + 3 + 2);
    expect(events.find((item) => item.summary === "Training")!.description).toBe("Für: Kim");
    expect(events.find((item) => item.summary === "Biotonne")!.description).toBe("Zuständig: Robin");
    expect(calendarNameOf((await render(all)).body)).toMatch(/^Haushalt · Meine \w+$/);
  });

  test("the locale is the link user's users.locale, else the deployment default", async () => {
    await db.update(users).set({ locale: "en" }).where(eq(users.id, robin.id));
    try {
      const rendered = await render(mine);
      expect(calendarNameOf(rendered.body)).toMatch(/^Household · Meine \w+ \(my events\)$/);
      const summaries = parseIcsEvents(rendered.body).map((item) => item.summary);
      expect(summaries).toContain("Residual waste");
      expect(summaries).toContain("Organic bin");
      expect(summaries).toContain("Für alle");
    } finally {
      await db.update(users).set({ locale: null }).where(eq(users.id, robin.id));
    }
    expect(calendarNameOf((await render(mine)).body)).toContain("(meine Termine)");
  });
});

describe("the link's life (P3, P4, P7, P13)", () => {
  let owner: TestUser;
  let home = "";
  beforeAll(async () => {
    owner = await createUser("Eric");
    home = await createCalendarHousehold(owner, `Link ${crypto.randomUUID().slice(0, 6)}`);
  });

  test("create: a 43-character base64url token, only its SHA-256 stored; get never shows it", async () => {
    const created = await createLink(home, owner.id, "all");
    expect(created).toMatchObject({ scope: "all", createdAt: new Date(NOON).toISOString(), lastUsedAt: null });
    const token = feedFileOf(created.url).replace(/\.ics$/, "");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.url).toMatch(/^https?:\/\/[^/]+\/api\/calendar\/feed\/[A-Za-z0-9_-]{43}\.ics$/);
    const [row] = await db.select().from(calendarFeedTokens).where(eq(calendarFeedTokens.householdId, home));
    expect(row!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(token);
    const got = await runTest(CalendarFeedTokens.use((tokens) => tokens.get(home, owner.id)));
    expect(got).toEqual({ scope: "all", createdAt: new Date(NOON).toISOString(), lastUsedAt: null });
    expect(JSON.stringify(got)).not.toContain(token);
  });

  test("a second create REPLACES the link: the old token is unknown at once, the new one resolves", async () => {
    const first = await createLink(home, owner.id, "all");
    const second = await createLink(home, owner.id, "mine", NOON + 60_000);
    expect(second.url).not.toBe(first.url);
    expect(await resolveFails(first.url)).toMatchObject({ _tag: "NotFound", status: 404 });
    const resolved = await at(NOON, CalendarFeedTokens.use((tokens) => tokens.resolve(feedFileOf(second.url))));
    expect(resolved).toMatchObject({ householdId: home, userId: owner.id, scope: "mine", lastUsedAt: null });
    const rows = await db.select().from(calendarFeedTokens).where(eq(calendarFeedTokens.householdId, home));
    expect(rows).toHaveLength(1);
  });

  test("updateScope keeps the token; remove ends it (twice is fine); updateScope without a link is 404", async () => {
    const { url } = await createLink(home, owner.id, "all");
    const updated = await runTest(CalendarFeedTokens.use((tokens) => tokens.updateScope(home, owner.id, "mine")));
    expect(updated.scope).toBe("mine");
    expect((await at(NOON, CalendarFeedTokens.use((tokens) => tokens.resolve(feedFileOf(url))))).scope).toBe("mine");
    await runTest(CalendarFeedTokens.use((tokens) => tokens.remove(home, owner.id)));
    await runTest(CalendarFeedTokens.use((tokens) => tokens.remove(home, owner.id)));
    expect(await resolveFails(url)).toMatchObject({ _tag: "NotFound" });
    expect(await runTest(CalendarFeedTokens.use((tokens) => tokens.get(home, owner.id)))).toBeNull();
    const missing = await runTest(Effect.flip(CalendarFeedTokens.use((tokens) => tokens.updateScope(home, owner.id, "all"))));
    expect(missing).toMatchObject({ _tag: "NotFound" });
  });

  test("malformed files are the same NotFound", async () => {
    for (const file of ["", "x.ics", `${"a".repeat(43)}.ICS`, `${"a".repeat(42)}.ics`, `${"a".repeat(44)}.ics`, `${"a".repeat(43)}`, `${"a".repeat(42)}+.ics`]) {
      const refusal = await at(NOON, Effect.flip(CalendarFeedTokens.use((tokens) => tokens.resolve(file))));
      expect(refusal).toMatchObject({ _tag: "NotFound", status: 404, code: "not_found" });
    }
  });

  test("last_used_at is written on the first fetch and then at most once an hour (P7)", async () => {
    const { url } = await createLink(home, owner.id, "all");
    const lastUsed = async () =>
      (await db.select().from(calendarFeedTokens).where(eq(calendarFeedTokens.householdId, home)))[0]!.lastUsedAt;
    await at(
      NOON,
      Effect.gen(function* () {
        const tokens = yield* CalendarFeedTokens;
        yield* tokens.touch(yield* tokens.resolve(feedFileOf(url)));
        yield* TestClock.adjust("59 minutes");
        yield* tokens.touch(yield* tokens.resolve(feedFileOf(url)));
      }),
    );
    expect(await lastUsed()).toBe(NOON);
    await at(
      NOON + 60 * 60_000,
      Effect.gen(function* () {
        const tokens = yield* CalendarFeedTokens;
        yield* tokens.touch(yield* tokens.resolve(feedFileOf(url)));
        yield* TestClock.adjust("30 minutes");
        yield* tokens.touch(yield* tokens.resolve(feedFileOf(url)));
      }),
    );
    expect(await lastUsed()).toBe(NOON + 60 * 60_000);
    const got = await runTest(CalendarFeedTokens.use((tokens) => tokens.get(home, owner.id)));
    expect(got!.lastUsedAt).toBe(new Date(NOON + 60 * 60_000).toISOString());
  });
});

describe("the member-removal hook (P14)", () => {
  test("deletes the leaver's row of that household only; their link stops resolving", async () => {
    const owner = await createUser("Eric");
    const robin = await createUser("Robin");
    const home = await createCalendarHousehold(owner, `Hook ${crypto.randomUUID().slice(0, 6)}`);
    const other = await createCalendarHousehold(owner, `Hook2 ${crypto.randomUUID().slice(0, 6)}`);
    await addMember(owner, home, robin);
    await addMember(owner, other, robin);
    const ownerLink = await createLink(home, owner.id, "all");
    const robinLink = await createLink(home, robin.id, "mine");
    const robinOther = await createLink(other, robin.id, "all");

    const removed = await call(`/api/households/${home}/members/${robin.id}`, { method: "DELETE", cookie: owner.cookie });
    expect(removed.status).toBe(204);

    const rows = await db.select().from(calendarFeedTokens).where(eq(calendarFeedTokens.userId, robin.id));
    expect(rows.map((row) => row.householdId)).toEqual([other]);
    expect(await resolveFails(robinLink.url)).toMatchObject({ _tag: "NotFound" });
    expect((await at(NOON, CalendarFeedTokens.use((tokens) => tokens.resolve(feedFileOf(ownerLink.url))))).userId).toBe(owner.id);
    expect((await at(NOON, CalendarFeedTokens.use((tokens) => tokens.resolve(feedFileOf(robinOther.url))))).householdId).toBe(other);
  });
});
