/**
 * The web half of the module contract (SPEC §2). A module is `apps/web/src/modules/<id>/`
 * plus ONE manifest of this type, exported from its `index.ts` and listed in
 * `modules/index.ts`. Nothing outside the module's directory knows its routes, screens,
 * query keys or catalogs except through this manifest.
 *
 * Rules (SPEC §2, D6, D9, D10):
 *  - A module never imports from another module's directory; the core imports a module
 *    only through `modules/index.ts` (manifests) and `modules/catalogs.ts` (catalogs).
 *  - Query keys are `["toon","household",<id>,"<module>",…]` for household data and
 *    `["toon","<module>",…]` for user data.
 *  - Nav items carry catalog KEYS, never labels.
 *  - Cross-household guard (D8): a module screen takes the household from the active
 *    household / URL only; the API answers `404 not_found` for an id of another
 *    household, so a screen never "resolves" a foreign id itself.
 */
import type { QueryClient } from "@tanstack/react-query";
import type { AnyRoute } from "@tanstack/react-router";
import type { ModuleId, NamespaceCatalog } from "@toon/shared";
import type { LucideIcon } from "lucide-react";
import type { ComponentType } from "react";
import type { NavItem } from "@/components/layout/nav-items";
import type { MessageKey } from "@/lib/i18n";
import type { QueryKeyPrefix } from "@/lib/persist";

export interface WebModule<Id extends ModuleId = ModuleId> {
  id: Id;
  /** Catalog key of the module's display name, e.g. `"recipe.module.name"`. */
  nameKey: MessageKey;
  icon: LucideIcon;
  /** The module's URL prefix; the active module IS the URL prefix (SPEC §5). */
  basePath: `/${Id}`;
  /**
   * The module's layout route at `basePath`, owned by the module (`modules/<id>/routes.tsx`,
   * plan m2-recipe-module §1 decision 10): built with `component: moduleLayoutComponent(id)`
   * (`@/modules/layout`) and `getParentRoute: () => householdScopedRoute` (`@/route-roots`),
   * its children attached with `addChildren`; the first child is the module home.
   * `router.tsx` adds it under `householdScopedRoute`. Screens are `lazyRouteComponent`s
   * (R gotcha: a hand-rolled lazy wrapper kills intent preloading), which also keeps them —
   * and the shell they import — out of the manifest's static import graph (decision 15).
   */
  route: AnyRoute;
  /** Exactly three; the shell appends the shared Profil tab (M1, SPEC D6). */
  navItems: NavItem[];
  /** Sidebar-only; each one must also be reachable from a tab screen (D6). */
  secondaryNavItems: NavItem[];
  /** The module's card on Home (SPEC §5). */
  homeCard: ComponentType;
  /** Query-key prefixes whose data is persisted for offline reading (SPEC D9). */
  persistQueryAllowList: QueryKeyPrefix[];
  /**
   * Key paths after `"toon"` whose PAUSED mutations are persisted, e.g.
   * `["finance","tx"]` matches `["toon","finance","tx",…]`; pair it with
   * `mutationDefaults` (SPEC D9) — a restored mutation carries its variables but not
   * its function, so every declared namespace needs a `setMutationDefaults` there.
   * A §2 contract extension (docs/plans/m0-scaffold.md §1 decision 8).
   */
  persistMutationNamespaces?: readonly (readonly string[])[];
  /**
   * Offline outbox registration (`queryClient.setMutationDefaults`). `app.tsx` calls it
   * at module scope, before the persister restores and replays paused mutations.
   */
  mutationDefaults?(queryClient: QueryClient): void;
  /**
   * The module's two catalogs, keys prefixed `<id>.`. The TYPE-level registration is
   * `modules/catalogs.ts` (literal-typed spread), not this field — this one is the
   * runtime handle (e.g. for tests that walk every module's catalogs).
   *
   * `en` is typed like `de` (prefixed keys, string-or-plural values). The per-key
   * `en`-mirrors-`de` check is `LocaleCatalog<typeof xDe>` on each namespace file; here,
   * `LocaleCatalog<NamespaceCatalog<Id>>` would demand a plural for EVERY key (its
   * conditional sees the wide `string | PluralForms` value), which no real catalog meets —
   * the first real manifest (M2 recipe) proved it.
   */
  catalogs: {
    de: NamespaceCatalog<Id>;
    en: NamespaceCatalog<Id>;
  };
  /** Rendered on `/settings` while the module is enabled (finance: participants, D3). */
  settingsSections?: ComponentType[];
  /**
   * The module's own "Aktivieren" dialog, for a module that cannot be enabled without
   * settings (finance: the two participants, SPEC D3). When present, the core's enable
   * actions (Home `ModuleCards`, `ManageModulesDialog`) open it instead of POSTing at once;
   * the dialog calls `enableModule(householdId, id, settings)` itself and calls `onClose`
   * when done or dismissed. Disabling stays the core's. A §2 contract extension
   * (docs/plans/m3-finance-module.md §1 decision 7). Part of the manifest's STATIC import
   * graph, so it must not import the registry or the shell.
   */
  enableDialog?: ComponentType<{ open: boolean; onClose: () => void }>;
}
