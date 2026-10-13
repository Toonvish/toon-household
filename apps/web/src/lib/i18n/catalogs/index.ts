/**
 * The web app's catalog registry: every UI namespace, merged, for both
 * locales. FINAL — a port agent extends its own two namespace files, never
 * this one (docs/i18n.md §1/§9). Namespace prefixes are disjoint by
 * construction (`NamespaceCatalog<Prefix>`), so this merge is order-independent
 * — a runtime test in `i18n.test.ts` asserts that anyway.
 *
 * `common` is toon-recipe's `ui` namespace, renamed per SPEC D10 (values unchanged).
 */
import { commonDe } from "./common.de.ts";
import { commonEn } from "./common.en.ts";

const de = { ...commonDe };
const en = { ...commonEn };

export const CATALOGS = { de, en } as const;
export type MessageKey = keyof typeof de;
