/**
 * Integration tests for /api/recipe/cards — the user's saved loyalty barcodes.
 *
 * Same harness as test/shopping.test.ts: real Hono app, real session middleware,
 * in-memory libSQL with the generated migrations applied.
 *
 * The thing this file exists to pin is ISOLATION BY USER. Cards are the only
 * user-owned entity in the app, so there is no household membership check standing
 * behind them — `eq(cards.userId, …)` in the service is the whole authorisation,
 * and a query that forgets it leaks one person's loyalty numbers to another
 * without failing anything else. Every read and write is therefore tested from a
 * second account as well.
 */
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { cards, sessions, users } from "../src/db/schema.ts";
import { app } from "../src/index.ts";

await runMigrations(db);

/* -------------------------------------------------------------------------- */
/* harness                                                                    */
/* -------------------------------------------------------------------------- */

interface TestUser {
  id: string;
  cookie: string;
}

async function createUser(name: string): Promise<TestUser> {
  const id = crypto.randomUUID();
  await db.insert(users).values({
    id,
    email: `${name.toLowerCase()}.${id.slice(0, 8)}@toon.test`,
    name,
    emailVerified: true,
  });
  const sessionId = crypto.randomUUID().replaceAll("-", "");
  await db
    .insert(sessions)
    .values({ id: sessionId, userId: id, expiresAt: Date.now() + 30 * 24 * 3600 * 1000 });
  return { id, cookie: `toon_session=${sessionId}` };
}

interface CallOptions {
  method?: string;
  cookie?: string;
  body?: unknown;
  locale?: string;
}

