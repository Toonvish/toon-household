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
 *
 * AS A SERVICE (docs/EFFECT.md E7, E12; plan `docs/plans/e3-recipe-services.md` P2, P8, P9). `Cards` reads the current
 * executor of `Database` on every call, takes its timestamps from the `Clock` and refuses with the tagged family. The
 * mapper `toCard` stays pure.
 */
import {
  CARD_LIMITS,
  type Card,
  type CreateCardInput,
  type UpdateCardInput,
} from "@toon/shared";
import { and, count, desc, eq } from "drizzle-orm";
import { Clock, Context, Effect, Layer } from "effect";
import { Database } from "../../../../db/database.ts";
import { cards, type CardRow } from "../../../../db/schema.ts";
import { Conflict, NotFound } from "../../../../lib/errors.ts";
import type { DatabaseError } from "../../../../lib/errors.ts";
import { toIso, toIsoOrNull } from "../../../../lib/http.ts";

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
/* the service                                                                */
/* -------------------------------------------------------------------------- */

/** The user's saved cards. Every method takes the `userId`, which IS the authorisation (see the file header). */
export class Cards extends Context.Service<
  Cards,
  {
    /**
     * The user's whole wallet, most recently USED first.
     *
     * SQLite sorts NULL as the smallest value, so `desc(lastUsedAt)` puts the
     * never-shown cards last on its own — no `NULLS LAST` clause needed (libSQL's
     * SQLite 3.45 supports it, but relying on the documented NULL ordering keeps the
     * `cards_user_last_used_idx` usable).
     */
    readonly listCards: (userId: string) => Effect.Effect<Card[], DatabaseError>;
    /**
     * Saves a card. `input` is the schema's OUTPUT, so `value` is already normalised
     * and check-digit validated — this function never sees a raw typed string.
     */
    readonly createCard: (userId: string, input: CreateCardInput) => Effect.Effect<Card, Conflict | DatabaseError>;
    /**
     * Edits a card. `format`/`value` arrive together or not at all (the schema
     * enforces it), so a stored value can never stop matching its symbology.
     */
    readonly updateCard: (
      userId: string,
      cardId: string,
      input: UpdateCardInput,
    ) => Effect.Effect<Card, NotFound | Conflict | DatabaseError>;
    /** Deletes a card. 404 when it is not this user's. */
    readonly deleteCard: (userId: string, cardId: string) => Effect.Effect<void, NotFound | DatabaseError>;
    /**
     * Records that the card was SHOWN, which is what the wallet is ordered by.
     *
     * Deliberately its own endpoint rather than a side effect of a GET: the list is
     * fetched on every visit to the screen, and bumping every card on a list read
     * would make the ordering meaningless. `updatedAt` is left alone — showing a card
     * is not an edit, and moving it would invalidate nothing but caches.
     */
    readonly markCardUsed: (userId: string, cardId: string) => Effect.Effect<Card, NotFound | DatabaseError>;
  }
>()("toon/api/modules/recipe/services/cards/cards.service/Cards") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const database = yield* Database;

      const listCards = Effect.fn("Cards.listCards")(function* (userId: string) {
        const rows = yield* database.use((db) =>
          db
            .select()
            .from(cards)
            .where(eq(cards.userId, userId))
            .orderBy(desc(cards.lastUsedAt), desc(cards.createdAt)),
        );
        return rows.map(toCard);
      });

      /** The row, or a 404 that reveals nothing about other accounts' cards. */
      const loadCardRow = Effect.fn("Cards.loadCardRow")(function* (userId: string, cardId: string) {
        const [row] = yield* database.use((db) =>
          db
            .select()
            .from(cards)
            .where(and(eq(cards.id, cardId), eq(cards.userId, userId)))
            .limit(1),
        );
        if (!row) return yield* new NotFound({ text: "server.card.notFound" });
        return row;
      });

      /** Rejects a card this user has already saved, by (format, value). */
      const checkNotSaved = Effect.fn("Cards.checkNotSaved")(function* (
        userId: string,
        format: string,
        value: string,
        exceptCardId?: string,
      ) {
        const [clash] = yield* database.use((db) =>
          db
            .select({ id: cards.id })
            .from(cards)
            .where(and(eq(cards.userId, userId), eq(cards.format, format), eq(cards.value, value)))
            .limit(1),
        );
        if (clash && clash.id !== exceptCardId) {
          return yield* new Conflict({ code: "card_already_saved", text: "server.card.alreadySaved" });
        }
      });

      const createCard = Effect.fn("Cards.createCard")(function* (userId: string, input: CreateCardInput) {
        const [existing] = yield* database.use((db) =>
          db.select({ value: count() }).from(cards).where(eq(cards.userId, userId)),
        );
        if (Number(existing?.value ?? 0) >= CARD_LIMITS.perUser) {
          return yield* new Conflict({
            code: "too_many_cards",
            text: { key: "server.card.tooManyCards", values: { max: CARD_LIMITS.perUser } },
          });
        }
        yield* checkNotSaved(userId, input.format, input.value);

        const now = yield* Clock.currentTimeMillis;
        const row: CardRow = {
          id: crypto.randomUUID(),
          userId,
          label: input.label,
          format: input.format,
          value: input.value,
          note: input.note ?? null,
          lastUsedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        yield* database.use((db) => db.insert(cards).values(row));
        return toCard(row);
      });

      const updateCard = Effect.fn("Cards.updateCard")(function* (
        userId: string,
        cardId: string,
        input: UpdateCardInput,
      ) {
        const row = yield* loadCardRow(userId, cardId);

        const patch: Partial<CardRow> = { updatedAt: yield* Clock.currentTimeMillis };
        if (input.label !== undefined) patch.label = input.label;
        if (input.note !== undefined) patch.note = input.note ?? null;
        if (input.format !== undefined && input.value !== undefined) {
          if (input.format !== row.format || input.value !== row.value) {
            yield* checkNotSaved(userId, input.format, input.value, cardId);
          }
          patch.format = input.format;
          patch.value = input.value;
        }

        yield* database.use((db) => db.update(cards).set(patch).where(eq(cards.id, cardId)));
        return toCard({ ...row, ...patch });
      });

      const deleteCard = Effect.fn("Cards.deleteCard")(function* (userId: string, cardId: string) {
        yield* loadCardRow(userId, cardId);
        yield* database.use((db) => db.delete(cards).where(eq(cards.id, cardId)));
      });

      const markCardUsed = Effect.fn("Cards.markCardUsed")(function* (userId: string, cardId: string) {
        const row = yield* loadCardRow(userId, cardId);
        const lastUsedAt = yield* Clock.currentTimeMillis;
        yield* database.use((db) => db.update(cards).set({ lastUsedAt }).where(eq(cards.id, cardId)));
        return toCard({ ...row, lastUsedAt });
      });

      return Cards.of({ listCards, createCard, updateCard, deleteCard, markCardUsed });
    }),
  );
}
