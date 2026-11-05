/**
 * The URL import against a REAL socket: a `Bun.serve` fixture server on `127.0.0.1:0` serves a recipe page with
 * JSON-LD and a hero image, and `POST /imports/url` reaches it through `app.request`, the real session chain, the real
 * `FetchHttpClient` and the real guard (E3-T13; plan `docs/plans/e3-recipe-services.md` P10, section 4).
 *
 * The guard is opened for ONE host only, through the exact-host allow list of `setImportGuardForTests`
 * (`allowHosts: ["127.0.0.1"]`): every other host keeps every check. The private-hosts escape hatch
 * (`IMPORT_ALLOW_PRIVATE_HOSTS`) is deliberately NOT used: it skips every host check, so the redirect case below could
 * not prove a refusal and would send a real request to the link-local metadata address. Here the fixture answers `302`
 * with `Location: http://169.254.169.254/latest/meta-data/` and the GUARD refuses the hop (`400 fetch_failed`, reason
 * `private_ip`) before any request is sent; the fixture's own request log shows that route hit exactly once.
 *
 * Setup is the pinned route tests' (`routes.test.ts`): user, session, household, membership and the `household_modules`
 * row in the shared `db` (what the module chain reads), the same FK rows in a file DB handed to the import routes with
 * `setImportDbForTests`. Every test carries an explicit timeout above the 10 s page budget, so a hang fails on the
 * route's own assertion rather than on bun's 5 s default (the stored hero image warms a thumbnail with `sharp`).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { CommitImportDraftResponse, ImportDraftResponse } from "@toon/shared";
import { createSession } from "../../src/core/services/auth/sessions.ts";
import { createDatabase, db as sharedDb } from "../../src/db/client.ts";
import { runMigrations } from "../../src/db/migrate.ts";
import { householdMembers, householdModules, households, users } from "../../src/db/schema.ts";
import { env } from "../../src/env.ts";
import { app } from "../../src/index.ts";
import { SESSION_COOKIE } from "../../src/lib/cookies.ts";
import { setImportDbForTests } from "../../src/modules/recipe/services/import/db.ts";
import { setImportGuardForTests } from "../../src/modules/recipe/services/import/url/fetch.ts";
import { fixture, makeTestPng } from "./helpers.ts";

/** Above the 10 s page budget and the 8 s image budget: a hang fails on the route's own assertion. */
const URL_IMPORT_TEST_TIMEOUT_MS = 30_000;

const tempDir = mkdtempSync(join(tmpdir(), "toon-import-local-"));
const { client, db } = createDatabase({ url: `file:${join(tempDir, "local.db")}` });
await runMigrations(db);
await runMigrations(sharedDb);

const userId = crypto.randomUUID();
const householdId = crypto.randomUUID();
let cookie = "";

/** Every request the fixture server saw, as `METHOD path`. */
const requestLog: string[] = [];
const png = await makeTestPng(320, 200);
const storedUploads = new Set<string>();

const METADATA_URL = "http://169.254.169.254/latest/meta-data/";

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request): Response {
    const url = new URL(request.url);
    requestLog.push(`${request.method} ${url.pathname}`);
    if (url.pathname === "/recipe") {
      const html = fixture("chefkoch-jsonld.html").replaceAll(
        /https:\/\/img\.chefkoch-cdn\.de\/[^"]+\.jpg/g,
        `${url.origin}/hero.png`,
      );
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (url.pathname === "/hero.png") return new Response(png, { headers: { "content-type": "image/png" } });
    if (url.pathname === "/to-metadata") return new Response(null, { status: 302, headers: { location: METADATA_URL } });
    return new Response("not found", { status: 404 });
  },
});

const base = `/api/households/${householdId}/recipe/imports`;
const origin = `http://127.0.0.1:${server.port}`;

