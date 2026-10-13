/**
 * The web app's catalog registry: every UI namespace, merged, for both
 * locales. FINAL — a port agent extends its own two namespace files, never
 * this one (docs/i18n.md §1/§9). Namespace prefixes are disjoint by
 * construction (`NamespaceCatalog<Prefix>`), so this merge is order-independent
 * — a runtime test in `i18n.test.ts` asserts that anyway.
 *
 * `common` is toon-recipe's `ui` namespace, renamed per SPEC D10 (values unchanged).
 * `home` is the household Home screen (new copy, SPEC D10). Module namespaces
 * (`recipe.*`, `finance.*`) arrive through `modules/catalogs.ts`, which imports ONLY
 * each module's `catalogs/` files — never `modules/index.ts`, which pulls in routes
 * and screens that themselves import this file (plan §1 decision 6).
 *
 * `MessageKey` MUST stay a union of literal keys (D10's enforcement): every spread
 * here is a literal-typed `as const` object. One index-signature type among them
 * widens `MessageKey` to `string`, and `t("anything")` would compile —
 * `i18n.test.ts` "MessageKey is a literal union (D10)" guards it.
 */
import { MODULE_CATALOGS_DE, MODULE_CATALOGS_EN } from "../../../modules/catalogs.ts";
import { commonDe } from "./common.de.ts";
import { commonEn } from "./common.en.ts";
import { homeDe } from "./home.de.ts";
import { homeEn } from "./home.en.ts";

const de = { ...commonDe, ...homeDe, ...MODULE_CATALOGS_DE };
const en = { ...commonEn, ...homeEn, ...MODULE_CATALOGS_EN };

export const CATALOGS = { de, en } as const;
export type MessageKey = keyof typeof de;
