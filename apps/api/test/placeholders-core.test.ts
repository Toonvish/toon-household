/**
 * Placeholder members in the core, the contract half (ADR 0006, plan m3b decisions 1 and 5,
 * T01 step 8). The routes that create, rename, remove and claim placeholders arrive in T05
 * (`placeholders.test.ts`); here: the one predicate, the `/me` mapper's refusal, and the wire
 * shapes the mappers produce for a placeholder row (inserted directly into the shared DB).
 *
 * The `/me` 401 is not reachable through HTTP (no login path can produce a session for a
 * placeholder), so `toUserDto` is called directly.
 */
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { type UserRow, householdInvites, householdMembers, households, users } from "../src/db/schema.ts";
import { isPlaceholderUser, requireAccountEmail, toUserDto } from "../src/core/services/auth/users.ts";
import { listMembers } from "../src/core/services/households/households.service.ts";
import { previewInvite } from "../src/core/services/households/invites.service.ts";
import { toHouseholdInvite } from "../src/core/services/households/mappers.ts";
import { ApiError } from "../src/lib/errors.ts";

await runMigrations(db);

function userRow(overrides: Partial<UserRow>): UserRow {
  return {
    id: crypto.randomUUID(),
    email: "anna@toon.test",
    name: "Anna",
    avatarUrl: null,
    emailVerified: false,
    emailVerifiedAt: null,
    passwordHash: "$argon2id$v=19$m=65536,t=2,p=1$x$y",
    activeHouseholdId: null,
    locale: null,
    createdAt: 1_790_000_000_000,
    updatedAt: 1_790_000_000_000,
    ...overrides,
  };
}

describe("isPlaceholderUser (decision 1: e-mail AND password hash are NULL)", () => {
  test("an account with e-mail and password is not a placeholder", () => {
    expect(isPlaceholderUser(userRow({}))).toBe(false);
  });

  test("an OAuth-only account (NULL hash, e-mail set) is not a placeholder", () => {
    expect(isPlaceholderUser(userRow({ passwordHash: null }))).toBe(false);
  });

  test("a row without e-mail and without password is a placeholder", () => {
    expect(isPlaceholderUser(userRow({ email: null, passwordHash: null }))).toBe(true);
  });
});

describe("toUserDto refuses a placeholder (toon-finance requireAccountEmail)", () => {
  test("an account maps with its e-mail", () => {
    expect(toUserDto(userRow({})).email).toBe("anna@toon.test");
    expect(requireAccountEmail({ email: "anna@toon.test" })).toBe("anna@toon.test");
  });

  test("a placeholder row is a 401, never an empty address", () => {
    const placeholder = userRow({ email: null, passwordHash: null });
    let caught: unknown;
    try {
      toUserDto(placeholder);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(401);
    expect((caught as ApiError).code).toBe("unauthorized");
    expect(() => requireAccountEmail({ email: null })).toThrow(ApiError);
  });
});

describe("wire shapes for placeholders and claim invites (decision 5)", () => {
  test("listMembers: an account has hasAccount true, a placeholder has a NULL e-mail and hasAccount false", async () => {
    const ownerId = crypto.randomUUID();
    const placeholderId = crypto.randomUUID();
    const oauthId = crypto.randomUUID();
    const householdId = crypto.randomUUID();
    await db.insert(users).values([
      { id: ownerId, email: `owner.${ownerId.slice(0, 8)}@toon.test`, name: "Owner", passwordHash: "hash" },
      { id: oauthId, email: `oauth.${oauthId.slice(0, 8)}@toon.test`, name: "OAuth", passwordHash: null },
      { id: placeholderId, email: null, name: "Pia", passwordHash: null },
    ]);
    await db.insert(households).values({ id: householdId, name: "Platzhalter", createdBy: ownerId });
    await db.insert(householdMembers).values([
      { id: crypto.randomUUID(), householdId, userId: ownerId, role: "owner", createdAt: 1 },
      { id: crypto.randomUUID(), householdId, userId: oauthId, role: "member", createdAt: 2 },
      { id: crypto.randomUUID(), householdId, userId: placeholderId, role: "member", createdAt: 3 },
    ]);

    const members = await listMembers(db, householdId);
    expect(members.map((member) => [member.user.name, member.user.email === null, member.hasAccount])).toEqual([
      ["Owner", false, true],
      ["OAuth", false, true],
      ["Pia", true, false],
    ]);

    // A claim invite without an address: the mapper and the public preview pass the NULL through;
    // the preview names the placeholder it hands over (T05, plan m3b decision 4).
    const token = `claim-${crypto.randomUUID()}`;
    const inviteId = crypto.randomUUID();
    await db.insert(householdInvites).values({
      id: inviteId,
      householdId,
      email: null,
      role: "member",
      token,
      status: "pending",
      invitedBy: ownerId,
      expiresAt: Date.now() + 60_000,
      claimsUserId: placeholderId,
    });
    const [row] = await db.select().from(householdInvites).where(eq(householdInvites.id, inviteId));
    if (!row) throw new Error("invite row missing");
    const invite = toHouseholdInvite(row, "Owner");
    expect(invite.email).toBeNull();
    expect(invite.claimsUserId).toBe(placeholderId);

    const preview = await previewInvite(db, token);
    expect(preview.email).toBeNull();
    expect(preview.claimsDisplayName).toBe("Pia");
    expect(preview.householdName).toBe("Platzhalter");
  });
});