beforeAll(async () => {
  setImportDbForTests(db);
  setImportGuardForTests({ allowHosts: ["127.0.0.1"] });

  for (const target of [sharedDb, db]) {
    await target
      .insert(users)
      .values({ id: userId, email: "lokal@toon.local", name: "Lokalkoch", emailVerifiedAt: Date.now() });
    await target.insert(households).values({ id: householdId, name: "Lokal", createdBy: userId });
    await target.insert(householdMembers).values({ id: crypto.randomUUID(), householdId, userId, role: "owner" });
  }
  await sharedDb.insert(householdModules).values({ householdId, moduleId: "recipe" });
  const session = await createSession(sharedDb, userId);
  cookie = `${SESSION_COOKIE}=${session.id}`;
});

afterAll(() => {
  setImportGuardForTests(null);
  setImportDbForTests(null);
  void server.stop(true);
  client.close();
  rmSync(tempDir, { recursive: true, force: true });
  for (const filename of storedUploads) {
    rmSync(join(env.uploadDir, filename), { force: true });
    rmSync(join(env.uploadDir, filename.replace(/\.[^.]+$/, ".thumb.webp")), { force: true });
  }
});

async function postJson(path: string, body: unknown): Promise<Response> {
  return await app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

/** The stored filename of a `/uploads/<name>[?signature]` URL, recorded for the cleanup in `afterAll`. */
function recordUpload(imageUrl: string): string {
  const name = new URL(imageUrl, "http://local.invalid").pathname.replace(/^\/uploads\//, "");
  storedUploads.add(name);
  return name;
}

describe("URL import from a local fixture server", () => {
  test(
    "creates a draft with the fixture's title and a local /uploads hero image, then commits it with 201 and Location",
    async () => {
      requestLog.length = 0;
      const response = await postJson(`${base}/url`, { url: `${origin}/recipe` });
      expect(response.status).toBe(201);
      const { draft } = (await response.json()) as ImportDraftResponse;

      expect(draft.sourceType).toBe("url");
      expect(draft.sourceUrl).toBe(`${origin}/recipe`);
      expect(draft.parsed.title).toBe("Klassische Pfannkuchen");
      expect(draft.parsed.ingredients.length).toBeGreaterThan(0);
      const imageUrl = draft.parsed.imageUrl;
      expect(typeof imageUrl).toBe("string");
      expect(imageUrl).toStartWith("/uploads/");
      recordUpload(imageUrl ?? "");
      expect(requestLog).toContain("GET /recipe");
      expect(requestLog).toContain("GET /hero.png");

      const commit = await postJson(`${base}/${draft.id}/commit`, {});
      expect(commit.status).toBe(201);
      const body = (await commit.json()) as CommitImportDraftResponse;
      expect(body.recipe.title).toBe("Klassische Pfannkuchen");
      expect(commit.headers.get("location")).toBe(`/api/households/${householdId}/recipe/recipes/${body.recipe.id}`);
    },
    URL_IMPORT_TEST_TIMEOUT_MS,
  );

  test(
    "a redirect into the metadata address is refused by the guard (private_ip) before any request is sent",
    async () => {
      requestLog.length = 0;
      const startedAt = performance.now();
      const response = await postJson(`${base}/url`, { url: `${origin}/to-metadata` });
      const elapsedMs = performance.now() - startedAt;

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: { code: string; details?: { reason?: string } } };
      expect(body.error.code).toBe("fetch_failed");
      expect(body.error.details?.reason).toBe("private_ip");
      // A refusal by the guard, not the 10 s page timeout.
      expect(elapsedMs).toBeLessThan(2000);
      // The redirect route was hit exactly once; nothing else was requested from the fixture.
      expect(requestLog).toEqual(["GET /to-metadata"]);
    },
    URL_IMPORT_TEST_TIMEOUT_MS,
  );

  test(
    "the allow list is exact: another private address is still refused, with no request to the fixture",
    async () => {
      requestLog.length = 0;
      const response = await postJson(`${base}/url`, { url: `http://127.0.0.2:${server.port}/recipe` });
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: { code: string; details?: { reason?: string } } };
      expect(body.error.code).toBe("fetch_failed");
      expect(body.error.details?.reason).toBe("private_ip");
      expect(requestLog).toEqual([]);
    },
    URL_IMPORT_TEST_TIMEOUT_MS,
  );
});
