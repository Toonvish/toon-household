/**
 * The finance module's API: F `lib/api.ts` §transactions through §settlements (F lines 532–880),
 * re-homed under `/api/households/:householdId/finance/…`, plus the three participant fetchers
 * (M3 decision 4). This file adds no transport of its own (SPEC §2): every request is a member of
 * {@link FinanceApi}, built on the helpers of `@/lib/api` (`getJson`, `sendJson`, `sendVoid`), run on
 * the web's one runtime, and decoded with the shared `…ResponseSchema` (docs/EFFECT.md E11; plan
 * docs/plans/e6-web-client.md P3, P7, P8). The exported functions keep their names, signatures and
 * `Promise` results as facades over `runPromise`.
 *
 * A READ whose answer fails the decode is `invalid_response`; a WRITE never fails on its answer (P7a:
 * the finance outbox replays create, update and delete, and a 2xx proves the server applied them).
 *
 * `export *` re-exports the core client, so a finance screen imports everything it needs from
 * here. The three renamed shared types are imported aliased (M3 decision 8): the bare
 * `TagListResponse`, `TagResponse`, `UpdateTagRequest` and `PaginationQuery` names are the
 * recipe's and the core's in the flat `@toon/shared` barrel.
 */
import {
  AccrualRunListResponseSchema,
  BalanceHistoryResponseSchema,
  BalanceResponseSchema,
  CategoryListResponseSchema,
  CategoryResponseSchema,
  FinanceParticipantListResponseSchema,
  FinanceParticipantResponseSchema,
  FinanceTagListResponseSchema,
  FinanceTagResponseSchema,
  FixedCostItemResponseSchema,
  IncomeResponseSchema,
  PlanComputationResponseSchema,
  PlanResponseSchema,
  RecalculatePlanResponseSchema,
  RunPlanResponseSchema,
  SettlementResponseSchema,
  TransactionListResponseSchema,
  TransactionResponseSchema,
  TransactionSummaryResponseSchema,
  type AccrualRunListResponse,
  type BalanceHistoryQuery,
  type BalanceHistoryResponse,
  type BalanceQuery,
  type BalanceResponse,
  type CategoryListResponse,
  type CategoryResponse,
  type CreateCategoryRequest,
  type CreateFixedCostItemRequest,
  type CreateIncomeRequest,
  type CreateSettlementRequest,
  type CreateTransactionRequest,
  type FinanceParticipantListResponse,
  type FinanceParticipantResponse,
  type FinancePaginationQuery as PaginationQuery,
  type FinanceTagListResponse as TagListResponse,
  type FinanceTagResponse as TagResponse,
  type FinanceUpdateTagRequest as UpdateTagRequest,
  type FixedCostItemResponse,
  type IncomeResponse,
  type PlanComputationResponse,
  type PlanResponse,
  type RecalculatePlanRequest,
  type RecalculatePlanResponse,
  type RunPlanRequest,
  type RunPlanResponse,
  type SettlementResponse,
  type TransactionListQuery,
  type TransactionListResponse,
  type TransactionResponse,
  type TransactionSummaryQuery,
  type TransactionSummaryResponse,
  type UpdateCategoryRequest,
  type UpdateFinanceDisplayNameRequest,
  type UpdateFinanceParticipantsRequest,
  type UpdateFixedCostItemRequest,
  type UpdateIncomeRequest,
  type UpdateTransactionRequest,
} from "@toon/shared";
import { getJson, queryString, seg, sendJson, sendVoid, type RequestOptions } from "@/lib/api";
import { runPromise } from "@/lib/runtime";

export * from "@/lib/api";

/* -------------------------------------------------------------------------- */
/* the finance endpoints, described once                                      */
/* -------------------------------------------------------------------------- */

function transactionsBase(householdId: string): string {
  return `/api/households/${seg(householdId)}/finance/transactions`;
}

function planBase(householdId: string): string {
  return `/api/households/${seg(householdId)}/finance/plan`;
}

function participantsBase(householdId: string): string {
  return `/api/households/${seg(householdId)}/finance/participants`;
}

/**
 * Every finance request as an Effect (plan e6 P8): the member name is the facade's name, the parameters are
 * the facade's without the signal, and only `allowUnauthorized` is read from `options`. Reads go through
 * `getJson`, writes through `sendJson` / `sendVoid` (P7a: an outbox replay never sees `invalid_response`).
 * Members are arrow functions: nothing is read at definition (P16).
 */
