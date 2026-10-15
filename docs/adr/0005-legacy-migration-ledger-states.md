# 0005: The legacy migration carries toon-finance ledger states the runtime refuses (refines D2, D3, §6 step 4)

Date: 2026-10-15

## Context

toon-finance's own code produces ledger states that H's runtime refuses while the ledger has rows:

- F's `removeMember` (`apps/api/src/services/households/members.service.ts`, lines 168-183) refuses
  only a leaver who PAID a transaction. A member who never paid may leave, so a two-person ledger
  with rows can shrink to one member, and that member may sit in slot 2.
- F's create path (`apps/api/src/services/households/households.service.ts`, lines 40-80) seats the
  creator in slot 1 and makes them the plan payer (`fixed_cost_plans.payer_id = ownerId`); F's leave
  path never moves the payer or an income's `person_id`. A household whose creator left therefore
  normally carries a plan payer who is no longer a member, and possibly incomes naming them.

In H, SPEC D2 enables finance only when its two slots are assigned (`onEnable` answers
`422 finance_participants_required`); D3 and ADR 0004 refuse any slot change while the ledger has
rows and re-seat a survivor only after an empty-ledger leave; M4 finding B requires the plan payer and
an income's person to be participants (`422 server.finance.personNotParticipant`). The migration
(SPEC §6, plan `m5-migration.md` decisions 11 and 14) has to land such data somewhere: the inputs are
read-only and `--mapping` can only choose a target household, not repair a ledger.

## Decision

The legacy migration, and only it:

1. writes the `finance` `household_modules` row for a household with ONE participant (a toon-finance
   household with a single member), with the warning "one participant; seat the second with
   PUT …/finance/participants";
2. re-seats a lone slot-2 participant in slot 1 although the ledger has rows: slot 1 anchors the
   balance and must resolve (ADR 0004), the move changes no identity, and the balance invariant of
   plan m5 decision 14 compares from the perspective of the legacy user who holds slot 1 in the
   TARGET, so it stays exact;
3. re-points a plan payer who is not a participant to the slot-1 participant (ADR 0004's leave rule,
   the payer moves to the remaining participant, applied to data that predates it), with a warning;
4. keeps an income whose person is not a participant, unchanged, with a warning.

Each case is a warning in the report, never an error. This is the smallest deviation available:
refusing would leave real ledgers unmigratable, and `--mapping` cannot repair them. The households,
members and seats are written directly; `initializeHousehold`, `onHouseholdCreated` and `onEnable` are
not called (they would seed default categories that collide with the copied ones).

SPEC D2, D3 and §6 step 4 carry the new wording in the same commit.

## Consequences

- Such a household behaves as ADR 0004's one-seat ledger: a booking that needs the other slot answers
  `409 conflict` (`server.household.needsSecondMember`), and an admin seats the second participant
  with `PUT …/finance/participants` (nobody leaves, so ADR 0004's veto does not apply).
- The runtime rules are unchanged: `onEnable`, `assignParticipants` and the plan service's participant
  checks refuse these states exactly as before; only the migration writes them.
- An income naming a non-participant keeps the plan `plan_incomplete` (`isPlanComputable` counts
  incomes per participant) until an admin deletes or replaces it
  (`DELETE …/finance/plan/incomes/:incomeId`).
- `docs/migration.md` (M5-T09) lists the four cases so the operator knows which warnings to act on.
