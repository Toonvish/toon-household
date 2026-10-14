# 0004: Finance participant churn: any ledger row blocks a replacement, a leaving seat is released (refines D3)

Date: 2026-10-14

## Context

SPEC D3 says changing a finance slot "is refused while the ledger has rows for the outgoing user
(`409 finance_participant_in_use`)". Read literally that means rows whose `payer_id` or income
`person_id` names the outgoing user. In the two-person ledger that is not enough: every
`finance_transactions` row involves both slots (`SPLIT_EQUAL`, `OTHER_ONLY` and `SETTLEMENT` store only
the payer; the counterparty is "the other slot"). A replacement of a participant who never paid
therefore let the incoming user inherit the outgoing one's share of every row and of the balance.
The M3 review found it (commit `03aa396`).

D3 also says nothing about a participant who leaves the HOUSEHOLD. In toon-finance a leaver's
`household_members` row was the slot, and `removeMember` refused with `member_has_ledger` while the
ledger had rows (binding through D13). Here membership (`household_members`) and the seat
(`finance_participants`) are two tables, so without a rule a leaver left a ghost seat that the other
participant could book against and that `PUT …/participants` could never replace (commits `98d0bb1`,
`046fde3`).

## Decision

- `assignParticipants` answers `409 finance_participant_in_use` when a user leaves the budget
  (seated before, absent after) and the household has ANY `finance_transactions` row, or a
  `finance_incomes.person_id` names the outgoing user. Swapping the same two users between slots stays
  allowed (nobody leaves; every projection is computed at read time). On an empty ledger the plan's
  `payer_id` moves to the incoming user of the same slot.
- The contract gained `ApiModule.onMemberRemoving(householdId, userId, tx)`, called by the core's
  `removeMember` before the membership row is deleted, for every build module, enabled or not.
  Finance's hook (`assertParticipantMayLeave`) answers `409 member_has_ledger`
  (`server.household.memberHasLedger`, toon-finance's text) for a seated participant while the same
  predicate holds. With an empty ledger the leaver's seat is DELETED and the plan payer moves to the
  remaining participant; the household is then a one-seat ledger (a booking that needs the other slot
  answers `409 conflict`, `server.household.needsSecondMember`) until an admin seats a second member.
- A member without a seat may always leave.

SPEC D3 and §2 carry the new wording in the same commit.

## Consequences

- The remaining participant keeps their slot number, with one exception. If the leaver held slot 1 the
  survivor would sit alone in slot 2, and the code that anchors on slot 1 (`slot1UserId`, the balance
  sign) would throw a 500 until a slot-1 seat exists again (M3 plan section 10, finding A).
- M4-T01 closes it: on an empty ledger the survivor of a slot-1 leave is re-seated in slot 1 (in the
  leave's own transaction), so the balance anchor always exists; a slot-2 leave changes nothing. The
  plan payer and an income's person only name participants (finding B): `PATCH …/plan { payerId }`
  and the income create/update routes answer `422 validation_failed` with
  `server.finance.personNotParticipant` for anyone else.
- An admin cannot replace a participant who has booked anything: the ledger's history belongs to the two
  people who kept it. A household that must change partners starts a new ledger (out of scope, D3's
  N-person generalisation stays out).
- M7 documents the hook and the two error codes in `docs/API.md`; another module may implement
  `onMemberRemoving` the same way.