import { describe, expect, test } from "bun:test";
import {
  ERROR_CODES,
  HealthResponseSchema,
  type HouseholdRole,
  ROLE_RANK,
  resolveWireKey,
  roleAtLeast,
} from "../src/index.ts";
import { MODULE_IDS, isModuleId } from "../src/modules/registry.ts";

describe("module registry", () => {
  test("MODULE_IDS lists the modules in display order", () => {
    expect([...MODULE_IDS]).toEqual(["recipe", "finance"]);
  });

  test("isModuleId accepts known ids and rejects others", () => {
    expect(isModuleId("recipe")).toBe(true);
    expect(isModuleId("groups")).toBe(false);
  });
});

describe("HealthResponseSchema", () => {
  const healthy = {
    ok: true,
    status: "ok",
    version: "0.1.0",
    time: "2026-10-13T10:00:00.000Z",
    database: "file",
    modules: [],
    features: { verifiedEmailRequired: false, ocrImport: true },
  };

  test("accepts a healthy answer with ok and modules", () => {
    expect(HealthResponseSchema.parse(healthy)).toMatchObject({ ok: true, modules: [] });
  });

  test("rejects the same object without ok", () => {
    const { ok: _ok, ...withoutOk } = healthy;
    expect(HealthResponseSchema.safeParse(withoutOk).success).toBe(false);
  });
});

describe("ERROR_CODES", () => {
  test("contains module_disabled", () => {
    expect(ERROR_CODES).toContain("module_disabled");
  });
});

describe("roleAtLeast", () => {
  // [role, required, expected]
  const matrix: [HouseholdRole, HouseholdRole, boolean][] = [
    ["owner", "owner", true],
    ["owner", "admin", true],
    ["owner", "member", true],
    ["admin", "owner", false],
    ["admin", "admin", true],
    ["admin", "member", true],
    ["member", "owner", false],
    ["member", "admin", false],
    ["member", "member", true],
  ];

  for (const [role, required, expected] of matrix) {
    test(`${role} >= ${required} is ${expected}`, () => {
      expect(roleAtLeast(role, required)).toBe(expected);
    });
  }

  test("ROLE_RANK orders owner > admin > member", () => {
    expect(ROLE_RANK.owner).toBeGreaterThan(ROLE_RANK.admin);
    expect(ROLE_RANK.admin).toBeGreaterThan(ROLE_RANK.member);
  });
});

describe("resolveWireKey", () => {
  test("resolves server.module.disabled in German", () => {
    expect(resolveWireKey("de", "server.module.disabled")).toBe(
      "Dieses Modul ist für diesen Haushalt nicht aktiviert.",
    );
  });

  test("resolves server.module.disabled in English", () => {
    expect(resolveWireKey("en", "server.module.disabled")).toBe(
      "This module is not enabled for this household.",
    );
  });
});
