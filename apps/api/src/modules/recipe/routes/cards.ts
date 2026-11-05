/**
 * Saved cards ("Karten") — the user's own loyalty barcodes.
 *
 * Mounted at /api/recipe/cards (userRouter, modules/recipe/routes/index.ts). THE ONLY ROUTER THAT IS NOT
 * HOUSEHOLD-SCOPED: a card belongs to the signed-in user, so there is no `:householdId`
 * segment and no `requireHouseholdRole()` — `requireSession()` plus the `userId`
 * every service call carries IS the authorisation. See the header of
 * packages/shared/src/modules/recipe/schemas/card.ts for why this entity is not household-owned.
 *
 * Endpoint contract: docs/API.md ("Saved cards").
 *
 *   GET    /                -> the wallet, most recently used first
 *   POST   /                -> save a card
 *   PATCH  /:cardId         -> rename / re-note / change the code
 *   DELETE /:cardId         -> forget it
 *   POST   /:cardId/used    -> record that it was shown (the wallet's ordering)
 *
 * WRITES NEED A CONFIRMED ADDRESS, like every other write in the app
 * (middleware/verifiedEmail.ts, and a no-op on a deployment that cannot mail).
 * `use("*")` is safe here because there is no escape-hatch write in this router
 * the way `POST /invites/accept` is one in core/routes/invites.ts. It does mean
 * `POST /:cardId/used` answers 403 for an unconfirmed account — which is why the
 * web client fires that one and forgets it (see features/cards/lib/queries.ts):
 * losing the "most recently used" bump must never break showing the card.
 */
import {
  CreateCardRequestSchema,
  UpdateCardRequestSchema,
  type CardListResponse,
  type CardResponse,
} from "@toon/shared";
import { Effect, type Schema } from "effect";
import { Hono } from "hono";
import { BadRequest } from "../../../lib/errors.ts";
import { decode, type Decodable, type Decoded } from "../../../lib/validate.ts";
import { created, json, noContent } from "../../../lib/http.ts";
import { type AppContext, type AppEnv, currentUser } from "../../../lib/types.ts";
import { requireSession } from "../../../middleware/session.ts";
import { requireVerifiedEmail } from "../../../middleware/verifiedEmail.ts";
import { runtime } from "../../../runtime.ts";
import { Cards } from "../services/cards/cards.service.ts";

/**
 * Parses the body with the schema and lets the decode failure reach `onErrorHandler`.
 *
 * Every validator renders its issues through `toValidationIssues` since E1 (ADR 0013),
 * so the catalog key survives on every route; the card routes read the body themselves
 * because they need the raw JSON. The card value's issues
 * are exactly the ones a client wants to re-render in its own language
 * ("Prüfziffer passt nicht"), so they have to keep their keys. Same shape as
 * `readJson` in routes/auth.ts, which is private to that file.
 */
const readJson = Effect.fnUntraced(function* <S extends Decodable>(
  c: AppContext,
  schema: S,
): Effect.fn.Return<Decoded<S>, BadRequest | Schema.SchemaError> {
  const raw: unknown = yield* Effect.tryPromise({
    try: (): Promise<unknown> => c.req.json(),
    catch: () => new BadRequest({ text: "server.auth.invalidJsonBody" }),
  });
  return yield* decode(schema, raw);
});

export const cardRoutes = new Hono<AppEnv>();

cardRoutes.use("*", requireSession());
cardRoutes.use("*", requireVerifiedEmail());

/** GET / — the whole wallet. No pagination: `CARD_LIMITS.perUser` is the page. */
cardRoutes.get("/", (c) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const cards = yield* Cards;
      const user = yield* currentUser(c);
      const payload: CardListResponse = { items: yield* cards.listCards(user.id) };
      return json(c, payload);
    }),
  ),
);

/** POST / — save a card. The value is normalised by the schema before it lands. */
cardRoutes.post("/", (c) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const cards = yield* Cards;
      const user = yield* currentUser(c);
      const body = yield* readJson(c, CreateCardRequestSchema);
      const card = yield* cards.createCard(user.id, body);
      const payload: CardResponse = { card };
      return created(c, payload, `/api/cards/${card.id}`);
    }),
  ),
);

/** PATCH /:cardId — label, note, or the code itself (format + value together). */
cardRoutes.patch("/:cardId", (c) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const cards = yield* Cards;
      const user = yield* currentUser(c);
      const body = yield* readJson(c, UpdateCardRequestSchema);
      const card = yield* cards.updateCard(user.id, c.req.param("cardId"), body);
      const payload: CardResponse = { card };
      return json(c, payload);
    }),
  ),
);

/** DELETE /:cardId. */
cardRoutes.delete("/:cardId", (c) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const cards = yield* Cards;
      const user = yield* currentUser(c);
      yield* cards.deleteCard(user.id, c.req.param("cardId"));
      return noContent(c);
    }),
  ),
);

/**
 * POST /:cardId/used — the card was shown at a till.
 *
 * Answers with the card so a client that cares can update its cache; the web app
 * does not wait for it. No body, and idempotent in the only sense that matters:
 * calling it twice just moves the timestamp forward.
 */
cardRoutes.post("/:cardId/used", (c) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const cards = yield* Cards;
      const user = yield* currentUser(c);
      const card = yield* cards.markCardUsed(user.id, c.req.param("cardId"));
      const payload: CardResponse = { card };
      return json(c, payload);
    }),
  ),
);

export default cardRoutes;