export const FinanceApi = {
  /* transactions */

  fetchTransactions: (householdId: string, query: Partial<TransactionListQuery> = {}, options?: RequestOptions) =>
    getJson(
      TransactionListResponseSchema,
      `${transactionsBase(householdId)}${queryString({
        from: query.from,
        to: query.to,
        kind: query.kind,
        splitMode: query.splitMode,
        payerId: query.payerId,
        categoryId: query.categoryId,
        tagIds: query.tagIds,
        origin: query.origin,
        q: query.q,
        includeAggregates: query.includeAggregates,
        sort: query.sort,
        limit: query.limit,
        offset: query.offset,
      })}`,
      options,
    ),

  createTransaction: (householdId: string, body: CreateTransactionRequest, options?: RequestOptions) =>
    sendJson("POST", TransactionResponseSchema, transactionsBase(householdId), body, options),

  fetchTransactionSummary: (
    householdId: string,
    query: Partial<TransactionSummaryQuery> = {},
    options?: RequestOptions,
  ) =>
    getJson(
      TransactionSummaryResponseSchema,
      `${transactionsBase(householdId)}/summary${queryString({
        from: query.from,
        to: query.to,
        includeAggregates: query.includeAggregates,
      })}`,
      options,
    ),

  fetchTransaction: (householdId: string, transactionId: string, options?: RequestOptions) =>
    getJson(TransactionResponseSchema, `${transactionsBase(householdId)}/${seg(transactionId)}`, options),

  updateTransaction: (
    householdId: string,
    transactionId: string,
    body: UpdateTransactionRequest,
    options?: RequestOptions,
  ) =>
    sendJson(
      "PATCH",
      TransactionResponseSchema,
      `${transactionsBase(householdId)}/${seg(transactionId)}`,
      body,
      options,
    ),

  deleteTransaction: (householdId: string, transactionId: string, mutationId?: string, options?: RequestOptions) =>
    sendVoid(
      "DELETE",
      `${transactionsBase(householdId)}/${seg(transactionId)}${queryString({ mutationId })}`,
      undefined,
      options,
    ),

  /* categories, tags */

  fetchCategories: (householdId: string, includeHidden?: boolean, options?: RequestOptions) =>
    getJson(
      CategoryListResponseSchema,
      `/api/households/${seg(householdId)}/finance/categories${queryString({ includeHidden })}`,
      options,
    ),

  createCategory: (householdId: string, body: CreateCategoryRequest, options?: RequestOptions) =>
    sendJson("POST", CategoryResponseSchema, `/api/households/${seg(householdId)}/finance/categories`, body, options),

  updateCategory: (householdId: string, categoryId: string, body: UpdateCategoryRequest, options?: RequestOptions) =>
    sendJson(
      "PATCH",
      CategoryResponseSchema,
      `/api/households/${seg(householdId)}/finance/categories/${seg(categoryId)}`,
      body,
      options,
    ),

  deleteCategory: (householdId: string, categoryId: string, reassignTo?: string, options?: RequestOptions) =>
    sendVoid(
      "DELETE",
      `/api/households/${seg(householdId)}/finance/categories/${seg(categoryId)}${queryString({ reassignTo })}`,
      undefined,
      options,
    ),

  fetchTags: (householdId: string, query: { q?: string; limit?: number } = {}, options?: RequestOptions) =>
    getJson(
      FinanceTagListResponseSchema,
      `/api/households/${seg(householdId)}/finance/tags${queryString({ q: query.q, limit: query.limit })}`,
      options,
    ),

  updateTag: (householdId: string, tagId: string, body: UpdateTagRequest, options?: RequestOptions) =>
    sendJson(
      "PATCH",
      FinanceTagResponseSchema,
      `/api/households/${seg(householdId)}/finance/tags/${seg(tagId)}`,
      body,
      options,
    ),

  deleteTag: (householdId: string, tagId: string, options?: RequestOptions) =>
    sendVoid("DELETE", `/api/households/${seg(householdId)}/finance/tags/${seg(tagId)}`, undefined, options),

  /* fixed-cost plan */

  fetchPlan: (householdId: string, options?: RequestOptions) =>
    getJson(PlanResponseSchema, planBase(householdId), options),

  updatePlan: (
    householdId: string,
    body: { enabled?: boolean; payerId?: string; startPeriod?: string },
    options?: RequestOptions,
  ) => sendJson("PATCH", PlanResponseSchema, planBase(householdId), body, options),

  fetchPlanPreview: (householdId: string, period: string, options?: RequestOptions) =>
    getJson(PlanComputationResponseSchema, `${planBase(householdId)}/preview${queryString({ period })}`, options),

  runPlan: (householdId: string, body: RunPlanRequest = {}, options?: RequestOptions) =>
    sendJson("POST", RunPlanResponseSchema, `${planBase(householdId)}/run`, body, options),

  recalculatePlan: (householdId: string, body: RecalculatePlanRequest, options?: RequestOptions) =>
    sendJson("POST", RecalculatePlanResponseSchema, `${planBase(householdId)}/recalculate`, body, options),

  fetchPlanRuns: (householdId: string, query: Partial<PaginationQuery> = {}, options?: RequestOptions) =>
    getJson(
      AccrualRunListResponseSchema,
      `${planBase(householdId)}/runs${queryString({ limit: query.limit, offset: query.offset })}`,
      options,
    ),

  createFixedCostItem: (householdId: string, body: CreateFixedCostItemRequest, options?: RequestOptions) =>
    sendJson("POST", FixedCostItemResponseSchema, `${planBase(householdId)}/items`, body, options),

  updateFixedCostItem: (
    householdId: string,
    itemId: string,
    body: UpdateFixedCostItemRequest,
    options?: RequestOptions,
  ) => sendJson("PATCH", FixedCostItemResponseSchema, `${planBase(householdId)}/items/${seg(itemId)}`, body, options),

  deleteFixedCostItem: (householdId: string, itemId: string, options?: RequestOptions) =>
    sendVoid("DELETE", `${planBase(householdId)}/items/${seg(itemId)}`, undefined, options),

  createIncome: (householdId: string, body: CreateIncomeRequest, options?: RequestOptions) =>
    sendJson("POST", IncomeResponseSchema, `${planBase(householdId)}/incomes`, body, options),

  updateIncome: (householdId: string, incomeId: string, body: UpdateIncomeRequest, options?: RequestOptions) =>
    sendJson("PATCH", IncomeResponseSchema, `${planBase(householdId)}/incomes/${seg(incomeId)}`, body, options),

  deleteIncome: (householdId: string, incomeId: string, options?: RequestOptions) =>
    sendVoid("DELETE", `${planBase(householdId)}/incomes/${seg(incomeId)}`, undefined, options),

  /* balance */

  fetchBalance: (householdId: string, query: Partial<BalanceQuery> = {}, options?: RequestOptions) =>
    getJson(
      BalanceResponseSchema,
      `/api/households/${seg(householdId)}/finance/balance${queryString({ includeAggregates: query.includeAggregates })}`,
      options,
    ),

  fetchBalanceHistory: (householdId: string, query: Partial<BalanceHistoryQuery> = {}, options?: RequestOptions) =>
    getJson(
      BalanceHistoryResponseSchema,
      `/api/households/${seg(householdId)}/finance/balance/history${queryString({
        from: query.from,
        to: query.to,
        includeAggregates: query.includeAggregates,
      })}`,
      options,
    ),

  /* settlements */

  fetchSettlements: (householdId: string, query: Partial<PaginationQuery> = {}, options?: RequestOptions) =>
    getJson(
      TransactionListResponseSchema,
      `/api/households/${seg(householdId)}/finance/settlements${queryString({
        limit: query.limit,
        offset: query.offset,
      })}`,
      options,
    ),

  createSettlement: (householdId: string, body: CreateSettlementRequest, options?: RequestOptions) =>
    sendJson(
      "POST",
      SettlementResponseSchema,
      `/api/households/${seg(householdId)}/finance/settlements`,
      body,
      options,
    ),

  /* participants (M3 decision 4) */

  fetchFinanceParticipants: (householdId: string, options?: RequestOptions) =>
    getJson(FinanceParticipantListResponseSchema, participantsBase(householdId), options),

  updateFinanceParticipants: (
    householdId: string,
    body: UpdateFinanceParticipantsRequest,
    options?: RequestOptions,
  ) => sendJson("PUT", FinanceParticipantListResponseSchema, participantsBase(householdId), body, options),

  updateMyFinanceDisplayName: (
    householdId: string,
    body: UpdateFinanceDisplayNameRequest,
    options?: RequestOptions,
  ) => sendJson("PATCH", FinanceParticipantResponseSchema, `${participantsBase(householdId)}/me`, body, options),

  renameParticipant: (
    householdId: string,
    userId: string,
    body: UpdateFinanceDisplayNameRequest,
    options?: RequestOptions,
  ) =>
    sendJson(
      "PATCH",
      FinanceParticipantResponseSchema,
      `${participantsBase(householdId)}/${seg(userId)}`,
      body,
      options,
    ),
};

