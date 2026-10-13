import { describe, expect, test } from "bun:test";
import {
  AuthSessionResponseSchema,
  DEFAULT_ENABLED_MODULES,
  EnableModuleRequestSchema,
  HouseholdMemberSchema,
  HouseholdWithRoleSchema,
  InvitePreviewResponseSchema,
  ModuleIdSchema,
  MODULE_IDS,
} from "../src/index.ts";

const UUID = "11111111-1111-4111-8111-111111111111";
const ISO = "2026-10-13T10:00:00.000Z";
const USER = {
  id: UUID,
  email: "eric@example.com",
  name: "Eric",
  emailVerified: false,
  hasPassword: true,
  createdAt: ISO,
  updatedAt: ISO,
};

const household = {
  id: UUID,
  name: "Meine Rezepte",
  createdBy: UUID,
  createdAt: ISO,
  updatedAt: ISO,
  role: "owner",
  memberCount: 1,
};

describe("household contract", () => {
  test("(a) HouseholdWithRoleSchema requires modules and rejects recipeCount without it", () => {
    expect(HouseholdWithRoleSchema.safeParse({ ...household, modules: ["recipe"] }).success).toBe(
      true,
    );
    const { modules: _modules, ...withoutModules } = { ...household, modules: ["recipe"] };
    expect(
      HouseholdWithRoleSchema.safeParse({ ...withoutModules, recipeCount: 3 }).success,
    ).toBe(false);
  });

  test("(b) InvitePreviewResponseSchema requires householdName", () => {
    const preview = {
      invitedByName: "Eric",
      email: "anna@example.com",
      role: "member",
      status: "pending",
      expiresAt: ISO,
    };
    expect(InvitePreviewResponseSchema.safeParse({ ...preview, householdName: "X" }).success).toBe(
      true,
    );
    expect(InvitePreviewResponseSchema.safeParse({ ...preview, groupName: "X" }).success).toBe(
      false,
    );
  });

  test("(c) AuthSessionResponseSchema parses an empty session", () => {
    expect(
      AuthSessionResponseSchema.safeParse({
        user: { ...USER, activeHouseholdId: null },
        households: [],
        activeHouseholdId: null,
      }).success,
    ).toBe(true);
  });

  test("(d) DEFAULT_ENABLED_MODULES is a subset of MODULE_IDS and ModuleIdSchema rejects unknown ids", () => {
    for (const id of DEFAULT_ENABLED_MODULES) {
      expect((MODULE_IDS as readonly string[]).includes(id)).toBe(true);
    }
    expect(ModuleIdSchema.safeParse("recipe").success).toBe(true);
    expect(ModuleIdSchema.safeParse("nope").success).toBe(false);
  });

  test("(e) EnableModuleRequestSchema accepts {} and object settings, rejects non-object settings", () => {
    expect(EnableModuleRequestSchema.safeParse({}).success).toBe(true);
    expect(EnableModuleRequestSchema.safeParse({ settings: { a: 1 } }).success).toBe(true);
    expect(EnableModuleRequestSchema.safeParse({ settings: 1 }).success).toBe(false);
  });

  test("(f) HouseholdMemberSchema has householdId, not groupId", () => {
    const member = {
      id: UUID,
      userId: UUID,
      role: "member",
      createdAt: ISO,
      user: { id: UUID, name: "Eric", email: "eric@example.com" },
    };
    expect(HouseholdMemberSchema.safeParse({ ...member, householdId: UUID }).success).toBe(true);
    expect(HouseholdMemberSchema.safeParse({ ...member, groupId: UUID }).success).toBe(false);
  });
});
