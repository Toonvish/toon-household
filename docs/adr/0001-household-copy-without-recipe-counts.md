# 0001: Household copy without recipe counts (amends D10)

Date: 2026-10-14

## Context

SPEC D10 fixes every German UI string of both apps as byte-identical to its source and allows new
German only for new screens (Home, switcher, participant settings, module-disabled states).
toon-recipe's group screens print recipe counts: `groups.count.recipes`,
`groups.detail.meta` ("{members} · {recipes} · angelegt am {date}") and the plural
`groups.danger.warning` ("Alle {count} Rezept(e), Tags, Sammlungen und Einladungen dieser Gruppe
...").

In the household app the core owns households and must not know any module's tables (D2, M1 plan
decision 2). `HouseholdWithRole` therefore has no `recipeCount` and carries `modules` instead. The
two source strings cannot be rendered without a number the core cannot supply. The M1 review
(finding "Two existing German source strings changed without an ADR") found that the plan had
recorded no ADR for this although both keys were already listed in `NEW_GERMAN`.

## Decision

Two catalog values deviate from toon-recipe, in both languages:

- `household.detail.meta`: "{members} · angelegt am {date}" (en "{members} · created on {date}"),
  the `{recipes}` part dropped.
- `household.danger.warning`: a single string, "Alle Inhalte und Einladungen dieser Gruppe werden
  endgültig gelöscht. Das kann nicht rückgängig gemacht werden." (en equivalent), replacing the
  count-pluralised sentence.

`household.count.recipes` is not ported. Both changed keys stay in `NEW_GERMAN` in
`scripts/i18n-check.ts`, which is the register of intentional D10 exceptions. Every other household
string stays byte-identical, including the "Gruppe" wording (a rename to "Haushalt" is a separate
owner decision, M4 at the earliest).

D10 in `docs/SPEC.md` is amended in the same commit.

## Consequences

- The detail page and the delete warning no longer show how many recipes a household holds. The
  warning is vaguer but still true for every module's data.
- If M2 wants the counts back, the recipe module supplies them (a `homeCard` or manifest hook) and
  the original source strings can be restored under their own keys; that would supersede this ADR.
- `apps/web/src/lib/i18n/i18n.test.ts` pins the two values and the absence of
  `household.count.recipes`, so the deviation cannot widen silently.
