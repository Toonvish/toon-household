# 0002: Finance validation wording from the core (amends D10)

Date: 2026-10-14

## Context

SPEC D10 keeps every German UI string byte-identical to its source and gives toon-household ONE Zod
resolver and ONE server catalog: the core's, with toon-recipe's wording and the `{bound}`
placeholder. toon-finance's server catalog carries generic Zod keys with its own wording
(`server.zod.fallback`, `server.zod.invalid_type`, `server.zod.invalid_type.required`,
`server.zod.too_small.string`, `server.zod.too_small.number`, `server.zod.too_big.string`,
`server.zod.too_big.number`, `server.zod.invalid_format.uuid`, `server.zod.invalid_enum`). Those keys
cannot coexist with the core's under the same names without changing recipe's and the core's
messages, which D10 forbids.

## Decision

The generic F keys are not ported. A finance validation issue without a field-specific key renders
the core's text for its code. Examples:

- "Höchstens {maximum} Zeichen." becomes "Darf höchstens {bound} Zeichen lang sein".
- "Mindestens {minimum}." becomes "Muss mindestens {bound} sein".
- "Dieses Feld ist erforderlich." becomes "Ungültiger Wert".
- "Ungültige Kennung." becomes "Ungültiges Format".

Finance's field-specific messages keep their text: `server.zod.field.amountCents.invalid_type`,
`server.zod.field.description.too_small.1` and `server.zod.field.description.too_big.200` (with
`{bound}`), so the transaction form keeps its F wording. The finance screens' own client-side
messages (catalog `finance.*`) are untouched.

## Consequences

- Finance form errors that come from the server read in the core's voice, not in F's. The German
  strings changed are only those generic Zod messages; no finance screen string changes.
- `packages/shared/test/finance-i18n.test.ts` pins the fallback to the core key
  (`server.zod.invalid_format`) and the field-specific keys, so the deviation cannot widen silently.
- A later field that needs its own wording adds a field-specific key to the core catalog, never a
  generic `server.zod.*` key of its own.
