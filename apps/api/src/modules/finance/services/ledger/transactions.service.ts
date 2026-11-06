/**
 * The cash book itself: create/read/update/delete plus the filtered,
 * paginated list (docs/spec.md §3.6). `kindToStorage`/`projectKind` and every
 * cent computation come from `@toon/shared` — nothing here re-derives a
 * formula.
 *
 * Idempotency (docs/spec.md §2.9, CLAUDE.md gotcha #9/#10): `createTransaction`
 * claims `mutationId` and links it to the new row inside ONE `withTransaction`,
 * so a claim can never be left pointing at nothing. `updateTransaction` /
 * `deleteTransaction` already know the target id, so they claim WITH it
 * up front and simply skip re-applying when the claim was already held.
 *
 * AS A SERVICE (docs/EFFECT.md E5, E6, E7, E12; plan `docs/plans/e4-finance-services.md` P1, P2, P6, P7, P10).
 * `FinanceTransactions` keeps the old function names with the leading `db` parameter dropped; every read and write
 * goes through the CURRENT executor of `Database`, so the claim, the row and the tag sync of `createTransaction` run in
 * ONE `database.transaction` and stay atomic (`finance-file-db.test.ts` (c)). Refusals are the API error family (same
 * status, code, text and details as before); timestamps come from the module clock `financeTimeMillis`. `otherShareOf`
 * stays a pure export. The routes, the seed and the accrual service call the service directly; the Promise bridges that
 * once ended this file are gone (E8, ADR 0014 "Status after E8").
 */
import {
  type CreateTransactionRequest,
  type SplitModeValue,
  type TransactionListResponse,
  type TransactionOriginValue,
  type TransactionResponse,
  type TxKindValue,
  type UpdateTransactionRequest,
  halfForOther,
  isExpense as isExpenseTx,
  kindToStorage,
} from "@toon/shared";
import { and, asc, desc, eq, gte, inArray, lte, ne, notInArray, sql, type SQL } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { Database } from "../../../../db/database.ts";
import { ApiFailure, Conflict, Internal, NotFound } from "../../../../lib/errors.ts";
import type { DatabaseError, ValidationFailed } from "../../../../lib/errors.ts";
import { toIso } from "../../../../lib/http.ts";
import { financeTimeMillis } from "../../lib/clock.ts";
import { financeCategories as categories, financeTransactionTags as transactionTags, financeTransactions as transactions, type FinanceTransactionRow as TransactionRow } from "../../schema.ts";
import { FinanceCategories } from "../categories/categories.service.ts";
import { FinanceParticipants } from "../participants/participants.service.ts";
import { escapeLikePattern } from "../support.ts";
import { FinanceTags } from "../tags/tags.service.ts";
import { sammelbuchungTransactionIds } from "./aggregateExclusion.ts";
import { computeBalanceDelta } from "./balance.service.ts";
import { parseRangeBound } from "./dateRange.ts";
import { FinanceMutationClaims, checkOwnClaim } from "./idempotency.ts";

/** The non-payer's share, by the same rule for every splitMode (docs/ledger-spec.md §2.3): the whole amount unless it is split. */
export function otherShareOf(splitMode: SplitModeValue, amountCents: number): number {
  return splitMode === "SPLIT_EQUAL" ? halfForOther(amountCents) : amountCents;
}

/** The pure row → response projection, once the two joined reads are resolved. */
function buildResponse(
  row: TransactionRow,
  person1Id: string,
  categorySlug: string | null,
  tagRefs: { id: string; name: string }[],
): TransactionResponse {
  const otherShareCents = otherShareOf(row.splitMode, row.amountCents);
  return {
    id: row.id,
    householdId: row.householdId,
    payerId: row.payerId,
    splitMode: row.splitMode,
    amountCents: row.amountCents,
    description: row.description,
    categoryId: row.categoryId,
    categorySlug,
    tags: tagRefs,
    bookedAt: toIso(row.bookedAt),
    dateSource: row.dateSource,
    origin: row.origin,
    planPeriod: row.planPeriod,
    createdBy: row.createdBy,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    otherShareCents,
    payerShareCents: row.amountCents - otherShareCents,
    balanceDeltaCents: computeBalanceDelta(row, person1Id),
    isExpense: isExpenseTx(row),
  };
}

/** `409 transaction_generated` unless the row was booked by hand. */
const assertManual = Effect.fnUntraced(function* (row: TransactionRow): Effect.fn.Return<void, Conflict> {
  if (row.origin !== "manual") {
    return yield* new Conflict({ code: "transaction_generated", text: "server.transaction.generated" });
  }
});

