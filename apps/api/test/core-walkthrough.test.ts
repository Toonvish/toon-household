/**
 * The M1 exit-criteria walkthrough, end to end through `app.request`
 * (docs/plans/m1-core.md §1 and task M1-T12):
 *
 *   A registers -> logs out -> logs in -> creates "WG" -> invites B -> B registers (no invite)
 *   -> B accepts -> B switches to WG -> A enables `finance` (B's attempt is 403) -> B sees the
 *   modules on GET /api/households/:id -> A disables `recipe` -> B's /api/auth/me shows WG with
 *   `["finance"]`.
 *
 * Since M3 finance's `onEnable` needs its two participants (SPEC D3, plan M3 decision 4), so A
 * enables it with A in slot 1 and B in slot 2.
 *
 * Everything runs against the shared `db` (libSQL `file::memory:` is per client, so a different
 * client would be a different database). The e-mail confirmation gate is forced OFF under
 * `bun test`, which is the default self-hosted behaviour; its own cases live in
 * verified-email-gate.test.ts.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { app } from "../src/index.ts";
import { ConsoleMailer, setMailer } from "../src/core/services/mail/index.ts";

const JSON_HEADERS = { "Content-Type": "application/json" };
const PASSWORD = "geheimes-passwort-123";
const RUN = crypto.randomUUID().slice(0, 8);
const EMAIL_A = `walk-a-${RUN}@example.com`;
const EMAIL_B = `walk-b-${RUN}@example.com`;

beforeAll(async () => {
  await runMigrations(db);
  setMailer(new ConsoleMailer(() => undefined));
});

afterAll(() => {
  setMailer(null);
});

function cookieOf(response: Response): string {
  return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

async function call(
  path: string,
  init: { method?: string; body?: unknown; cookie?: string } = {},
): Promise<Response> {
  return app.request(path, {
    method: init.method ?? "GET",
    headers: {
      ...(init.body === undefined ? {} : JSON_HEADERS),
      ...(init.cookie === undefined ? {} : { Cookie: init.cookie }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

interface HouseholdDto {
  id: string;
  name: string;
  role: string;
  modules: string[];
}
interface MePayload {
  user: { id: string; email: string };
  households: HouseholdDto[];
  activeHouseholdId: string | null;
}

describe("M1 core walkthrough", () => {
  let cookieA = "";
  let cookieB = "";
  let userIdA = "";
  let userIdB = "";
  let householdA = "";
  let wg = "";
  let inviteToken = "";

  test("A registers: 201, own household with the default module", async () => {
    const response = await call("/api/auth/register", {
      method: "POST",
      body: { email: EMAIL_A, name: "Anna", password: PASSWORD },
    });
    expect(response.status).toBe(201);
    cookieA = cookieOf(response);
    expect(cookieA).not.toBe("");
    const body = (await response.json()) as MePayload;
    userIdA = body.user.id;
    expect(body.households).toHaveLength(1);
    expect(body.households[0]?.modules).toEqual(["recipe"]);
    householdA = body.households[0]?.id ?? "";
    expect(body.activeHouseholdId).toBe(householdA);
  });

  test("A logs out (204) and the old cookie is dead, then logs in again", async () => {
    const out = await call("/api/auth/logout", { method: "POST", cookie: cookieA });
    expect(out.status).toBe(204);
    expect((await call("/api/auth/me", { cookie: cookieA })).status).toBe(401);

    const login = await call("/api/auth/login", {
      method: "POST",
      body: { email: EMAIL_A, password: PASSWORD },
    });
    expect(login.status).toBe(200);
    cookieA = cookieOf(login);
    const me = await call("/api/auth/me", { cookie: cookieA });
    expect(me.status).toBe(200);
    expect(((await me.json()) as MePayload).user.email).toBe(EMAIL_A);
  });

  test("A creates the household WG: 201, default module on", async () => {
    const response = await call("/api/households", {
      method: "POST",
      cookie: cookieA,
      body: { name: "WG" },
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { household: HouseholdDto };
    expect(body.household.name).toBe("WG");
    expect(body.household.role).toBe("owner");
    expect(body.household.modules).toEqual(["recipe"]);
    wg = body.household.id;
  });

  test("A invites B: 201 with an inviteUrl", async () => {
    const response = await call(`/api/households/${wg}/invites`, {
      method: "POST",
      cookie: cookieA,
      body: { email: EMAIL_B, role: "member" },
    });
    expect(response.status).toBe(201);
    const { inviteUrl } = (await response.json()) as { inviteUrl: string };
    inviteToken = inviteUrl.split("/").at(-1) ?? "";
    expect(inviteToken.length).toBeGreaterThanOrEqual(10);
  });

  test("B registers WITHOUT an invite and accepts: B is a member of WG", async () => {
    const register = await call("/api/auth/register", {
      method: "POST",
      body: { email: EMAIL_B, name: "Ben", password: PASSWORD },
    });
    expect(register.status).toBe(201);
    cookieB = cookieOf(register);
    userIdB = ((await register.json()) as MePayload).user.id;

    const preview = await call(`/api/households/invites/${inviteToken}`);
    expect(preview.status).toBe(200);

    const accept = await call("/api/households/invites/accept", {
      method: "POST",
      cookie: cookieB,
      body: { token: inviteToken },
    });
    expect(accept.status).toBe(200);
    const body = (await accept.json()) as { household: HouseholdDto; member: { role: string } };
    expect(body.household.id).toBe(wg);
    expect(body.member.role).toBe("member");

    const me = (await (await call("/api/auth/me", { cookie: cookieB })).json()) as MePayload;
    expect(me.households.map((h) => h.id)).toContain(wg);
  });

  test("B switches the active household to WG", async () => {
    const patch = await call("/api/auth/me", {
      method: "PATCH",
      cookie: cookieB,
      body: { activeHouseholdId: wg },
    });
    expect(patch.status).toBe(200);
    const me = (await (await call("/api/auth/me", { cookie: cookieB })).json()) as MePayload;
    expect(me.activeHouseholdId).toBe(wg);
  });

  test("A enables finance with A and B as participants: 200 and modules [recipe, finance]; B's attempt is 403", async () => {
    const enabled = await call(`/api/households/${wg}/modules/finance`, {
      method: "POST",
      cookie: cookieA,
      body: {
        settings: {
          participants: [
            { userId: userIdA, memberSlot: 1 },
            { userId: userIdB, memberSlot: 2 },
          ],
        },
      },
    });
    expect(enabled.status).toBe(200);
    const body = (await enabled.json()) as { household: HouseholdDto };
    expect(body.household.modules).toEqual(["recipe", "finance"]);

    const denied = await call(`/api/households/${wg}/modules/finance`, {
      method: "POST",
      cookie: cookieB,
    });
    expect(denied.status).toBe(403);
    const unknown = await call(`/api/households/${wg}/modules/nope`, {
      method: "POST",
      cookie: cookieA,
    });
    expect(unknown.status).toBe(404);
  });

  test("B sees the modules on GET /api/households/:id", async () => {
    const response = await call(`/api/households/${wg}`, { cookie: cookieB });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { household: HouseholdDto; members: unknown[] };
    expect(body.household.modules).toEqual(["recipe", "finance"]);
    expect(body.members).toHaveLength(2);
  });

  test("A disables recipe (204); B's /api/auth/me shows WG with [finance]", async () => {
    const disabled = await call(`/api/households/${wg}/modules/recipe`, {
      method: "DELETE",
      cookie: cookieA,
    });
    expect(disabled.status).toBe(204);
    const again = await call(`/api/households/${wg}/modules/recipe`, {
      method: "DELETE",
      cookie: cookieA,
    });
    expect(again.status).toBe(204);

    const me = (await (await call("/api/auth/me", { cookie: cookieB })).json()) as MePayload;
    expect(me.households.find((h) => h.id === wg)?.modules).toEqual(["finance"]);
    // A's own first household is untouched.
    const meA = (await (await call("/api/auth/me", { cookie: cookieA })).json()) as MePayload;
    expect(meA.households.find((h) => h.id === householdA)?.modules).toEqual(["recipe"]);
  });
});
