# 0010: Each shell screen carries its own header row instead of a global top bar (refines D1, D6)

Date: 2026-10-15

## Context

SPEC D1 said "the top bar has a household switcher" and D6 said "a module switcher in the top bar
(and the sidebar head from `lg`)". The shell as built has no global top bar. toon-recipe's
`TopBar` was dropped from the household shell and the status-bar inset moved to `AppShell`'s
inner column; the artboards the design system comes from (D5, `docs/design/recipe-redesign/`)
draw the two switchers as chips in a row above each screen's `<h1>`. M4 built exactly that:
`components/layout/PhoneHeaderRow.tsx` renders the household chip, the module chip and at most one
screen-specific action, hidden from `lg`; every shell screen renders it itself (recipe screens,
finance screens, Home, Settings, Gruppen, Gruppe detail), with the recipe detail excepted because
its hero owns the top edge. The row scrolls with the page, it is a `<header data-app-shell>` so
`print.css` hides it, and from `lg` the sidebar head carries the household switcher and the
segmented module switcher. SPEC §5 already said "There is no global top bar", so §1 and §5
contradicted each other and the tree followed §5. Guards: `core/features/phone-header.test.ts`
(Home, Settings, Gruppen, Gruppe detail), `modules/recipe/phone-header.test.ts` and
`modules/finance/phone-header.test.ts` (plan `m4-design-pass.md` decision 10, tasks M4-T02, T07, T09).

## Decision

D1 and D6 are reworded: each shell screen's header row (`PhoneHeaderRow`) carries the household
switcher chip and the module switcher chip on phones; the sidebar head carries both from `lg`. The
switchers themselves (the `ActionMenu` sheet, the segmented group), the module-scoped tab bars and
the rule that the active module is the URL prefix are unchanged.

## Consequences

- A new shell screen must render `PhoneHeaderRow` itself; there is no global bar to inherit it
  from. The three guard tests fail a screen that forgets it, and a new module gets its own guard.
- A screen without the row has no phone-width way to switch household or module except the
  tab bar's Home and Profil items, which is why the exception list (the recipe detail) stays one
  entry long.
- No code changes: the tree already behaved this way. SPEC D1 and D6 now agree with SPEC §5.
