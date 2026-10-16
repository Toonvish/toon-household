/**
 * The wire shape of a validation failure on the routes that used `zValidator` before E1 (ADR 0013, plan e1 P10).
 *
 * Before E1 their `details` items were `{ path, code, message }` with Zod's English default message; since E1 they
 * are `{ path, code, message, i18n: { key, values } }` with the server catalog's text in the negotiated locale,
 * which is what `docs/API.md` "Conventions" promises for every validation issue. This file pins that deliberate
 * change on real routes of the real app (a JSON body, the enable-module body and a query), so a regression to the
 * old shape, or a drift of `path` / `code`, fails with the route named.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { db } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { sessions, users } from "../src/db/schema.ts";
import { app } from "../src/index.ts";

await runMigrations(db);

interface Issue {
  path: string;
  code: string;
  message: string;
  i18n?: { key: string; values: unknown };
}
interface ErrorBody {
  error: { code: string; message: string; details?: Issue[] };
}

async function createUser(name: string): Promise<{ id: string; cookie: string }> {
  const id = crypto.randomUUID();
  await db
    .insert(users)
    .values({ id, email: `${name.toLowerCase()}.${id.slice(0, 8)}@toon.test`, name, emailVerified: true });
  const sessionId = crypto.randomUUID().replaceAll("-", "");
  await db.insert(sessions).values({ id: sessionId, userId: id, expiresAt: Date.now() + 30 * 24 * 3600 * 1000 });
  return { id, cookie: `toon_session=${sessionId}` };
}

async function send(
  path: string,
  cookie: string,
  locale: "de" | "en",
  options: { method?: string; body?: unknown } = {},
): Promise<{ status: number; body: ErrorBody }> {
  const headers: Record<string, string> = { Cookie: cookie, "Accept-Language": locale };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const response = await app.request(path, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { status: response.status, body: (await response.json()) as ErrorBody };
}

describe("validation details on the former zValidator routes (ADR 0013)", () => {
  test("POST /api/households: path and code kept, message from the catalog in the locale, i18n added", async () => {
    const user = await createUser("Wire");
    const de = await send("/api/households", user.cookie, "de", { method: "POST", body: { name: "" } });
    const en = await send("/api/households", user.cookie, "en", { method: "POST", body: { name: "" } });

    for (const res of [de, en]) {
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("validation_failed");
      expect(res.body.error.details).toHaveLength(1);
      const [issue] = res.body.error.details ?? [];
      expect(issue?.path).toBe("name");
      expect(issue?.code).toBe("too_small");
      expect(issue?.i18n?.key).toBe("server.zod.field.name.too_small.1");
      expect(Object.keys(issue ?? {}).sort()).toEqual(["code", "i18n", "message", "path"]);
      // The envelope around the items is unchanged (docs/API.md "Errors").
      expect(Object.keys(res.body.error).sort()).toEqual(["code", "details", "message"]);
    }
    expect(de.body.error.details?.[0]?.message).toBe("Name fehlt");
    expect(en.body.error.details?.[0]?.message).toBe("Name is required");
    // Zod's English default is gone from the wire.
    expect(JSON.stringify(de.body)).not.toContain("Too small");
  });

  test("POST …/modules/:moduleId: a refused settings body is localized with i18n", async () => {
    const user = await createUser("Modwire");
    const created = await app.request("/api/households", {
      method: "POST",
      headers: { Cookie: user.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: `Wire ${crypto.randomUUID().slice(0, 8)}` }),
    });
    expect(created.status).toBe(201);
    const { household } = (await created.json()) as { household: { id: string } };

    for (const locale of ["de", "en"] as const) {
      const res = await send(`/api/households/${household.id}/modules/finance`, user.cookie, locale, {
        method: "POST",
        body: { settings: 5 },
      });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("validation_failed");
      const issues = res.body.error.details ?? [];
      expect(issues.length).toBeGreaterThan(0);
      for (const issue of issues) {
        expect(issue.path).toBe("settings");
        expect(typeof issue.code).toBe("string");
        expect((issue.i18n?.key ?? "").length).toBeGreaterThan(0);
        expect(issue.message.length).toBeGreaterThan(0);
        expect(issue.message).not.toBe(issue.i18n?.key);
      }
    }
  });

  test("a refused query carries i18n on every item, in both locales", async () => {
    const user = await createUser("Querywire");
    const created = await app.request("/api/households", {
      method: "POST",
      headers: { Cookie: user.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: `Query ${crypto.randomUUID().slice(0, 8)}` }),
    });
    const { household } = (await created.json()) as { household: { id: string } };

    const messages: string[] = [];
    for (const locale of ["de", "en"] as const) {
      const res = await send(`/api/households/${household.id}/recipe/recipes?limit=0`, user.cookie, locale);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("validation_failed");
      const [issue] = res.body.error.details ?? [];
      expect(issue?.path).toBe("limit");
      expect((issue?.i18n?.key ?? "").length).toBeGreaterThan(0);
      messages.push(issue?.message ?? "");
    }
    expect(messages[0]).not.toBe(messages[1]);
  });
});

describe("the wire change stays an open owner decision until acknowledged (ADR 0013, open-work D-7)", () => {
  const root = new URL("../../../", import.meta.url);
  const read = (path: string): string => readFileSync(new URL(path, root), "utf8");

  test("ADR 0013 carries a Status line that points at open-work D-7, and D-7 names the ADR", () => {
    const adr = read("docs/adr/0013-validation-details-from-the-schema-adapter.md");
    const openWork = read("docs/open-work.md");
    expect(adr).toMatch(/^Status: [^#]*docs\/open-work\.md` D-7/m);
    expect(openWork).toMatch(/^\| D-7 \| .*ADR 0013/m);
  });
});
