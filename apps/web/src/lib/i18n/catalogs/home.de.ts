/**
 * German — namespace "home" (`core/features/home/**` and the shell's brand line).
 * The only genuinely NEW German of M0 (SPEC D10; docs/plans/m0-scaffold.md §1
 * decision 3). Every key is listed in `scripts/i18n-check.ts`'s `NEW_GERMAN`.
 */
import type { NamespaceCatalog } from "@toon/shared";

export const homeDe = {
  /** The brand line next to the logo in the sidebar. */
  "home.appName": "Haushalt",
  /** The Home tab / sidebar item. */
  "home.nav.label": "Start",
  "home.title": "Start",
  "home.empty.title": "Noch keine Module aktiviert",
  "home.empty.body": "Sobald ein Modul für diesen Haushalt aktiviert ist, erscheint es hier.",
} as const satisfies NamespaceCatalog<"home">;

export type HomeCatalog = typeof homeDe;