/**
 * `0` is the only forbidden transaction amount (docs/spec.md §3.6, §3.2:
 * `422 transaction_amount_zero`). Raised directly here — not via a schema
 * check on `CreateTransactionRequestSchema` — because every schema issue
 * surfaces as the generic `422 validation_failed` (`lib/errors.ts`), which
 * would make `transaction_amount_zero` a code the wire contract promises but
 * the server can never actually produce.
 */
const assertAmountNotZero = Effect.fnUntraced(function* (amountCents: number): Effect.fn.Return<void, ApiFailure> {
  if (amountCents === 0) {
    return yield* new ApiFailure({ status: 422, code: "transaction_amount_zero", text: "server.validation.amountNotZero" });
  }
});

export interface CreateTransactionServiceInput extends CreateTransactionRequest {
  householdId: string;
  viewerId: string;
  createdBy: string;
}

export interface MutationOutcome {
  response: TransactionResponse;
  /** false when this call was a replay of an already-applied `mutationId`. */
  applied: boolean;
}

export interface UpdateTransactionServiceInput extends UpdateTransactionRequest {
  householdId: string;
  viewerId: string;
}

export interface TransactionListFilters {
  from?: string;
  to?: string;
  kind?: TxKindValue;
  splitMode?: SplitModeValue;
  payerId?: string;
  categoryId?: string;
  tagIds?: string;
  origin?: TransactionOriginValue;
  q?: string;
  includeAggregates: boolean;
  sort: "bookedAt" | "-bookedAt" | "amount" | "-amount";
  limit: number;
  offset: number;
}

/**
 * The `kind` query filter, expressed the way `projectKind` READS a row back
 * (`packages/shared/src/ledger.ts`): the two "theirs" kinds mean `payer_id IS
 * NOT the viewer`, not `payer_id = the other member's id`.
 *
 * Going through `kindToStorage(kind, viewerId, otherId)` instead needs an
 * `otherId`, and the only way to get one for a read is `otherMemberId(...) ??
 * viewerId` — the fallback every single-member household hits while the second
 * invite is still open. With `otherId === viewerId`, `THEIRS_SPLIT` compiles to
 * `payer = viewer AND SPLIT_EQUAL`, which is EXACTLY the `MINE_SPLIT` filter:
 * "show me what the other person paid" answered with the viewer's own rows
 * instead of an empty page. `TRANSFER` degrades the same way onto the reverse
 * settlement direction, which `projectKind` deliberately does not name.
 *
 * `!= viewer` needs no member lookup, cannot be spoofed by a missing second
 * member, and stays correct for any row whose payer is not a current member.
 */
function kindFilterConditions(kind: TxKindValue, viewerId: string): SQL[] {
  const splitMode: SplitModeValue = kind === "FOR_THEM" ? "OTHER_ONLY" : kind === "TRANSFER" ? "SETTLEMENT" : "SPLIT_EQUAL";
  const payerIsViewer = kind === "MINE_SPLIT" || kind === "FOR_THEM";
  return [
    payerIsViewer ? eq(transactions.payerId, viewerId) : ne(transactions.payerId, viewerId),
    eq(transactions.splitMode, splitMode),
  ];
}

/** The cash book: create, read, update, delete and the filtered, paginated list. */
export class FinanceTransactions extends Context.Service<
  FinanceTransactions,
  {
    /**
     * `POST …/transactions`. Claim + insert + link all run inside ONE `database.transaction`, so a mutation claim is
     * never left pointing at a row that does not exist (docs/spec.md §2.9).
     */
    readonly createTransaction: (
      input: CreateTransactionServiceInput,
    ) => Effect.Effect<MutationOutcome, ApiFailure | Conflict | Internal | NotFound | DatabaseError>;
    /** `PATCH …/transactions/:transactionId`. `409 transaction_generated` unless `origin === "manual"`. */
    readonly updateTransaction: (
      transactionId: string,
      input: UpdateTransactionServiceInput,
    ) => Effect.Effect<MutationOutcome, ApiFailure | Conflict | Internal | NotFound | DatabaseError>;
    /**
     * `DELETE …/transactions/:transactionId`. `409 transaction_generated` unless
     * `origin === "manual"`. Idempotent under a replayed `mutationId` —
     * INCLUDING after the row is already gone, which is the case a naive
     * "load-then-claim" ordering misses: the row a replay would 404 on looking
     * up IS the evidence the first delivery already succeeded. `peekMutationClaim`
     * checks the claim by `mutationId` alone, before `transactions` is touched at
     * all, so that case answers 204 (already applied) instead of 404.
     */
    readonly deleteTransaction: (
      householdId: string,
      transactionId: string,
      mutationId?: string,
    ) => Effect.Effect<void, Conflict | NotFound | DatabaseError>;
    readonly getTransaction: (
      householdId: string,
      transactionId: string,
    ) => Effect.Effect<TransactionResponse, Internal | NotFound | DatabaseError>;
    readonly listTransactions: (
      householdId: string,
      viewerId: string,
      filters: TransactionListFilters,
    ) => Effect.Effect<TransactionListResponse, ValidationFailed | Internal | DatabaseError>;
    /** The row → response projection (the old `export { toResponse as toTransactionResponse }`). */
    readonly toTransactionResponse: (
      row: TransactionRow,
      person1Id: string,
    ) => Effect.Effect<TransactionResponse, DatabaseError>;
  }