/* -------------------------------------------------------------------------- */
/* transactions                                                               */
/* -------------------------------------------------------------------------- */

export function fetchTransactions(
  householdId: string,
  query: Partial<TransactionListQuery> = {},
  options?: RequestOptions,
): Promise<TransactionListResponse> {
  return runPromise(FinanceApi.fetchTransactions(householdId, query, options), options);
}

export function createTransaction(
  householdId: string,
  body: CreateTransactionRequest,
  options?: RequestOptions,
): Promise<TransactionResponse> {
  return runPromise(FinanceApi.createTransaction(householdId, body, options), options);
}

export function fetchTransactionSummary(
  householdId: string,
  query: Partial<TransactionSummaryQuery> = {},
  options?: RequestOptions,
): Promise<TransactionSummaryResponse> {
  return runPromise(FinanceApi.fetchTransactionSummary(householdId, query, options), options);
}

export function fetchTransaction(
  householdId: string,
  transactionId: string,
  options?: RequestOptions,
): Promise<TransactionResponse> {
  return runPromise(FinanceApi.fetchTransaction(householdId, transactionId, options), options);
}

export function updateTransaction(
  householdId: string,
  transactionId: string,
  body: UpdateTransactionRequest,
  options?: RequestOptions,
): Promise<TransactionResponse> {
  return runPromise(FinanceApi.updateTransaction(householdId, transactionId, body, options), options);
}

