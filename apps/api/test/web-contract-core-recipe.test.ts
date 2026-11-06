/**
 * The web contract, core and recipe (docs/plans/e6-web-client.md P7, P7c, task E6-T02).
 *
 * The web clients (`apps/web/src/lib/api.ts`, `apps/web/src/modules/recipe/lib/api.ts`) decode
 * every JSON response with the `@toon/shared` `...ResponseSchema` of its type and the options
 * `{ disableChecks: true }`: structure and types are checked, the wire checks (UUID and ISO
 * patterns, lengths, ranges) are not. A decode also STRIPS keys the schema does not declare
 * and runs its transformations and defaults. This file proves, through the REAL app
 * (`app.request`, the shared test database, ADR 0009), that for every JSON route of the two
 * clients that decode is the identity on freshly produced data:
 *
 *   Schema.decodeUnknownSync(schema, { disableChecks: true })(body)  succeeds, AND
 *   expect(decoded).toEqual(body)                                      (nothing stripped, nothing added)
 *
 * One table of rows, run in order over one shared context (users, ids, cookies). A row whose
 * schema cannot satisfy the oracle without breaking `packages/shared/test` is marked
 * `lenient: { schema: "<XResponseSchema>", reason: "..." }` ON ONE LINE (P7c: a grep reads
 * it), keeps the assertion that the body is the wire truth and is applied by the web client
 * tasks (recipe rows E6-T04, core rows E6-T09).
 *
 * Rows with `schema: null` are void routes (204): they are asserted, not decoded, and exist
 * to give the JSON rows their data (deletes) and to cover the client's `request<void>` calls.
 *
 * NOT covered here, on purpose:
 *   - `POST /recipe/imports/url`: it fetches a remote page; covered by `apps/api/test/import/`.
 *   - `POST /recipe/imports/image` and `/pdf`: they need the OCR / PDF tool chain (off by
 *     default); also covered by `apps/api/test/import/`.
 *   - the OAuth navigations (`oauthStartUrl`, `startOAuth`, `startOAuthLink`): not requests.
 *   - `DELETE /api/auth/oauth/:provider`: void; the unlink needs a linked account row
 *     (`apps/api/test/oauth-claims.test.ts`).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
  AcceptInviteResponseSchema,
  AuthSessionResponseSchema,
  CardListResponseSchema,
  CardResponseSchema,
  CollectionDetailResponseSchema,
  CollectionListResponseSchema,
  CollectionResponseSchema,
  CommitImportDraftResponseSchema,
  EmailVerificationRequestResponseSchema,
  HealthResponseSchema,
  HouseholdDetailResponseSchema,
  HouseholdInviteListResponseSchema,
  HouseholdInviteResponseSchema,
  HouseholdListResponseSchema,
  HouseholdMemberListResponseSchema,
  HouseholdMemberResponseSchema,
  HouseholdResponseSchema,
  ImportDraftListResponseSchema,
  ImportDraftResponseSchema,
  InvitePreviewResponseSchema,
  LastPlannedResponseSchema,
  MealPlanEntryResponseSchema,
  MealPlanRangeResponseSchema,
  MeResponseSchema,
  OAuthProvidersResponseSchema,
  OAuthStartResponseSchema,
  PlanShoppingPreviewResponseSchema,
  RecipeCookedResponseSchema,
  RecipeListResponseSchema,
  RecipeResponseSchema,
  ScaledRecipeResponseSchema,
  SessionListResponseSchema,
  ShoppingBoughtListResponseSchema,
  ShoppingCatalogListResponseSchema,
  ShoppingListDetailResponseSchema,
  ShoppingListListResponseSchema,
  ShoppingListResponseSchema,
  TagListResponseSchema,
  TagResponseSchema,
  UploadResponseSchema,
  UserResponseSchema,
} from "@toon/shared";
import { setVerifiedEmailRequired } from "../src/core/services/auth/verifiedEmail.ts";
import { ConsoleMailer, setMailer } from "../src/core/services/mail/index.ts";
import { db } from "../src/db/client.ts";
import { runMigrations } from "./support/bridges/migrate.ts";
import { env } from "../src/env.ts";
import { app } from "../src/index.ts";
import { removeUpload } from "./support/files.ts";

/** Smallest valid PNG, so the image route's sniffer accepts it. */
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/gEBjT4uAAAAAElFTkSuQmCC"),
  (char) => char.charCodeAt(0),
);

const RUN = crypto.randomUUID().slice(0, 8);
const PASSWORD = "geheimes-passwort-123";
const NEW_PASSWORD = "ein-ganz-neues-passwort-456";
const EMAIL_A = `contract-a-${RUN}@example.com`;
const EMAIL_B = `contract-b-${RUN}@example.com`;
const EMAIL_C = `contract-c-${RUN}@example.com`;
const EMAIL_D = `contract-d-${RUN}@example.com`;
const PLAN_FROM = "2030-01-07";
const PLAN_TO = "2030-01-13";

/* -------------------------------------------------------------------------- */
/* harness                                                                    */
/* -------------------------------------------------------------------------- */