async function call(path: string, options: CallOptions = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.locale) headers["Accept-Language"] = options.locale;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  return app.request(path, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

async function body<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

interface CardPayload {
  id: string;
  label: string;
  format: string;
  value: string;
  note: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ErrorPayload {
  error: {
    code: string;
    message: string;
    details?: Array<{ path: string; code: string; message: string; i18n?: { key: string } }>;
  };
}

async function saveCard(
  user: TestUser,
  input: { label: string; format: string; value: string; note?: string | null },
): Promise<CardPayload> {
  const response = await call("/api/recipe/cards", { method: "POST", cookie: user.cookie, body: input });
  expect(response.status).toBe(201);
  return (await body<{ card: CardPayload }>(response)).card;
}

/* -------------------------------------------------------------------------- */
/* tests                                                                      */
/* -------------------------------------------------------------------------- */

describe("GET /api/recipe/cards", () => {
  test("401 without a session", async () => {
    expect((await call("/api/recipe/cards")).status).toBe(401);
  });

  test("an empty wallet is an empty list, not a 404", async () => {
    const user = await createUser("Wallet");
    const response = await call("/api/recipe/cards", { cookie: user.cookie });
    expect(response.status).toBe(200);
    expect(await body<{ items: CardPayload[] }>(response)).toEqual({ items: [] });
  });

  test("orders by last USE, then by newest", async () => {
    const user = await createUser("Ordered");
    const first = await saveCard(user, { label: "Payback", format: "ean13", value: "405912345678" });
    const second = await saveCard(user, { label: "Rewe", format: "code128", value: "AB-99887766" });

    // Nothing shown yet: newest first.
    let items = (await body<{ items: CardPayload[] }>(await call("/api/recipe/cards", { cookie: user.cookie })))
      .items;
    expect(items.map((card) => card.id)).toEqual([second.id, first.id]);

    // Showing the older card moves it to the front, where a till needs it.
    expect((await call(`/api/recipe/cards/${first.id}/used`, { method: "POST", cookie: user.cookie })).status).toBe(
      200,
    );
    items = (await body<{ items: CardPayload[] }>(await call("/api/recipe/cards", { cookie: user.cookie }))).items;
    expect(items.map((card) => card.id)).toEqual([first.id, second.id]);
    expect(items[0]?.lastUsedAt).not.toBeNull();
    expect(items[1]?.lastUsedAt).toBeNull();
  });

  test("never returns another account's cards", async () => {
    const anna = await createUser("Anna");
    const ben = await createUser("Ben");
    await saveCard(anna, { label: "Payback", format: "ean13", value: "401234567890" });

    const items = (await body<{ items: CardPayload[] }>(await call("/api/recipe/cards", { cookie: ben.cookie })))
      .items;
    expect(items).toEqual([]);
  });
});

describe("POST /api/recipe/cards", () => {
  test("normalises the value it stores", async () => {
    const user = await createUser("Normaliser");
    // The twelve digits printed under the barcode, spaced as the card prints them.
    const card = await saveCard(user, { label: "Payback", format: "ean13", value: "4 059 123 456 78" });
    expect(card.value).toBe("4059123456788");
    expect(card.lastUsedAt).toBeNull();

    const [row] = await db.select().from(cards).where(eq(cards.id, card.id));
    expect(row?.value).toBe("4059123456788");
    expect(row?.userId).toBe(user.id);
  });

  test("422 with a KEYED value issue for a mistyped digit", async () => {
    const user = await createUser("Mistyper");
    const response = await call("/api/recipe/cards", {
      method: "POST",
      cookie: user.cookie,
      body: { label: "Payback", format: "ean13", value: "4059123456789" },
    });
    expect(response.status).toBe(422);
    const payload = await body<ErrorPayload>(response);
    expect(payload.error.code).toBe("validation_failed");
    // The key is what lets a client of a different locale re-render the issue —
    // routes/cards.ts throws the raw ZodError for exactly this reason.
    expect(payload.error.details?.[0]?.path).toBe("value");
    expect(payload.error.details?.[0]?.i18n?.key).toBe("server.card.valueCheckDigit");
  });

  test("renders the issue in the negotiated language", async () => {
    const user = await createUser("Bilingual");
    const german = await body<ErrorPayload>(
      await call("/api/recipe/cards", {
        method: "POST",
        cookie: user.cookie,
        locale: "de-DE",
        body: { label: "X", format: "ean13", value: "4059123456789" },
      }),
    );
    const english = await body<ErrorPayload>(
      await call("/api/recipe/cards", {
        method: "POST",
        cookie: user.cookie,
        locale: "en-GB",
        body: { label: "X", format: "ean13", value: "4059123456789" },
      }),
    );
    expect(german.error.details?.[0]?.message).toContain("Prüfziffer");
    expect(english.error.details?.[0]?.message).toContain("check digit");
  });

  test("422 for a symbology this app cannot display", async () => {
    const user = await createUser("Exotic");
    const response = await call("/api/recipe/cards", {
      method: "POST",
      cookie: user.cookie,
      body: { label: "Aztec card", format: "pdf417", value: "1234" },
    });
    expect(response.status).toBe(422);
  });

  test("409 card_already_saved for the same code twice", async () => {
    const user = await createUser("Duplicator");
    await saveCard(user, { label: "Payback", format: "ean13", value: "401234567890" });
    const response = await call("/api/recipe/cards", {
      method: "POST",
      cookie: user.cookie,
      // Same number, typed with separators and a different label.
      body: { label: "Payback (Anna)", format: "ean13", value: "4012-3456-7890" },
    });
    expect(response.status).toBe(409);
    expect((await body<ErrorPayload>(response)).error.code).toBe("card_already_saved");
  });

  test("two accounts may save the same card", async () => {
    const anna = await createUser("AnnaShared");
    const ben = await createUser("BenShared");
    await saveCard(anna, { label: "Haushalt", format: "ean13", value: "401234567890" });
    await saveCard(ben, { label: "Haushalt", format: "ean13", value: "401234567890" });
  });
});

describe("PATCH /api/recipe/cards/:cardId", () => {
  test("renames without touching the code", async () => {
    const user = await createUser("Renamer");
    const card = await saveCard(user, { label: "Payback", format: "ean13", value: "401234567890" });
    const response = await call(`/api/recipe/cards/${card.id}`, {
      method: "PATCH",
      cookie: user.cookie,
      body: { label: "Payback Anna" },
    });
    expect(response.status).toBe(200);
    const updated = (await body<{ card: CardPayload }>(response)).card;
    expect(updated.label).toBe("Payback Anna");
    expect(updated.value).toBe("4012345678901");
  });

  test("clears a note with null", async () => {
    const user = await createUser("Noter");
    const card = await saveCard(user, {
      label: "Bibliothek",
      format: "code39",
      value: "LESER-4711",
      note: "Ausweis von 2019",
    });
    expect(card.note).toBe("Ausweis von 2019");
    const updated = (
      await body<{ card: CardPayload }>(
        await call(`/api/recipe/cards/${card.id}`, {
          method: "PATCH",
          cookie: user.cookie,
          body: { note: null },
        }),
      )
    ).card;
    expect(updated.note).toBeNull();
  });

  test("422 when format and value do not travel together", async () => {
    const user = await createUser("HalfPatcher");
    const card = await saveCard(user, { label: "Karte", format: "ean13", value: "401234567890" });
    const response = await call(`/api/recipe/cards/${card.id}`, {
      method: "PATCH",
      cookie: user.cookie,
      body: { value: "12345678" },
    });
    expect(response.status).toBe(422);
    expect((await body<ErrorPayload>(response)).error.details?.[0]?.i18n?.key).toBe(
      "server.card.formatAndValue",
    );
  });

  test("changes the code when both arrive, normalising again", async () => {
    const user = await createUser("Recoder");
    const card = await saveCard(user, { label: "Karte", format: "ean13", value: "401234567890" });
    const updated = (
      await body<{ card: CardPayload }>(
        await call(`/api/recipe/cards/${card.id}`, {
          method: "PATCH",
          cookie: user.cookie,
          body: { format: "code39", value: " mitglied-42 " },
        }),
      )
    ).card;
    expect(updated.format).toBe("code39");
    expect(updated.value).toBe("MITGLIED-42");
  });

  test("422 for an empty patch", async () => {
    const user = await createUser("EmptyPatcher");
    const card = await saveCard(user, { label: "Karte", format: "ean13", value: "401234567890" });
    const response = await call(`/api/recipe/cards/${card.id}`, {
      method: "PATCH",
      cookie: user.cookie,
      body: {},
    });
    expect(response.status).toBe(422);
  });

  test("404 for another account's card, and it stays unchanged", async () => {
    const anna = await createUser("AnnaPatch");
    const ben = await createUser("BenPatch");
    const card = await saveCard(anna, { label: "Payback", format: "ean13", value: "401234567890" });

    const response = await call(`/api/recipe/cards/${card.id}`, {
      method: "PATCH",
      cookie: ben.cookie,
      body: { label: "Bens Karte" },
    });
    expect(response.status).toBe(404);
    const [row] = await db.select().from(cards).where(eq(cards.id, card.id));
    expect(row?.label).toBe("Payback");
  });
});

describe("DELETE /api/recipe/cards/:cardId", () => {
  test("forgets the card", async () => {
    const user = await createUser("Deleter");
    const card = await saveCard(user, { label: "Alt", format: "ean13", value: "401234567890" });
    expect((await call(`/api/recipe/cards/${card.id}`, { method: "DELETE", cookie: user.cookie })).status).toBe(
      204,
    );
    expect(await db.select().from(cards).where(eq(cards.id, card.id))).toEqual([]);
  });

  test("404 for an unknown card and for another account's", async () => {
    const anna = await createUser("AnnaDelete");
    const ben = await createUser("BenDelete");
    const card = await saveCard(anna, { label: "Payback", format: "ean13", value: "401234567890" });

    expect(
      (await call(`/api/recipe/cards/${crypto.randomUUID()}`, { method: "DELETE", cookie: anna.cookie })).status,
    ).toBe(404);
    expect((await call(`/api/recipe/cards/${card.id}`, { method: "DELETE", cookie: ben.cookie })).status).toBe(404);
    expect((await db.select().from(cards).where(eq(cards.id, card.id))).length).toBe(1);
  });
});

describe("POST /api/recipe/cards/:cardId/used", () => {
  test("bumps lastUsedAt but not updatedAt — showing a card is not an edit", async () => {
    const user = await createUser("Shower");
    const card = await saveCard(user, { label: "Payback", format: "ean13", value: "401234567890" });
    const response = await call(`/api/recipe/cards/${card.id}/used`, { method: "POST", cookie: user.cookie });
    expect(response.status).toBe(200);
    const shown = (await body<{ card: CardPayload }>(response)).card;
    expect(shown.lastUsedAt).not.toBeNull();
    expect(shown.updatedAt).toBe(card.updatedAt);
  });

  test("404 for another account's card", async () => {
    const anna = await createUser("AnnaUse");
    const ben = await createUser("BenUse");
    const card = await saveCard(anna, { label: "Payback", format: "ean13", value: "401234567890" });
    expect(
      (await call(`/api/recipe/cards/${card.id}/used`, { method: "POST", cookie: ben.cookie })).status,
    ).toBe(404);
  });
});

describe("deleting an account", () => {
  test("takes its wallet with it (the FK cascades)", async () => {
    const user = await createUser("Leaver");
    const card = await saveCard(user, { label: "Payback", format: "ean13", value: "401234567890" });
    await db.delete(users).where(eq(users.id, user.id));
    expect(await db.select().from(cards).where(eq(cards.id, card.id))).toEqual([]);
  });
});