export function deleteTransaction(
  householdId: string,
  transactionId: string,
  mutationId?: string,
  options?: RequestOptions,
): Promise<void> {
  return runPromise(FinanceApi.deleteTransaction(householdId, transactionId, mutationId, options), options);
}

/* -------------------------------------------------------------------------- */
/* categories, tags                                                          */
/* -------------------------------------------------------------------------- */

export function fetchCategories(
  householdId: string,
  includeHidden?: boolean,
  options?: RequestOptions,
): Promise<CategoryListResponse> {
  return runPromise(FinanceApi.fetchCategories(householdId, includeHidden, options), options);
}

export function createCategory(
  householdId: string,
  body: CreateCategoryRequest,
  options?: RequestOptions,
): Promise<CategoryResponse> {
  return runPromise(FinanceApi.createCategory(householdId, body, options), options);
}

export function updateCategory(
  householdId: string,
  categoryId: string,
  body: UpdateCategoryRequest,
  options?: RequestOptions,
): Promise<CategoryResponse> {
  return runPromise(FinanceApi.updateCategory(householdId, categoryId, body, options), options);
}

export function deleteCategory(
  householdId: string,
  categoryId: string,
  reassignTo?: string,
  options?: RequestOptions,
): Promise<void> {
  return runPromise(FinanceApi.deleteCategory(householdId, categoryId, reassignTo, options), options);
}

export function fetchTags(
  householdId: string,
  query: { q?: string; limit?: number } = {},
  options?: RequestOptions,
): Promise<TagListResponse> {
  return runPromise(FinanceApi.fetchTags(householdId, query, options), options);
}

export function updateTag(
  householdId: string,
  tagId: string,
  body: UpdateTagRequest,
  options?: RequestOptions,
): Promise<TagResponse> {
  return runPromise(FinanceApi.updateTag(householdId, tagId, body, options), options);
}

export function deleteTag(householdId: string, tagId: string, options?: RequestOptions): Promise<void> {
  return runPromise(FinanceApi.deleteTag(householdId, tagId, options), options);
}

/* -------------------------------------------------------------------------- */
/* fixed-cost plan                                                            */
/* -------------------------------------------------------------------------- */

export function fetchPlan(householdId: string, options?: RequestOptions): Promise<PlanResponse> {
  return runPromise(FinanceApi.fetchPlan(householdId, options), options);
}

export function updatePlan(
  householdId: string,
  body: { enabled?: boolean; payerId?: string; startPeriod?: string },
  options?: RequestOptions,
): Promise<PlanResponse> {
  return runPromise(FinanceApi.updatePlan(householdId, body, options), options);
}

export function fetchPlanPreview(
  householdId: string,
  period: string,
  options?: RequestOptions,
): Promise<PlanComputationResponse> {
  return runPromise(FinanceApi.fetchPlanPreview(householdId, period, options), options);
}

export function runPlan(
  householdId: string,
  body: RunPlanRequest = {},
  options?: RequestOptions,
): Promise<RunPlanResponse> {
  return runPromise(FinanceApi.runPlan(householdId, body, options), options);
}

export function recalculatePlan(
  householdId: string,
  body: RecalculatePlanRequest,
  options?: RequestOptions,
): Promise<RecalculatePlanResponse> {
  return runPromise(FinanceApi.recalculatePlan(householdId, body, options), options);
}

