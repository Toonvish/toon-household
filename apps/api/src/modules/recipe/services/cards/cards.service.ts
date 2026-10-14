/**
 * Saved cards ("Karten") — the user's own loyalty/membership barcodes.
 *
 * USER-SCOPED, NOT HOUSEHOLD-SCOPED. Every function here takes a `userId` and every
 * query filters on it; there is no `householdId` anywhere, and no `requireHouseholdRole`
 * in front of the routes. See the header of packages/shared/src/schemas/card.ts
 * for why this one entity is a deliberate exception to "households own the content".
 *
 * The consequence to keep in mind while editing: `userId` IS the authorisation
 * here. A missing `eq(cards.userId, userId)` does not fail a membership check the
 * way a household query would — it silently hands one account another's cards. That is
 * why every helper below takes the id and why `loadCardRow` is the only way in.
 */
import {
  CARD_LIMITS,
  type Card,
  type CreateCardInput,
  type UpdateCardInput,
} from "@toon/shared";
import { and, count, desc, eq } from "drizzle-orm";
import { cards, type CardRow } from "../../../../db/schema.ts";
import { ApiError } from "../../../../lib/errors.ts";
import { toIso, toIsoOrNull } from "../../../../lib/http.ts";
import { type DbLike, nowMs } from "../../../../core/services/households/support.ts";

/* -------------------------------------------------------------------------- */
/* mapping                                                                    */
/* -------------------------------------------------------------------------- */

export function toCard(row: CardRow): Card {
  return {
    id: row.id,
    label: row.label,
    // Stored as text (the column cannot hold a union); the wire schema is what
    // narrows it back to a `BarcodeFormat` for the client.
    format: row.format as Card["format"],
    value: row.value,
    note: row.note,
    lastUsedAt: toIsoOrNull(row.lastUsedAt),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

/* -------------------------------------------------------------------------- */
/* reads                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The user's whole wallet, most recently USED first.
 *
 * SQLite sorts NULL as the smallest value, so `desc(lastUsedAt)` puts the
 * never-shown cards last on its own — no `NULLS LAST` clause needed (libSQL's
 * SQLite 3.45 supports it, but relying on the documented NULL ordering keeps the
 * `cards_user_last_used_idx` usable).
 */
export async function listCards(db: DbLike, userId: string): Promise<Card[]> {
  const rows = await db
    .select()
    .from(cards)
    .where(eq(cards.userId, userId))
    .orderBy(desc(cards.lastUsedAt), desc(cards.createdAt));
  return rows.map(toCard);
}

/** The row, or a 404 that reveals nothing about other accounts' cards. */
async function loadCardRow(db: DbLike, userId: string, cardId: string): Promise<CardRow> {
  const [row] = await db
    .select()
    .from(cards)
    .where(and(eq(cards.id, cardId), eq(cards.userId, userId)))
    .limit(1);
  if (!row) throw ApiError.notFound("server.card.notFound");
  return row;
}

/* -------------------------------------------------------------------------- */
/* writes                                                                     */
/* -------------------------------------------------------------------------- */

/** Rejects a card this user has already saved, by (format, value). */
async function assertNotSaved(
  db: DbLike,
  userId: string,
  format: string,
  value: string,
  exceptCardId?: string,
): Promise<void> {
  const [clash] = await db
    .select({ id: cards.id })
    .from(cards)
    .where(and(eq(cards.userId, userId), eq(cards.format, format), eq(cards.value, value)))
    .limit(1);
  if (clash && clash.id !== exceptCardId) {
    throw ApiError.conflict("card_already_saved", "server.card.alreadySaved");
  }
}

/**
 * Saves a card. `input` is the schema's OUTPUT, so `value` is already normalised
 * and check-digit validated — this function never sees a raw typed string.
 */
export async function createCard(
  db: DbLike,
  userId: string,
  input: CreateCardInput,
): Promise<Card> {
  const [existing] = await db
    .select({ value: count() })
    .from(cards)
    .where(eq(cards.userId, userId));
  if (Number(existing?.value ?? 0) >= CARD_LIMITS.perUser) {
    throw ApiError.conflict("too_many_cards", {
      key: "server.card.tooManyCards",
      values: { max: CARD_LIMITS.perUser },
    });
  }
  await assertNotSaved(db, userId, input.format, input.value);

  const row: CardRow = {
    id: crypto.randomUUID(),
    userId,
    label: input.label,
    format: input.format,
    value: input.value,
    note: input.note ?? null,
    lastUsedAt: null,
    createdAt: nowMs(),
    updatedAt: nowMs(),
  };
  await db.insert(cards).values(row);
  return toCard(row);
}

/**
 * Edits a card. `format`/`value` arrive together or not at all (the schema
 * enforces it), so a stored value can never stop matching its symbology.
 */
export async function updateCard(
  db: DbLike,
  userId: string,
  cardId: string,
  input: UpdateCardInput,
): Promise<Card> {
  const row = await loadCardRow(db, userId, cardId);

  const patch: Partial<CardRow> = { updatedAt: nowMs() };
  if (input.label !== undefined) patch.label = input.label;
  if (input.note !== undefined) patch.note = input.note ?? null;
  if (input.format !== undefined && input.value !== undefined) {
    if (input.format !== row.format || input.value !== row.value) {
      await assertNotSaved(db, userId, input.format, input.value, cardId);
    }
    patch.format = input.format;
    patch.value = input.value;
  }

  await db.update(cards).set(patch).where(eq(cards.id, cardId));
  return toCard({ ...row, ...patch });
}

/** Deletes a card. 404 when it is not this user's. */
export async function deleteCard(db: DbLike, userId: string, cardId: string): Promise<void> {
  await loadCardRow(db, userId, cardId);
  await db.delete(cards).where(eq(cards.id, cardId));
}

/**
 * Records that the card was SHOWN, which is what the wallet is ordered by.
 *
 * Deliberately its own endpoint rather than a side effect of a GET: the list is
 * fetched on every visit to the screen, and bumping every card on a list read
 * would make the ordering meaningless. `updatedAt` is left alone — showing a card
 * is not an edit, and moving it would invalidate nothing but caches.
 */
export async function markCardUsed(db: DbLike, userId: string, cardId: string): Promise<Card> {
  const row = await loadCardRow(db, userId, cardId);
  const lastUsedAt = nowMs();
  await db.update(cards).set({ lastUsedAt }).where(eq(cards.id, cardId));
  return toCard({ ...row, lastUsedAt });
}