>()("toon/api/modules/finance/services/ledger/transactions.service/FinanceTransactions") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const database = yield* Database;
      const participants = yield* FinanceParticipants;
      const categoriesService = yield* FinanceCategories;
      const tagsService = yield* FinanceTags;
      const claims = yield* FinanceMutationClaims;

      const toTransactionResponse = Effect.fn("FinanceTransactions.toTransactionResponse")(function* (
        row: TransactionRow,
        person1Id: string,
      ) {
        const [categorySlug, tagRefs] = yield* Effect.all([
          categoriesService.categorySlugOf(row.categoryId),
          tagsService.tagRefsOf(row.id),
        ]);
        return buildResponse(row, person1Id, categorySlug, tagRefs);
      });

      /**
       * {@link toTransactionResponse} for a whole page: the categories and tags of EVERY row in
       * two queries instead of two per row. At the contract's `limit=200` the
       * per-row version costs up to 400 extra round trips, on the endpoint the list
       * screen and every offline-first refetch hit hardest.
       */
      const toResponsePage = Effect.fnUntraced(function* (rows: readonly TransactionRow[], person1Id: string) {
        const categoryIds = [...new Set(rows.map((row) => row.categoryId).filter((id): id is string => id !== null))];
        const [categorySlugs, tagRefs] = yield* Effect.all([
          categoriesService.categorySlugsByIds(categoryIds),
          tagsService.tagRefsByTransactionIds(rows.map((row) => row.id)),
        ]);
        return rows.map((row) =>
          buildResponse(row, person1Id, row.categoryId === null ? null : (categorySlugs.get(row.categoryId) ?? null), tagRefs.get(row.id) ?? []),
        );
      });

      const loadRowOr404 = Effect.fnUntraced(function* (householdId: string, transactionId: string) {
        const rows = yield* database.use((db) =>
          db
            .select()
            .from(transactions)
            .where(and(eq(transactions.id, transactionId), eq(transactions.householdId, householdId)))
            .limit(1),
        );
        const row = rows[0];
        if (!row) return yield* new NotFound({ text: "server.transaction.notFound" });
        return row;
      });

      /** Resolves the `otherId` `kindToStorage` needs, failing only for the two kinds that actually require one. */
      const resolveOtherId = Effect.fnUntraced(function* (householdId: string, viewerId: string, kind: TxKindValue) {
        if (kind === "THEIRS_SPLIT" || kind === "TRANSFER") {
          return yield* participants.requireOtherMemberId(householdId, viewerId);
        }
        return (yield* participants.otherMemberId(householdId, viewerId)) ?? viewerId;
      });

      const assertCategoryExists = Effect.fnUntraced(function* (householdId: string, categoryId: string) {
        const rows = yield* database.use((db) =>
          db
            .select({ id: categories.id })
            .from(categories)
            .where(and(eq(categories.id, categoryId), eq(categories.householdId, householdId)))
            .limit(1),
        );
        if (rows.length === 0) return yield* new NotFound();
      });

      /** Transaction ids that carry ALL of `tagIds` (docs/spec.md §3.6). Empty result short-circuits the caller to an empty page. */
      const transactionIdsWithAllTags = Effect.fnUntraced(function* (tagIds: readonly string[]) {
        const rows = yield* database.use((db) =>
          db
            .select({ transactionId: transactionTags.transactionId, tagCount: sql<number>`count(distinct ${transactionTags.tagId})` })
            .from(transactionTags)
            .where(inArray(transactionTags.tagId, [...tagIds]))
            .groupBy(transactionTags.transactionId)
            .having(sql`count(distinct ${transactionTags.tagId}) = ${tagIds.length}`),
        );
        return rows.map((row) => row.transactionId);
      });

      const createTransaction = Effect.fn("FinanceTransactions.createTransaction")(function* (
        input: CreateTransactionServiceInput,
      ) {
        yield* assertAmountNotZero(input.amountCents);
        return yield* database.transaction(
          Effect.gen(function* () {
            const person1Id = yield* participants.slot1UserId(input.householdId);

            if (input.mutationId) {
              const claim = yield* claims.claimMutation(input.mutationId, input.householdId, null);
              if (!claim.claimed) {
                if (!claim.transactionId) return yield* new Internal();
                const existing = yield* loadRowOr404(input.householdId, claim.transactionId);
                return { response: yield* toTransactionResponse(existing, person1Id), applied: false } satisfies MutationOutcome;
              }
            }

            if (input.categoryId) yield* assertCategoryExists(input.householdId, input.categoryId);

            const otherId = yield* resolveOtherId(input.householdId, input.viewerId, input.kind);
            const { payerId, splitMode } = kindToStorage(input.kind, input.viewerId, otherId);

            const id = crypto.randomUUID();
            const timestamp = yield* financeTimeMillis;
            yield* database.use((db) =>
              db.insert(transactions).values({
                id,
                householdId: input.householdId,
                payerId,
                splitMode,
                amountCents: input.amountCents,
                description: input.description,
                categoryId: input.categoryId ?? null,
                bookedAt: input.bookedAt ? Date.parse(input.bookedAt) : timestamp,
                dateSource: "exact",
                origin: "manual",
                planPeriod: null,
                categorySource: "manual",
                importSeq: null,
                externalKey: null,
                createdBy: input.createdBy,
                createdAt: timestamp,
                updatedAt: timestamp,
              }),
            );

            yield* tagsService.syncTransactionTags(input.householdId, id, input.tags ?? []);
            if (input.mutationId) yield* claims.linkMutationClaim(input.mutationId, id);

            const row = yield* loadRowOr404(input.householdId, id);
            return { response: yield* toTransactionResponse(row, person1Id), applied: true } satisfies MutationOutcome;
          }),
        );
      });

      const updateTransaction = Effect.fn("FinanceTransactions.updateTransaction")(function* (
        transactionId: string,
        input: UpdateTransactionServiceInput,
      ) {
        if (input.amountCents !== undefined) yield* assertAmountNotZero(input.amountCents);
        return yield* database.transaction(
          Effect.gen(function* () {
            const person1Id = yield* participants.slot1UserId(input.householdId);
            const existing = yield* loadRowOr404(input.householdId, transactionId);
            yield* assertManual(existing);

            if (input.mutationId) {
              const claim = yield* claims.claimMutation(input.mutationId, input.householdId, transactionId);
              if (!claim.claimed) {
                yield* checkOwnClaim(claim);
                const current = yield* loadRowOr404(input.householdId, transactionId);
                return { response: yield* toTransactionResponse(current, person1Id), applied: false } satisfies MutationOutcome;
              }
            }

            if (input.categoryId) yield* assertCategoryExists(input.householdId, input.categoryId);

            const patch: Partial<typeof transactions.$inferInsert> = { updatedAt: yield* financeTimeMillis };

            if (input.kind !== undefined) {
              const otherId = yield* resolveOtherId(input.householdId, input.viewerId, input.kind);
              const { payerId, splitMode } = kindToStorage(input.kind, input.viewerId, otherId);
              patch.payerId = payerId;
              patch.splitMode = splitMode;
            }
            if (input.amountCents !== undefined) patch.amountCents = input.amountCents;
            if (input.description !== undefined) patch.description = input.description;
            if (input.categoryId !== undefined) patch.categoryId = input.categoryId;
            if (input.bookedAt !== undefined) patch.bookedAt = Date.parse(input.bookedAt);

            yield* database.use((db) => db.update(transactions).set(patch).where(eq(transactions.id, transactionId)));
            if (input.tags !== undefined) yield* tagsService.syncTransactionTags(input.householdId, transactionId, input.tags);

            const row = yield* loadRowOr404(input.householdId, transactionId);
            return { response: yield* toTransactionResponse(row, person1Id), applied: true } satisfies MutationOutcome;
          }),
        );
      });

      const deleteTransaction = Effect.fn("FinanceTransactions.deleteTransaction")(function* (
        householdId: string,
        transactionId: string,
        mutationId?: string,
      ) {
        yield* database.transaction(
          Effect.gen(function* () {
            if (mutationId && (yield* claims.peekMutationClaim(mutationId, householdId))) return; // replay of an already-applied delete

            const existing = yield* loadRowOr404(householdId, transactionId);
            yield* assertManual(existing);

            if (mutationId) {
              const claim = yield* claims.claimMutation(mutationId, householdId, transactionId);
              if (!claim.claimed) {
                yield* checkOwnClaim(claim);
                return; // lost a race with a concurrent delivery of this same call
              }
            }

            yield* tagsService.clearTransactionTags(transactionId);
            yield* database.use((db) => db.delete(transactions).where(eq(transactions.id, transactionId)));
          }),
        );
      });

      const getTransaction = Effect.fn("FinanceTransactions.getTransaction")(function* (
        householdId: string,
        transactionId: string,
      ) {
        const person1Id = yield* participants.slot1UserId(householdId);
        const row = yield* loadRowOr404(householdId, transactionId);
        return yield* toTransactionResponse(row, person1Id);
      });

      const listTransactions = Effect.fn("FinanceTransactions.listTransactions")(function* (
        householdId: string,
        viewerId: string,
        filters: TransactionListFilters,
      ) {
        const person1Id = yield* participants.slot1UserId(householdId);
        const conditions = [eq(transactions.householdId, householdId)];

        if (filters.from) conditions.push(gte(transactions.bookedAt, yield* parseRangeBound(filters.from, "from")));
        if (filters.to) conditions.push(lte(transactions.bookedAt, yield* parseRangeBound(filters.to, "to")));
        if (filters.splitMode) conditions.push(eq(transactions.splitMode, filters.splitMode));
        if (filters.payerId) conditions.push(eq(transactions.payerId, filters.payerId));
        if (filters.categoryId) conditions.push(eq(transactions.categoryId, filters.categoryId));
        if (filters.origin) conditions.push(eq(transactions.origin, filters.origin));
        if (filters.q && filters.q.trim().length > 0) {
          const pattern = `%${escapeLikePattern(filters.q.trim().toLowerCase())}%`;
          conditions.push(sql`lower(${transactions.description}) like ${pattern} escape '\\'`);
        }

        if (filters.kind) conditions.push(...kindFilterConditions(filters.kind, viewerId));

        if (filters.tagIds) {
          const ids = [...new Set(filters.tagIds.split(",").map((id) => id.trim()).filter((id) => id.length > 0))].slice(0, 10);
          if (ids.length > 0) {
            const matching = yield* transactionIdsWithAllTags(ids);
            if (matching.length === 0) {
              return { items: [], total: 0, limit: filters.limit, offset: filters.offset } satisfies TransactionListResponse;
            }
            conditions.push(inArray(transactions.id, matching));
          }
        }

        if (!filters.includeAggregates) {
          const excluded = yield* sammelbuchungTransactionIds(householdId).pipe(Effect.provideService(Database, database));
          if (excluded.length > 0) conditions.push(notInArray(transactions.id, excluded));
        }

        const where = and(...conditions);
        const counted = yield* database.use((db) => db.select({ value: sql<number>`count(*)` }).from(transactions).where(where));
        const [{ value: total } = { value: 0 }] = counted;

        const orderColumns =
          filters.sort === "bookedAt"
            ? [asc(transactions.bookedAt), asc(transactions.importSeq)]
            : filters.sort === "amount"
              ? [asc(transactions.amountCents)]
              : filters.sort === "-amount"
                ? [desc(transactions.amountCents)]
                : [desc(transactions.bookedAt), desc(transactions.importSeq)];

        const rows = yield* database.use((db) =>
          db
            .select()
            .from(transactions)
            .where(where)
            .orderBy(...orderColumns)
            .limit(filters.limit)
            .offset(filters.offset),
        );

        const items = yield* toResponsePage(rows, person1Id);
        return { items, total: Number(total), limit: filters.limit, offset: filters.offset } satisfies TransactionListResponse;
      });

      return FinanceTransactions.of({
        createTransaction,
        updateTransaction,
        deleteTransaction,
        getTransaction,
        listTransactions,
        toTransactionResponse,
      });
    }),
  );
}