/** What the rows share: cookies, ids and tokens captured from earlier responses. */
interface Ctx {
  cookieA: string;
  cookieB: string;
  cookieC: string;
  cookieA2: string;
  householdId: string;
  scratchId: string;
  userIdA: string;
  userIdB: string;
  placeholderId: string;
  inviteToken: string;
  inviteId: string;
  inviteId2: string;
  mailToken: string;
  recipeId: string;
  recipeId2: string;
  tagId: string;
  collectionId: string;
  entryId: string;
  draftId: string;
  draftId2: string;
  listId: string;
  itemId: string;
  itemId2: string;
  boughtId: string;
  catalogId: string;
  cardId: string;
  sessionId: string;
  parsed: Record<string, unknown>;
}

// Every id starts empty and a later row reads what an earlier row captured; a row that runs
// out of order fails on the empty path instead of reading a stale value.
const ctx: Ctx = {
  cookieA: "",
  cookieB: "",
  cookieC: "",
  cookieA2: "",
  householdId: "",
  scratchId: "",
  userIdA: "",
  userIdB: "",
  placeholderId: "",
  inviteToken: "",
  inviteId: "",
  inviteId2: "",
  mailToken: "",
  recipeId: "",
  recipeId2: "",
  tagId: "",
  collectionId: "",
  entryId: "",
  draftId: "",
  draftId2: "",
  listId: "",
  itemId: "",
  itemId2: "",
  boughtId: "",
  catalogId: "",
  cardId: "",
  sessionId: "",
  parsed: {},
};

type Who = "anon" | "A" | "A2" | "B" | "C";
type Maybe<T> = T | ((c: Ctx) => T);

interface Lenient {
  schema: string;
  reason: string;
}

interface Row {
  name: string;
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: Maybe<string>;
  as: Who;
  body?: object | ((c: Ctx) => object);
  /** A multipart body instead of JSON (the recipe image route). */
  form?: () => FormData;
  status: number;
  /** The shared response schema the web client decodes with; `null` for a void route (204). */
  schema: Schema.Top | null;
  /** P7c: the oracle cannot be met; applied by E6-T04 (recipe) / E6-T09 (core). */
  lenient?: Lenient;
  /** Reads what later rows need from the response. */
  capture?: (body: any, c: Ctx, response: Response) => void;
}

function resolve<T>(value: Maybe<T>): T {
  return typeof value === "function" ? (value as (c: Ctx) => T)(ctx) : value;
}

function cookieOf(response: Response): string {
  const header = response.headers.getSetCookie().find((value) => value.startsWith("toon_session="));
  return (header ?? "").split(";")[0] ?? "";
}

function cookieFor(who: Who): string | undefined {
  switch (who) {
    case "A":
      return ctx.cookieA;
    case "A2":
      return ctx.cookieA2;
    case "B":
      return ctx.cookieB;
    case "C":
      return ctx.cookieC;
    case "anon":
      return undefined;
  }
}

const mailer = new ConsoleMailer(() => undefined);

/** The token in the last mail whose link carries `prefix/<token>`. */
function tokenFromLastMail(prefix: string): string {
  const last = mailer.sent.at(-1);
  if (!last) throw new Error("no mail was sent");
  const match = new RegExp(`${prefix}/([A-Za-z0-9_-]+)`).exec(last.text);
  if (!match?.[1]) throw new Error(`no ${prefix} link in mail:\n${last.text}`);
  return match[1];
}

const DECODE_OPTIONS = { disableChecks: true } as const;

/** The OAuth start route answers 200 only for a configured provider: configure one for this file. */
const OAUTH_KEYS = ["googleOAuthConfigured", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] as const;
const savedOAuth: Record<string, unknown> = {};

const uploadsToRemove: string[] = [];

beforeAll(async () => {
  await runMigrations(db);
  setMailer(mailer);
  // The gate is off by default under `bun test`; forcing it off keeps a leaked override from
  // an earlier file from turning a row into 403 email_unverified.
  setVerifiedEmailRequired(false);
  const settings = env as unknown as Record<string, unknown>;
  for (const key of OAUTH_KEYS) savedOAuth[key] = settings[key];
  settings.googleOAuthConfigured = true;
  settings.GOOGLE_CLIENT_ID = "contract-client-id";
  settings.GOOGLE_CLIENT_SECRET = "contract-client-secret";
});

afterAll(async () => {
  setMailer(null);
  setVerifiedEmailRequired(null);
  const settings = env as unknown as Record<string, unknown>;
  for (const key of OAUTH_KEYS) settings[key] = savedOAuth[key];
  for (const filename of uploadsToRemove) await removeUpload(filename);
});

async function send(row: Row): Promise<Response> {
  const headers: Record<string, string> = {};
  const cookie = cookieFor(row.as);
  if (cookie) headers.Cookie = cookie;
  let body: string | FormData | undefined;
  if (row.form) {
    body = row.form();
  } else if (row.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(typeof row.body === "function" ? row.body(ctx) : row.body);
  }
  return app.request(resolve(row.path), { method: row.method, headers, body });
}

/* -------------------------------------------------------------------------- */
/* the rows                                                                   */
/* -------------------------------------------------------------------------- */

