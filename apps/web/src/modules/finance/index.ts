/**
 * The finance module's web manifest (SPEC §2, D2, D3, D6, D9; docs/plans/m3-finance-module.md
 * §1 decisions 4, 7, 12, 13). Listed in `modules/index.ts`; nothing outside this directory knows
 * the module's routes, screens, query keys or catalogs except through this object.
 *
 * LITERAL-TYPED ON PURPOSE: no type annotation, only `satisfies WebModule<"finance">`, so
 * `WEB_MODULES = [recipeModule, financeModule] as const` keeps the concrete route tree type and
 * the registered router tree stays strict, and so the catalog objects keep their literal keys
 * (H gotcha "`MessageKey` must stay a literal union").
 *
 * STATIC IMPORT GRAPH (H/CLAUDE.md "A module owns its layout route and its static import graph
 * stays shell-free"): this file, `routes.tsx`, `HomeCard.tsx`, the catalogs,
 * `features/transactions/lib/offline.ts`, `features/participants/{ParticipantsSection,
 * EnableFinanceDialog}.tsx` never import the module registry, the shell (the layout components,
 * `use-nav-items`) or the module `PageHeader` (which renders `PhoneHeaderRow`). The registry
 * evaluates `WEB_MODULES = [recipeModule, financeModule]`; a path back into it from here would
 * read `financeModule` in its temporal dead zone the moment anything imports this manifest
 * first — which `manifest.test.ts` and `persist.test.ts` do on purpose. Screens are lazy.
 *
 * Navigation (F/CLAUDE.md "Navigation"): tabs Übersicht · Buchungen · Erfassen (the shell
 * appends Profil); Erfassen stays a tab, not a FAB. Sidebar-only Fixkosten · Kategorien (the
 * shell appends Gruppen). Their phone routes (F's reachability rules): `FixedCostCard` on
 * `/finance` → `/finance/plan`; the `SpendByCategoryCard` footer and `CategorySheet` →
 * `/finance/categories`. F's "Haushalt" item is the core's Gruppen plus the participants
 * section on `/settings`.
 */
import { List, PlusCircle, Repeat, Tags, Wallet } from "lucide-react";
import type { WebModule } from "@/modules/types";
import { financeDe, financeEn } from "./catalogs/index.ts";
import { EnableFinanceDialog } from "./features/participants/EnableFinanceDialog";
import { ParticipantsSection } from "./features/participants/ParticipantsSection";
import { registerTransactionMutationDefaults } from "./features/transactions/lib/offline";
import { FinanceHomeCard } from "./HomeCard";
import { financeRouteTree } from "./routes";

export const financeModule = {
  id: "finance",
  nameKey: "finance.module.name",
  icon: Wallet,
  basePath: "/finance",
  route: financeRouteTree,
  navItems: [
    { to: "/finance", labelKey: "finance.nav.overview", icon: Wallet, exact: true },
    { to: "/finance/transactions", labelKey: "finance.nav.transactions", icon: List, exact: false },
    { to: "/finance/new", labelKey: "finance.nav.create", icon: PlusCircle, exact: false },
  ],
  secondaryNavItems: [
    { to: "/finance/plan", labelKey: "finance.nav.plan", icon: Repeat, exact: false },
    { to: "/finance/categories", labelKey: "finance.nav.categories", icon: Tags, exact: false },
  ],
  homeCard: FinanceHomeCard,
  /**
   * What is persisted for offline reading (SPEC D9; F `lib/persist.ts`
   * `PERSISTED_HOUSEHOLD_SEGMENTS` plus `participants`, decision 12). Keys are
   * `["toon","household",<id>,"finance",<segment>,…]`. `participants` is on the list because a
   * cold offline start must know the viewer's slot: every kind and the balance sign are
   * projections onto it (F decision 1), and the gate reads it. Deliberately absent (must be
   * live, F's list): `plan-preview`, `plan-runs`, `balance-history`, `settlements`.
   */
  persistQueryAllowList: [
    { scope: "household", path: ["finance", "transactions"] },
    { scope: "household", path: ["finance", "transaction"] },
    { scope: "household", path: ["finance", "transaction-summary"] },
    { scope: "household", path: ["finance", "categories"] },
    { scope: "household", path: ["finance", "tags"] },
    { scope: "household", path: ["finance", "plan"] },
    { scope: "household", path: ["finance", "balance"] },
    { scope: "household", path: ["finance", "participants"] },
  ],
  /**
   * The ledger outbox (`["toon","finance","tx",<op>]`), replay-safe by `mutationId` (F gotchas
   * 7–10). Plan, category and participant mutations are never persisted (F gotcha 9).
   */
  persistMutationNamespaces: [["finance", "tx"]],
  /** Registered by `app.tsx` before the persister restores (a restored mutation has no fn). */
  mutationDefaults: registerTransactionMutationDefaults,
  catalogs: { de: financeDe, en: financeEn },
  /** The two slots and the viewer's display name on `/settings` (decision 4). */
  settingsSections: [ParticipantsSection],
  /** "Aktivieren" needs the two participants (D3, decision 4): the core opens this dialog. */
  enableDialog: EnableFinanceDialog,
} satisfies WebModule<"finance">;
