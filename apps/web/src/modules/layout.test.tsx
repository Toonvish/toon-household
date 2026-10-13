/**
 * Executable half of the M1 exit criterion "a route under a disabled module redirects to
 * Home" (plan m1-core §1 decision 8, M1-T10 work 1b). The other half is `moduleGuard` in
 * `enabled.test.ts`; together they prove every module layout renders `<RequireModule
 * moduleId>` around its `<Outlet/>`, and `RequireModule` redirects on `"redirect"`.
 *
 * No DOM needed: `ModuleLayout` uses no hooks, so calling it returns the element tree.
 * Never delete this test — it is the proof, not a smoke check.
 */
import { describe, expect, test } from "bun:test";
import { Outlet } from "@tanstack/react-router";
import { MODULE_IDS, type ModuleId } from "@toon/shared";
import type { ReactElement } from "react";
import { RequireModule } from "@/lib/session";
import { moduleLayoutComponent } from "./layout";

interface LayoutProps {
  moduleId: ModuleId;
  children: ReactElement;
}

describe("moduleLayoutComponent", () => {
  for (const id of ["recipe", "finance"] as const) {
    test(`${id}: <RequireModule moduleId="${id}"><Outlet/></RequireModule>`, () => {
      const el = moduleLayoutComponent(id)() as ReactElement<LayoutProps>;
      expect(el.type).toBe(RequireModule);
      expect(el.props.moduleId).toBe(id);
      expect(el.props.children.type).toBe(Outlet);
    });
  }

  test("covers every registered module id", () => {
    for (const id of MODULE_IDS) {
      const el = moduleLayoutComponent(id)() as ReactElement<LayoutProps>;
      expect(el.type).toBe(RequireModule);
      expect(el.props.moduleId).toBe(id);
    }
  });
});