const base = (c: Ctx) => `/api/households/${c.householdId}/recipe`;
const listBase = (c: Ctx) => `${base(c)}/shopping-lists/${c.listId}`;

const rows: Row[] = [
  /* ---------------------------------- core: auth ---------------------------------- */
  { name: "health", method: "GET", path: "/api/health", as: "anon", status: 200, schema: HealthResponseSchema },
  {
    name: "register A",
    method: "POST",
    path: "/api/auth/register",
    as: "anon",
    body: { email: EMAIL_A, name: "Anna", password: PASSWORD },
    status: 201,
    schema: AuthSessionResponseSchema,
    capture: (body, c, response) => {
      c.cookieA = cookieOf(response);
      c.userIdA = body.user.id;
      c.householdId = body.households[0].id;
    },
  },
  {
    name: "logout A",
    method: "POST",
    path: "/api/auth/logout",
    as: "A",
    status: 204,
    schema: null,
  },
  {
    name: "login A",
    method: "POST",
    path: "/api/auth/login",
    as: "anon",
    body: { email: EMAIL_A, password: PASSWORD },
    status: 200,
    schema: AuthSessionResponseSchema,
    capture: (_body, c, response) => {
      c.cookieA = cookieOf(response);
    },
  },
  {
    name: "login A again (second session)",
    method: "POST",
    path: "/api/auth/login",
    as: "anon",
    body: { email: EMAIL_A, password: PASSWORD },
    status: 200,
    schema: AuthSessionResponseSchema,
    capture: (_body, c, response) => {
      c.cookieA2 = cookieOf(response);
    },
  },
  { name: "me", method: "GET", path: "/api/auth/me", as: "A", status: 200, schema: MeResponseSchema },
  {
    name: "update profile",
    method: "PATCH",
    path: "/api/auth/me",
    as: "A",
    body: { name: "Anna Beispiel", locale: "de" },
    status: 200,
    schema: UserResponseSchema,
  },
  {
    name: "request e-mail verification",
    method: "POST",
    path: "/api/auth/email/verify/request",
    as: "A",
    body: {},
    status: 200,
    schema: EmailVerificationRequestResponseSchema,
    capture: (_body, c) => {
      c.mailToken = tokenFromLastMail("verify-email");
    },
  },
  {
    name: "confirm e-mail verification",
    method: "POST",
    path: "/api/auth/email/verify/confirm",
    as: "anon",
    body: (c) => ({ token: c.mailToken }),
    status: 200,
    schema: UserResponseSchema,
  },
  {
    name: "me after verification",
    method: "GET",
    path: "/api/auth/me",
    as: "A",
    status: 200,
    schema: MeResponseSchema,
  },
  {
    name: "sessions",
    method: "GET",
    path: "/api/auth/sessions",
    as: "A",
    status: 200,
    schema: SessionListResponseSchema,
    capture: (body, c) => {
      const other = body.items.find((item: { current: boolean }) => !item.current);
      c.sessionId = other.id;
    },
  },
  {
    name: "revoke the other session",
    method: "DELETE",
    path: (c) => `/api/auth/sessions/${c.sessionId}`,
    as: "A",
    status: 204,
    schema: null,
  },
  {
    name: "oauth providers (signed out)",
    method: "GET",
    path: "/api/auth/oauth",
    as: "anon",
    status: 200,
    schema: OAuthProvidersResponseSchema,
  },
  {
    name: "oauth providers (signed in)",
    method: "GET",
    path: "/api/auth/oauth",
    as: "A",
    status: 200,
    schema: OAuthProvidersResponseSchema,
  },
  {
    name: "oauth start (json)",
    method: "GET",
    path: "/api/auth/oauth/google?json=1",
    as: "anon",
    status: 200,
    schema: OAuthStartResponseSchema,
  },
  {
    name: "change password",
    method: "POST",
    path: "/api/auth/password",
    as: "A",
    body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
    status: 204,
    schema: null,
  },
  {
    name: "register C (password reset subject)",
    method: "POST",
    path: "/api/auth/register",
    as: "anon",
    body: { email: EMAIL_C, name: "Carla", password: PASSWORD },
    status: 201,
    schema: AuthSessionResponseSchema,
    capture: (_body, c, response) => {
      c.cookieC = cookieOf(response);
    },
  },
  {
    name: "forgot password",
    method: "POST",
    path: "/api/auth/password/forgot",
    as: "anon",
    body: { email: EMAIL_C },
    status: 204,
    schema: null,
    capture: (_body, c) => {
      c.mailToken = tokenFromLastMail("reset-password");
    },
  },
  {
    name: "reset password",
    method: "POST",
    path: "/api/auth/password/reset",
    as: "anon",
    body: (c) => ({ token: c.mailToken, password: NEW_PASSWORD }),
    status: 204,
    schema: null,
  },

  /* -------------------------------- core: households ------------------------------- */
  {
    name: "households",
    method: "GET",
    path: "/api/households",
    as: "A",
    status: 200,
    schema: HouseholdListResponseSchema,
  },
  {
    name: "create household",
    method: "POST",
    path: "/api/households",
    as: "A",
    body: { name: "Familie Vertrag", description: "Zum Testen" },
    status: 201,
    schema: HouseholdResponseSchema,
    capture: (body, c) => {
      c.householdId = body.household.id;
    },
  },
  {
    name: "household detail",
    method: "GET",
    path: (c) => `/api/households/${c.householdId}`,
    as: "A",
    status: 200,
    schema: HouseholdDetailResponseSchema,
  },
  {
    name: "update household",
    method: "PATCH",
    path: (c) => `/api/households/${c.householdId}`,
    as: "A",
    body: { name: "Familie Vertrag 2", description: "Mit Beschreibung" },
    status: 200,
    schema: HouseholdResponseSchema,
  },
  {
    name: "create e-mail invite",
    method: "POST",
    path: (c) => `/api/households/${c.householdId}/invites`,
    as: "A",
    body: { email: EMAIL_B, role: "member" },
    status: 201,
    schema: HouseholdInviteResponseSchema,
    capture: (body, c) => {
      c.inviteToken = String(body.inviteUrl).split("/").at(-1) ?? "";
      c.inviteId = body.invite.id;
    },
  },
  {
    name: "invites",
    method: "GET",
    path: (c) => `/api/households/${c.householdId}/invites?limit=20&offset=0`,
    as: "A",
    status: 200,
    schema: HouseholdInviteListResponseSchema,
  },
  {
    name: "invite preview",
    method: "GET",
    path: (c) => `/api/households/invites/${c.inviteToken}`,
    as: "anon",
    status: 200,
    schema: InvitePreviewResponseSchema,
  },
  {
    name: "register B",
    method: "POST",
    path: "/api/auth/register",
    as: "anon",
    body: { email: EMAIL_B, name: "Ben", password: PASSWORD },
    status: 201,
    schema: AuthSessionResponseSchema,
    capture: (body, c, response) => {
      c.cookieB = cookieOf(response);
      c.userIdB = body.user.id;
    },
  },
  {
    name: "accept invite",
    method: "POST",
    path: "/api/households/invites/accept",
    as: "B",
    body: (c) => ({ token: c.inviteToken }),
    status: 200,
    schema: AcceptInviteResponseSchema,
  },
  {
    name: "members",
    method: "GET",
    path: (c) => `/api/households/${c.householdId}/members`,
    as: "A",
    status: 200,
    schema: HouseholdMemberListResponseSchema,
  },
  {
    name: "update member role",
    method: "PATCH",
    path: (c) => `/api/households/${c.householdId}/members/${c.userIdB}`,
    as: "A",
    body: { role: "admin" },
    status: 200,
    schema: HouseholdMemberResponseSchema,
  },
  {
    name: "create placeholder member",
    method: "POST",
    path: (c) => `/api/households/${c.householdId}/members`,
    as: "A",
    body: { displayName: "Oma" },
    status: 201,
    schema: HouseholdMemberResponseSchema,
    capture: (body, c) => {
      c.placeholderId = body.member.userId;
    },
  },
  {
    name: "rename placeholder member",
    method: "PATCH",
    path: (c) => `/api/households/${c.householdId}/members/${c.placeholderId}/placeholder`,
    as: "A",
    body: { name: "Oma Hilde" },
    status: 200,
    schema: HouseholdMemberResponseSchema,
  },
  {
    name: "create claim invite",
    method: "POST",
    path: (c) => `/api/households/${c.householdId}/invites`,
    as: "A",
    body: (c) => ({ claimsUserId: c.placeholderId }),
    status: 201,
    schema: HouseholdInviteResponseSchema,
    capture: (body, c) => {
      c.inviteId2 = body.invite.id;
    },
  },
  {
    name: "revoke invite",
    method: "DELETE",
    path: (c) => `/api/households/${c.householdId}/invites/${c.inviteId2}`,
    as: "A",
    status: 204,
    schema: null,
  },
  {
    name: "create scratch household",
    method: "POST",
    path: "/api/households",
    as: "A",
    body: { name: "Zweit" },
    status: 201,
    schema: HouseholdResponseSchema,
    capture: (body, c) => {
      c.scratchId = body.household.id;
    },
  },
  {
    name: "disable module",
    method: "DELETE",
    path: (c) => `/api/households/${c.scratchId}/modules/recipe`,
    as: "A",
    status: 204,
    schema: null,
  },
  {
    name: "enable module",
    method: "POST",
    path: (c) => `/api/households/${c.scratchId}/modules/recipe`,
    as: "A",
    body: {},
    status: 200,
    schema: HouseholdResponseSchema,
  },
  {
    name: "delete scratch household",
    method: "DELETE",
    path: (c) => `/api/households/${c.scratchId}`,
    as: "A",
    status: 204,
    schema: null,
  },

  /* ----------------------------------- recipe: recipes ---------------------------------- */
  {
    name: "create recipe",
    method: "POST",
    path: (c) => `${base(c)}/recipes`,
    as: "A",
    body: {
      title: "Gemüsesuppe",
      description: "Eine schnelle Suppe",
      servingsAmount: 4,
      servingsUnit: "Portionen",
      prepMinutes: 10,
      cookMinutes: 20,
      totalMinutes: 30,
      difficulty: "einfach",
      rating: 4,
      sourceUrl: "https://example.com/suppe",
      sourceName: "Beispiel",
      ingredients: [
        { name: "Karotten", quantity: 2, unit: "Stück" },
        { name: "Kartoffeln", quantity: 500, unit: "g", note: "mehlig" },
        { name: "Salz" },
      ],
      steps: [{ text: "Gemüse schneiden." }, { text: "Kochen." }],
      tags: ["Schnell", "Suppe"],
    },
    status: 201,
    schema: RecipeResponseSchema,
    capture: (body, c) => {
      c.recipeId = body.recipe.id;
    },
  },
  {
    name: "create second recipe",
    method: "POST",
    path: (c) => `${base(c)}/recipes`,
    as: "A",
    body: { title: "Pfannkuchen", servingsAmount: 2, ingredients: [{ name: "Mehl", quantity: 250, unit: "g" }], steps: [{ text: "Backen." }] },
    status: 201,
    schema: RecipeResponseSchema,
    capture: (body, c) => {
      c.recipeId2 = body.recipe.id;
    },
  },
  {
    name: "list recipes",
    method: "GET",
    path: (c) => `${base(c)}/recipes`,
    as: "A",
    status: 200,
    schema: RecipeListResponseSchema,
  },
  {
    name: "list recipes (filtered)",
    method: "GET",
    path: (c) => `${base(c)}/recipes?q=suppe&maxMinutes=60&difficulty=einfach&hasCooked=0&sort=title&limit=10&offset=0`,
    as: "A",
    status: 200,
    schema: RecipeListResponseSchema,
  },
  {
    name: "recipe detail",
    method: "GET",
    path: (c) => `${base(c)}/recipes/${c.recipeId}`,
    as: "A",
    status: 200,
    schema: RecipeResponseSchema,
  },
  {
    name: "update recipe",
    method: "PATCH",
    path: (c) => `${base(c)}/recipes/${c.recipeId}`,
    as: "A",
    body: { title: "Gemüsesuppe klassisch", rating: 5 },
    status: 200,
    schema: RecipeResponseSchema,
  },
  {
    name: "upload recipe image",
    method: "POST",
    path: (c) => `${base(c)}/recipes/${c.recipeId}/image`,
    as: "A",
    form: () => {
      const form = new FormData();
      form.append("file", new File([PNG], "foto.png", { type: "image/png" }));
      return form;
    },
    status: 200,
    schema: UploadResponseSchema,
    capture: (body) => {
      uploadsToRemove.push(body.filename);
    },
  },
  {
    name: "recipe detail with image",
    method: "GET",
    path: (c) => `${base(c)}/recipes/${c.recipeId}`,
    as: "A",
    status: 200,
    schema: RecipeResponseSchema,
  },
  {
    name: "scale recipe",
    method: "GET",
    path: (c) => `${base(c)}/recipes/${c.recipeId}/scale?servings=6`,
    as: "A",
    status: 200,
    schema: ScaledRecipeResponseSchema,
  },
  {
    name: "mark recipe cooked",
    method: "POST",
    path: (c) => `${base(c)}/recipes/${c.recipeId}/cooked`,
    as: "A",
    body: { plannedOn: PLAN_FROM },
    status: 200,
    schema: RecipeCookedResponseSchema,
  },
  {
    name: "recipe detail after cooking",
    method: "GET",
    path: (c) => `${base(c)}/recipes/${c.recipeId}`,
    as: "A",
    status: 200,
    schema: RecipeResponseSchema,
  },
  {
    name: "undo cooked",
    method: "DELETE",
    path: (c) => `${base(c)}/recipes/${c.recipeId}/cooked`,
    as: "A",
    status: 204,
    schema: null,
  },

  /* ------------------------------------- recipe: tags ------------------------------------ */
  {
    name: "tags",
    method: "GET",
    path: (c) => `${base(c)}/tags`,
    as: "A",
    status: 200,
    schema: TagListResponseSchema,
  },
  {
    name: "create tag",
    method: "POST",
    path: (c) => `${base(c)}/tags`,
    as: "A",
    body: { name: "Herbst", color: "#aa5500", kind: "free" },
    status: 201,
    schema: TagResponseSchema,
    capture: (body, c) => {
      c.tagId = body.tag.id;
    },
  },
  {
    name: "update tag",
    method: "PATCH",
    path: (c) => `${base(c)}/tags/${c.tagId}`,
    as: "A",
    body: { name: "Herbstküche" },
    status: 200,
    schema: TagResponseSchema,
  },
  {
    name: "delete tag",
    method: "DELETE",
    path: (c) => `${base(c)}/tags/${c.tagId}`,
    as: "A",
    status: 204,
    schema: null,
  },

  /* --------------------------------- recipe: collections --------------------------------- */
  {
    name: "create collection",
    method: "POST",
    path: (c) => `${base(c)}/collections`,
    as: "A",
    body: (c) => ({ name: "Winter", description: "Warmes", recipeIds: [c.recipeId] }),
    status: 201,
    schema: CollectionResponseSchema,
    capture: (body, c) => {
      c.collectionId = body.collection.id;
    },
  },
  {
    name: "collections",
    method: "GET",
    path: (c) => `${base(c)}/collections`,
    as: "A",
    status: 200,
    schema: CollectionListResponseSchema,
  },
  {
    name: "collection detail",
    method: "GET",
    path: (c) => `${base(c)}/collections/${c.collectionId}`,
    as: "A",
    status: 200,
    schema: CollectionDetailResponseSchema,
  },
  {
    name: "update collection",
    method: "PATCH",
    path: (c) => `${base(c)}/collections/${c.collectionId}`,
    as: "A",
    body: { name: "Winterküche" },
    status: 200,
    schema: CollectionResponseSchema,
  },
  {
    name: "add recipe to collection",
    method: "PUT",
    path: (c) => `${base(c)}/collections/${c.collectionId}/recipes/${c.recipeId2}`,
    as: "A",
    status: 204,
    schema: null,
  },
  {
    name: "remove recipe from collection",
    method: "DELETE",
    path: (c) => `${base(c)}/collections/${c.collectionId}/recipes/${c.recipeId2}`,
    as: "A",
    status: 204,
    schema: null,
  },
  {
    name: "collection detail after changes",
    method: "GET",
    path: (c) => `${base(c)}/collections/${c.collectionId}`,
    as: "A",
    status: 200,
    schema: CollectionDetailResponseSchema,
  },

  /* ------------------------------------ recipe: plan ------------------------------------- */
  {
    name: "create plan entry",
    method: "POST",
    path: (c) => `${base(c)}/plan`,
    as: "A",
    body: (c) => ({ recipeId: c.recipeId, plannedOn: PLAN_FROM, servings: 3, note: "Sonntag" }),
    status: 201,
    schema: MealPlanEntryResponseSchema,
    capture: (body, c) => {
      c.entryId = body.entry.id;
    },
  },
  {
    name: "plan range",
    method: "GET",
    path: (c) => `${base(c)}/plan?from=${PLAN_FROM}&to=${PLAN_TO}`,
    as: "A",
    status: 200,
    schema: MealPlanRangeResponseSchema,
  },
  {
    name: "last planned",
    method: "GET",
    path: (c) => `${base(c)}/plan/last-planned?before=2030-02-01`,
    as: "A",
    status: 200,
    schema: LastPlannedResponseSchema,
  },
  {
    name: "update plan entry",
    method: "PATCH",
    path: (c) => `${base(c)}/plan/${c.entryId}`,
    as: "A",
    body: { plannedOn: "2030-01-08", note: null },
    status: 200,
    schema: MealPlanEntryResponseSchema,
  },

  /* ---------------------------------- recipe: imports ------------------------------------ */
  // `imports/url` fetches a remote page and `imports/image` / `imports/pdf` need the OCR and PDF
  // tool chain: they are covered by apps/api/test/import/, not here (see the file header).
  {
    name: "import text",
    method: "POST",
    path: (c) => `${base(c)}/imports/text`,
    as: "A",
    body: {
      rawText: [
        "Griessbrei",
        "2 Portionen",
        "Zutaten",
        "500 ml Milch",
        "60 g Weichweizengriess",
        "Zubereitung",
        "1. Milch aufkochen.",
        "2. Griess einruehren.",
      ].join("\n"),
    },
    status: 201,
    schema: ImportDraftResponseSchema,
    capture: (body, c) => {
      c.draftId = body.draft.id;
      c.parsed = body.draft.parsed;
    },
  },
  {
    name: "import text (second draft)",
    method: "POST",
    path: (c) => `${base(c)}/imports/text`,
    as: "A",
    body: { rawText: "Zwiebelkuchen\nZutaten\n3 Zwiebeln\nZubereitung\n1. Backen." },
    status: 201,
    schema: ImportDraftResponseSchema,
    capture: (body, c) => {
      c.draftId2 = body.draft.id;
    },
  },
  {
    name: "import drafts",
    method: "GET",
    path: (c) => `${base(c)}/imports?status=pending&limit=20&offset=0`,
    as: "A",
    status: 200,
    schema: ImportDraftListResponseSchema,
  },
  {
    name: "import draft",
    method: "GET",
    path: (c) => `${base(c)}/imports/${c.draftId}`,
    as: "A",
    status: 200,
    schema: ImportDraftResponseSchema,
  },
  {
    name: "update import draft",
    method: "PATCH",
    path: (c) => `${base(c)}/imports/${c.draftId}`,
    as: "A",
    body: (c) => ({ parsed: { ...c.parsed, title: "Griessbrei mit Zimt" } }),
    status: 200,
    schema: ImportDraftResponseSchema,
  },
  {
    name: "commit import draft",
    method: "POST",
    path: (c) => `${base(c)}/imports/${c.draftId}/commit`,
    as: "A",
    body: { tags: ["Frühstück"] },
    status: 201,
    schema: CommitImportDraftResponseSchema,
  },
  {
    name: "delete import draft",
    method: "DELETE",
    path: (c) => `${base(c)}/imports/${c.draftId2}`,
    as: "A",
    status: 204,
    schema: null,
  },

  /* ---------------------------------- recipe: shopping ----------------------------------- */
  {
    name: "create shopping list",
    method: "POST",
    path: (c) => `${base(c)}/shopping-lists`,
    as: "A",
    body: { name: "Wocheneinkauf" },
    status: 201,
    schema: ShoppingListResponseSchema,
    capture: (body, c) => {
      c.listId = body.list.id;
    },
  },
  {
    name: "shopping lists",
    method: "GET",
    path: (c) => `${base(c)}/shopping-lists`,
    as: "A",
    status: 200,
    schema: ShoppingListListResponseSchema,
  },
  {
    name: "update shopping list",
    method: "PATCH",
    path: (c) => listBase(c),
    as: "A",
    body: { name: "Wocheneinkauf Samstag" },
    status: 200,
    schema: ShoppingListResponseSchema,
  },
  {
    name: "add shopping items",
    method: "POST",
    path: (c) => `${listBase(c)}/items`,
    as: "A",
    body: {
      items: [{ name: "Mehl", quantity: 500, unit: "g" }, { name: "Salz" }, { name: "Milch", quantity: 1, unit: "l", note: "Bio" }],
      mutationId: crypto.randomUUID(),
    },
    status: 200,
    schema: ShoppingListDetailResponseSchema,
    capture: (body, c) => {
      const byName = (name: string) => body.items.find((item: { name: string }) => item.name === name).id as string;
      c.itemId = byName("Mehl");
      c.itemId2 = byName("Salz");
    },
  },
  {
    name: "update shopping item",
    method: "PATCH",
    path: (c) => `${listBase(c)}/items/${c.itemId2}`,
    as: "A",
    body: { name: "Meersalz", note: "fein" },
    status: 200,
    schema: ShoppingListDetailResponseSchema,
  },
  {
    name: "check shopping item (outbox write)",
    method: "POST",
    path: (c) => `${listBase(c)}/items/${c.itemId}/check`,
    as: "A",
    body: { mutationId: crypto.randomUUID() },
    status: 200,
    schema: ShoppingListDetailResponseSchema,
    capture: (body, c) => {
      c.boughtId = body.bought[0].id;
      c.catalogId = body.catalog[0].id;
    },
  },
  {
    name: "shopping list detail",
    method: "GET",
    path: (c) => listBase(c),
    as: "A",
    status: 200,
    schema: ShoppingListDetailResponseSchema,
  },
  {
    name: "undo bought item (uncheck, outbox write)",
    method: "POST",
    path: (c) => `${listBase(c)}/bought/${c.boughtId}/undo`,
    as: "A",
    body: { mutationId: crypto.randomUUID() },
    status: 200,
    schema: ShoppingListDetailResponseSchema,
    capture: (body, c) => {
      c.itemId = body.items.find((item: { name: string }) => item.name === "Mehl").id;
    },
  },
  {
    name: "check shopping item again",
    method: "POST",
    path: (c) => `${listBase(c)}/items/${c.itemId}/check`,
    as: "A",
    body: {},
    status: 200,
    schema: ShoppingListDetailResponseSchema,
    capture: (body, c) => {
      c.boughtId = body.bought[0].id;
      c.catalogId = body.catalog[0].id;
    },
  },
  {
    name: "hide catalog entry (outbox write)",
    method: "PATCH",
    path: (c) => `${listBase(c)}/catalog/${c.catalogId}`,
    as: "A",
    body: { hidden: true },
    status: 200,
    schema: ShoppingListDetailResponseSchema,
  },
  {
    name: "unhide catalog entry",
    method: "PATCH",
    path: (c) => `${listBase(c)}/catalog/${c.catalogId}`,
    as: "A",
    body: { hidden: false },
    status: 200,
    schema: ShoppingListDetailResponseSchema,
  },
  {
    name: "shopping catalog page",
    method: "GET",
    path: (c) => `${listBase(c)}/catalog?includeHidden=1&limit=20&offset=0`,
    as: "A",
    status: 200,
    schema: ShoppingCatalogListResponseSchema,
  },
  {
    name: "add catalog entry to list",
    method: "POST",
    path: (c) => `${listBase(c)}/catalog/${c.catalogId}`,
    as: "A",
    body: {},
    status: 200,
    schema: ShoppingListDetailResponseSchema,
  },
  {
    name: "shopping bought history",
    method: "GET",
    path: (c) => `${base(c)}/shopping-lists/bought?listId=${c.listId}&limit=20&offset=0`,
    as: "A",
    status: 200,
    schema: ShoppingBoughtListResponseSchema,
  },
  {
    name: "add recipe to shopping list",
    method: "POST",
    path: (c) => `${listBase(c)}/recipes`,
    as: "A",
    body: (c) => ({ recipeId: c.recipeId, servings: 8 }),
    status: 200,
    schema: ShoppingListDetailResponseSchema,
  },
  {
    name: "remove recipe from shopping list",
    method: "DELETE",
    path: (c) => `${listBase(c)}/recipes/${c.recipeId}`,
    as: "A",
    status: 200,
    schema: ShoppingListDetailResponseSchema,
  },
  {
    name: "plan shopping preview",
    method: "GET",
    path: (c) => `${listBase(c)}/from-plan?from=${PLAN_FROM}&to=${PLAN_TO}`,
    as: "A",
    status: 200,
    schema: PlanShoppingPreviewResponseSchema,
  },
  {
    name: "delete shopping item",
    method: "DELETE",
    path: (c) => `${listBase(c)}/items/${c.itemId2}`,
    as: "A",
    status: 200,
    schema: ShoppingListDetailResponseSchema,
  },
  {
    name: "clear bought section",
    method: "POST",
    path: (c) => `${listBase(c)}/bought/clear`,
    as: "A",
    status: 200,
    schema: ShoppingListDetailResponseSchema,
  },
  {
    name: "clear shopping list",
    method: "DELETE",
    path: (c) => `${listBase(c)}/items`,
    as: "A",
    status: 200,
    schema: ShoppingListDetailResponseSchema,
  },
  {
    name: "delete shopping catalog entry",
    method: "DELETE",
    path: (c) => `${listBase(c)}/catalog/${c.catalogId}`,
    as: "A",
    status: 204,
    schema: null,
  },
  {
    name: "delete shopping list",
    method: "DELETE",
    path: (c) => listBase(c),
    as: "A",
    status: 204,
    schema: null,
  },

  /* ----------------------------- recipe: plan and recipe cleanup -------------------------- */
  {
    name: "delete plan entry",
    method: "DELETE",
    path: (c) => `${base(c)}/plan/${c.entryId}`,
    as: "A",
    status: 204,
    schema: null,
  },
  {
    name: "delete collection",
    method: "DELETE",
    path: (c) => `${base(c)}/collections/${c.collectionId}`,
    as: "A",
    status: 204,
    schema: null,
  },
  {
    name: "delete recipe",
    method: "DELETE",
    path: (c) => `${base(c)}/recipes/${c.recipeId2}`,
    as: "A",
    status: 204,
    schema: null,
  },

  /* ------------------------------------ recipe: cards ------------------------------------- */
  {
    name: "create card",
    method: "POST",
    path: "/api/recipe/cards",
    as: "A",
    body: { label: "Payback", format: "ean13", value: "4012345678901", note: "Familienkarte" },
    status: 201,
    schema: CardResponseSchema,
    capture: (body, c) => {
      c.cardId = body.card.id;
    },
  },
  {
    name: "cards",
    method: "GET",
    path: "/api/recipe/cards",
    as: "A",
    status: 200,
    schema: CardListResponseSchema,
  },
  {
    name: "update card",
    method: "PATCH",
    path: (c) => `/api/recipe/cards/${c.cardId}`,
    as: "A",
    body: { label: "Payback Anna" },
    status: 200,
    schema: CardResponseSchema,
  },
  {
    name: "mark card used",
    method: "POST",
    path: (c) => `/api/recipe/cards/${c.cardId}/used`,
    as: "A",
    status: 200,
    schema: CardResponseSchema,
  },
  {
    name: "delete card",
    method: "DELETE",
    path: (c) => `/api/recipe/cards/${c.cardId}`,
    as: "A",
    status: 204,
    schema: null,
  },

  /* ------------------------------- core: members, last ------------------------------------ */
  {
    name: "remove placeholder member",
    method: "DELETE",
    path: (c) => `/api/households/${c.householdId}/members/${c.placeholderId}`,
    as: "A",
    status: 204,
    schema: null,
  },
  {
    name: "remove member B",
    method: "DELETE",
    path: (c) => `/api/households/${c.householdId}/members/${c.userIdB}`,
    as: "A",
    status: 204,
    schema: null,
  },
  {
    name: "delete household",
    method: "DELETE",
    path: (c) => `/api/households/${c.householdId}`,
    as: "A",
    status: 204,
    schema: null,
  },
];

