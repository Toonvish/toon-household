/**
 * The pure enabled-module helpers (SPEC §2, §5). Fed fake `WebModule` objects — no real
 * module, no registry import.
 */
import { describe, expect, test } from "bun:test";
import type { ModuleId } from "@toon/shared";
import { availableWebModules, enabledWebModules, isModuleEnabled, moduleGuard } from "./enabled";
import type { WebModule } from "./types";

function fake(id: ModuleId): WebModule {
  return {
    id,
    basePath: `/${id}`,
    route: undefined,
    homeCard: () => null,
  } as unknown as WebModule;
}

const recipe = fake("recipe");
const finance = fake("finance");
const registry = [recipe, finance];

describe("moduleGuard", () => {
  test("an enabled module renders", () => {
    expect(moduleGuard(["recipe"], "recipe")).toBe("render");
  });

  test("no enabled modules redirects", () => {
    expect(moduleGuard([], "recipe")).toBe("redirect");
  });

  test("another module being enabled does not count", () => {
    expect(moduleGuard(["finance"], "recipe")).toBe("redirect");
  });

  test("an unknown id next to the module is ignored", () => {
    expect(moduleGuard(["legacy-x", "recipe"], "recipe")).toBe("render");
  });
});

describe("isModuleEnabled", () => {
  test("matches by id only", () => {
    expect(isModuleEnabled(["recipe"], "recipe")).toBe(true);
    expect(isModuleEnabled(["recipe"], "finance")).toBe(false);
  });
});

describe("enabledWebModules", () => {
  test("keeps registry order, not the order of the ids, and ignores unknown ids", () => {
    expect(enabledWebModules(registry, ["finance", "legacy-x", "recipe"])).toEqual([recipe, finance]);
  });

  test("nothing enabled yields nothing", () => {
    expect(enabledWebModules(registry, [])).toEqual([]);
  });
});

describe("availableWebModules", () => {
  test("the build modules that are not enabled", () => {
    expect(availableWebModules(registry, ["recipe", "legacy-x"])).toEqual([finance]);
    expect(availableWebModules(registry, ["recipe", "finance"])).toEqual([]);
    expect(availableWebModules([], ["recipe"])).toEqual([]);
  });
});
