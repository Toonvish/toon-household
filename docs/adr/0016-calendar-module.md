# 0016: A third module, `calendar`, with its own tabs, tokens and new German (extends D2, D5, D6, D7, D8, D10; SPEC §2, §5)

Date: 2026-11-06

## Context

The owner asked for a household calendar: appointments for everybody or for one person, car bookings, chores
such as putting the bins out or watering the flowers, and an import of the Stadt Hattingen waste collection
flyer configured by the street's tour number. D2 foresaw "more later"; this is the first module without a
source repository, so the rules that assume one (D10's "every German UI string stays byte-identical to the
sources", D13's inherited decisions) have nothing to bind. The design is `docs/modules/calendar.md`.

## Decision

- **D2, §2:** `MODULE_IDS` is `["recipe", "finance", "calendar"]`; `DEFAULT_ENABLED_MODULES` stays `["recipe"]`
  (the calendar needs no setup and no `enableDialog`; an owner or admin enables it on Home).
- **D6:** the calendar's tabs are Übersicht `/calendar` · Monat `/calendar/month` · Aufgaben `/calendar/tasks` ·
  Profil; sidebar-only Autos `/calendar/cars` and Müllabfuhr `/calendar/waste`, each reachable from a tab screen.
  Creating is the one header action of each tab screen, not a tab and not a FAB (finance's Erfassen tab stays
  finance's).
- **§5:** outside a module the phone tab bar shows Home · up to THREE enabled modules · Profil
  (`MAX_MODULE_TABS` 2 → 3 in `apps/web/src/components/layout/nav-items.ts`): with three modules the bar has five
  items, which fits 390 px; two would hide one module from the bar of Home and Settings.
- **D7, D8:** tables `calendar_*` (migration `apps/api/drizzle/0004_calendar.sql`, generated), routes under
  `/api/households/:householdId/calendar/…`, no user-scoped routes.
- **D5:** eleven new tokens in all four `theme.css` blocks (`--waste-rest`, `--waste-yellow`, `--waste-bio`,
  `--waste-paper`, `--waste-tree`, `--person-1` … `--person-6`); the design-system test's token count moves from
  39 to 50 in the same commit.
- **D10:** every `calendar.*` web key and every `server.calendar.*` server key is new German. `scripts/i18n-check.ts`
  admits them by a NAMESPACE rule (`NEW_GERMAN_NAMESPACES`, one entry per namespace with its reason) instead of one
  `NEW_GERMAN` entry per key; the per-key list stays for new German inside the two ported modules and the core,
  and the leftover-German scan still runs over the calendar's source.
- **Outbound fetch:** the waste import may fetch the flyer itself, but only over `https` from the hosts its
  provider names (`www.hattingen.de`, `hattingen.de`), every redirect hop re-checked, ≤ 10 MiB, 20 s. This is an
  exact-host allow list, not a general URL import, so it does not reuse (and must not import) the recipe module's
  SSRF guard (module boundary, SPEC §2); an upload of the PDF is the alternative path.
- **PDF parsing** uses `unpdf` (already a dependency of `apps/api` for the recipe PDF import) in pure JS, so the
  import works in the published image built with `WITH_PDF=0` (no poppler).

## Consequences

- SPEC D2, D6, D7, D8, §2, §3 and §5 name the calendar (edited in the commit that lands this ADR's code), and
  CLAUDE.md's Status, Layout and module-gotcha index gain the module.
- `apps/api/test/docs-paths.test.ts` scans `docs/modules/calendar.md` too once the module is built.
- A fourth module would need a decision about the tab bar again (six items do not fit).
- The waste parser is specific to the layout of Hattingen's flyer and its hidden copies; a new year's flyer is
  re-validated by the parser's own checks (a refusal names the check), and a layout change is a code change.