export function fetchPlanRuns(
  householdId: string,
  query: Partial<PaginationQuery> = {},
  options?: RequestOptions,
): Promise<AccrualRunListResponse> {
  return runPromise(FinanceApi.fetchPlanRuns(householdId, query, options), options);
}

export function createFixedCostItem(
  householdId: string,
  body: CreateFixedCostItemRequest,
  options?: RequestOptions,
): Promise<FixedCostItemResponse> {
  return runPromise(FinanceApi.createFixedCostItem(householdId, body, options), options);
}

export function updateFixedCostItem(
  householdId: string,
  itemId: string,
  body: UpdateFixedCostItemRequest,
  options?: RequestOptions,
): Promise<FixedCostItemResponse> {
  return runPromise(FinanceApi.updateFixedCostItem(householdId, itemId, body, options), options);
}

export function deleteFixedCostItem(householdId: string, itemId: string, options?: RequestOptions): Promise<void> {
  return runPromise(FinanceApi.deleteFixedCostItem(householdId, itemId, options), options);
}

export function createIncome(
  householdId: string,
  body: CreateIncomeRequest,
  options?: RequestOptions,
): Promise<IncomeResponse> {
  return runPromise(FinanceApi.createIncome(householdId, body, options), options);
}

export function updateIncome(
  householdId: string,
  incomeId: string,
  body: UpdateIncomeRequest,
  options?: RequestOptions,
): Promise<IncomeResponse> {
  return runPromise(FinanceApi.updateIncome(householdId, incomeId, body, options), options);
}

export function deleteIncome(householdId: string, incomeId: string, options?: RequestOptions): Promise<void> {
  return runPromise(FinanceApi.deleteIncome(householdId, incomeId, options), options);
}

/* -------------------------------------------------------------------------- */
/* balance                                                                    */
/* -------------------------------------------------------------------------- */

export function fetchBalance(
  householdId: string,
  query: Partial<BalanceQuery> = {},
  options?: RequestOptions,
): Promise<BalanceResponse> {
  return runPromise(FinanceApi.fetchBalance(householdId, query, options), options);
}

export function fetchBalanceHistory(
  householdId: string,
  query: Partial<BalanceHistoryQuery> = {},
  options?: RequestOptions,
): Promise<BalanceHistoryResponse> {
  return runPromise(FinanceApi.fetchBalanceHistory(householdId, query, options), options);
}

/* -------------------------------------------------------------------------- */
/* settlements                                                                */
/* -------------------------------------------------------------------------- */

export function fetchSettlements(
  householdId: string,
  query: Partial<PaginationQuery> = {},
  options?: RequestOptions,
): Promise<TransactionListResponse> {
  return runPromise(FinanceApi.fetchSettlements(householdId, query, options), options);
}

export function createSettlement(
  householdId: string,
  body: CreateSettlementRequest,
  options?: RequestOptions,
): Promise<SettlementResponse> {
  return runPromise(FinanceApi.createSettlement(householdId, body, options), options);
}

/* -------------------------------------------------------------------------- */
/* participants (M3 decision 4)                                               */
/* -------------------------------------------------------------------------- */

export function fetchFinanceParticipants(
  householdId: string,
  options?: RequestOptions,
): Promise<FinanceParticipantListResponse> {
  return runPromise(FinanceApi.fetchFinanceParticipants(householdId, options), options);
}

export function updateFinanceParticipants(
  householdId: string,
  body: UpdateFinanceParticipantsRequest,
  options?: RequestOptions,
): Promise<FinanceParticipantListResponse> {
  return runPromise(FinanceApi.updateFinanceParticipants(householdId, body, options), options);
}

export function updateMyFinanceDisplayName(
  householdId: string,
  body: UpdateFinanceDisplayNameRequest,
  options?: RequestOptions,
): Promise<FinanceParticipantResponse> {
  return runPromise(FinanceApi.updateMyFinanceDisplayName(householdId, body, options), options);
}

/**
 * PATCH …/finance/participants/:userId — any participant renames the OTHER seat when it is a
 * placeholder (ADR 0006, plan m3b decision 6; F's "yourself or the placeholder" rename). A seat
 * with an account answers 403, a non-participant 404. The own seat stays `…/me`.
 */
export function renameParticipant(
  householdId: string,
  userId: string,
  body: UpdateFinanceDisplayNameRequest,
  options?: RequestOptions,
): Promise<FinanceParticipantResponse> {
  return runPromise(FinanceApi.renameParticipant(householdId, userId, body, options), options);
}