/* -------------------------------------------------------------------------- */
/* the oracle                                                                 */
/* -------------------------------------------------------------------------- */

/** The number of JSON rows (rows with a response schema); the commit body states it. */
const JSON_ROWS = 83;

describe("web contract: core and recipe responses decode as the identity", () => {
  for (const row of rows) {
    test(`${row.method} ${row.name}`, async () => {
      const response = await send(row);
      if (response.status !== row.status) {
        throw new Error(`${row.name}: expected ${row.status}, got ${response.status}: ${await response.text()}`);
      }
      if (row.schema === null) {
        expect(response.status).toBe(row.status);
        expect(await response.text()).toBe("");
        row.capture?.(undefined, ctx, response);
        return;
      }
      const body = await response.json();
      expect(response.status).toBe(row.status);
      row.capture?.(body, ctx, response);

      const decode = Schema.decodeUnknownSync(row.schema as Schema.Decoder<unknown>, DECODE_OPTIONS);
      if (row.lenient !== undefined) {
        // The body is the wire truth; the schema is knowingly stricter or narrower (P7c).
        expect(typeof body).toBe("object");
        return;
      }
      const decoded = decode(body);
      expect(decoded).toEqual(body);
    });
  }

  test("the table covers the JSON routes (row count is stable)", () => {
    const json = rows.filter((row) => row.schema !== null);
    // The count is stated in the commit body (E6-T02); a row added or removed must update it.
    expect(json.length).toBe(JSON_ROWS);
  });
});
