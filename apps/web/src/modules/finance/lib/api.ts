/**
 * The finance module's API functions: F `lib/api.ts` §transactions through §settlements (F
 * lines 532–880), re-homed under `/api/households/:householdId/finance/…`, plus the three
 * participant fetchers (M3 decision 4). The ONLY fetch is still `request` in `@/lib/api`; this
 * file adds no transport of its own.
 *
 * `export *` re-exports the core client, so a finance screen imports everything it needs from
 * here. The three renamed shared types are imported aliased (M3 decision 8): the bare
 * `TagListResponse`, `TagResponse`, `UpdateTagRequest` and `PaginationQuery` names are the
 * recipe's and the core's in the flat `@toon/shared` barrel.
 */
import {
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
import { queryString, request, seg, type RequestOptions } from "@/lib/api";

export * from "@/lib/api";

/* -------------------------------------------------------------------------- */
/* transactions                                                               */
/* -------------------------------------------------------------------------- */

function transactionsBase(householdId: string): string {
  return `/api/households/${seg(householdId)}/finance/transactions`;
}

export function fetchTransactions(
  householdId: string,
  query: Partial<TransactionListQuery> = {},
  options?: RequestOptions,
): Promise<TransactionListResponse> {
  return request<TransactionListResponse>(
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
  );
}

export function createTransaction(
  householdId: string,
  body: CreateTransactionRequest,
  options?: RequestOptions,
): Promise<TransactionResponse> {
  return request<TransactionResponse>(transactionsBase(householdId), { ...options, method: "POST", body });
}

export function fetchTransactionSummary(
  householdId: string,
  query: Partial<TransactionSummaryQuery> = {},
  options?: RequestOptions,
): Promise<TransactionSummaryResponse> {
  return request<TransactionSummaryResponse>(
    `${transactionsBase(householdId)}/summary${queryString({
      from: query.from,
      to: query.to,
      includeAggregates: query.includeAggregates,
    })}`,
    options,
  );
}

export function fetchTransaction(
  householdId: string,
  transactionId: string,
  options?: RequestOptions,
): Promise<TransactionResponse> {
  return request<TransactionResponse>(`${transactionsBase(householdId)}/${seg(transactionId)}`, options);
}

export function updateTransaction(
  householdId: string,
  transactionId: string,
  body: UpdateTransactionRequest,
  options?: RequestOptions,
): Promise<TransactionResponse> {
  return request<TransactionResponse>(`${transactionsBase(householdId)}/${seg(transactionId)}`, {
    ...options,
    method: "PATCH",
    body,
  });
}

export function deleteTransaction(
  householdId: string,
  transactionId: string,
  mutationId?: string,
  options?: RequestOptions,
): Promise<void> {
  return request<void>(`${transactionsBase(householdId)}/${seg(transactionId)}${queryString({ mutationId })}`, {
    ...options,
    method: "DELETE",
  });
}

/* -------------------------------------------------------------------------- */
/* categories, tags                                                          */
/* -------------------------------------------------------------------------- */

export function fetchCategories(
  householdId: string,
  includeHidden?: boolean,
  options?: RequestOptions,
): Promise<CategoryListResponse> {
  return request<CategoryListResponse>(
    `/api/households/${seg(householdId)}/finance/categories${queryString({ includeHidden })}`,
    options,
  );
}

export function createCategory(
  householdId: string,
  body: CreateCategoryRequest,
  options?: RequestOptions,
): Promise<CategoryResponse> {
  return request<CategoryResponse>(`/api/households/${seg(householdId)}/finance/categories`, {
    ...options,
    method: "POST",
    body,
  });
}

export function updateCategory(
  householdId: string,
  categoryId: string,
  body: UpdateCategoryRequest,
  options?: RequestOptions,
): Promise<CategoryResponse> {
  return request<CategoryResponse>(`/api/households/${seg(householdId)}/finance/categories/${seg(categoryId)}`, {
    ...options,
    method: "PATCH",
    body,
  });
}

export function deleteCategory(
  householdId: string,
  categoryId: string,
  reassignTo?: string,
  options?: RequestOptions,
): Promise<void> {
  return request<void>(
    `/api/households/${seg(householdId)}/finance/categories/${seg(categoryId)}${queryString({ reassignTo })}`,
    { ...options, method: "DELETE" },
  );
}

export function fetchTags(
  householdId: string,
  query: { q?: string; limit?: number } = {},
  options?: RequestOptions,
): Promise<TagListResponse> {
  return request<TagListResponse>(
    `/api/households/${seg(householdId)}/finance/tags${queryString({ q: query.q, limit: query.limit })}`,
    options,
  );
}

export function updateTag(
  householdId: string,
  tagId: string,
  body: UpdateTagRequest,
  options?: RequestOptions,
): Promise<TagResponse> {
  return request<TagResponse>(`/api/households/${seg(householdId)}/finance/tags/${seg(tagId)}`, {
    ...options,
    method: "PATCH",
    body,
  });
}

export function deleteTag(householdId: string, tagId: string, options?: RequestOptions): Promise<void> {
  return request<void>(`/api/households/${seg(householdId)}/finance/tags/${seg(tagId)}`, {
    ...options,
    method: "DELETE",
  });
}

/* -------------------------------------------------------------------------- */
/* fixed-cost plan                                                            */
/* -------------------------------------------------------------------------- */

function planBase(householdId: string): string {
  return `/api/households/${seg(householdId)}/finance/plan`;
}

export function fetchPlan(householdId: string, options?: RequestOptions): Promise<PlanResponse> {
  return request<PlanResponse>(planBase(householdId), options);
}

export function updatePlan(
  householdId: string,
  body: { enabled?: boolean; payerId?: string; startPeriod?: string },
  options?: RequestOptions,
): Promise<PlanResponse> {
  return request<PlanResponse>(planBase(householdId), { ...options, method: "PATCH", body });
}

export function fetchPlanPreview(
  householdId: string,
  period: string,
  options?: RequestOptions,
): Promise<PlanComputationResponse> {
  return request<PlanComputationResponse>(`${planBase(householdId)}/preview${queryString({ period })}`, options);
}

export function runPlan(
  householdId: string,
  body: RunPlanRequest = {},
  options?: RequestOptions,
): Promise<RunPlanResponse> {
  return request<RunPlanResponse>(`${planBase(householdId)}/run`, { ...options, method: "POST", body });
}

export function recalculatePlan(
  householdId: string,
  body: RecalculatePlanRequest,
  options?: RequestOptions,
): Promise<RecalculatePlanResponse> {
  return request<RecalculatePlanResponse>(`${planBase(householdId)}/recalculate`, {
    ...options,
    method: "POST",
    body,
  });
}

export function fetchPlanRuns(
  householdId: string,
  query: Partial<PaginationQuery> = {},
  options?: RequestOptions,
): Promise<AccrualRunListResponse> {
  return request<AccrualRunListResponse>(
    `${planBase(householdId)}/runs${queryString({ limit: query.limit, offset: query.offset })}`,
    options,
  );
}

export function createFixedCostItem(
  householdId: string,
  body: CreateFixedCostItemRequest,
  options?: RequestOptions,
): Promise<FixedCostItemResponse> {
  return request<FixedCostItemResponse>(`${planBase(householdId)}/items`, {
    ...options,
    method: "POST",
    body,
  });
}

export function updateFixedCostItem(
  householdId: string,
  itemId: string,
  body: UpdateFixedCostItemRequest,
  options?: RequestOptions,
): Promise<FixedCostItemResponse> {
  return request<FixedCostItemResponse>(`${planBase(householdId)}/items/${seg(itemId)}`, {
    ...options,
    method: "PATCH",
    body,
  });
}

export function deleteFixedCostItem(householdId: string, itemId: string, options?: RequestOptions): Promise<void> {
  return request<void>(`${planBase(householdId)}/items/${seg(itemId)}`, { ...options, method: "DELETE" });
}

export function createIncome(
  householdId: string,
  body: CreateIncomeRequest,
  options?: RequestOptions,
): Promise<IncomeResponse> {
  return request<IncomeResponse>(`${planBase(householdId)}/incomes`, { ...options, method: "POST", body });
}

export function updateIncome(
  householdId: string,
  incomeId: string,
  body: UpdateIncomeRequest,
  options?: RequestOptions,
): Promise<IncomeResponse> {
  return request<IncomeResponse>(`${planBase(householdId)}/incomes/${seg(incomeId)}`, {
    ...options,
    method: "PATCH",
    body,
  });
}

export function deleteIncome(householdId: string, incomeId: string, options?: RequestOptions): Promise<void> {
  return request<void>(`${planBase(householdId)}/incomes/${seg(incomeId)}`, { ...options, method: "DELETE" });
}

/* -------------------------------------------------------------------------- */
/* balance                                                                    */
/* -------------------------------------------------------------------------- */

export function fetchBalance(
  householdId: string,
  query: Partial<BalanceQuery> = {},
  options?: RequestOptions,
): Promise<BalanceResponse> {
  return request<BalanceResponse>(
    `/api/households/${seg(householdId)}/finance/balance${queryString({ includeAggregates: query.includeAggregates })}`,
    options,
  );
}

export function fetchBalanceHistory(
  householdId: string,
  query: Partial<BalanceHistoryQuery> = {},
  options?: RequestOptions,
): Promise<BalanceHistoryResponse> {
  return request<BalanceHistoryResponse>(
    `/api/households/${seg(householdId)}/finance/balance/history${queryString({
      from: query.from,
      to: query.to,
      includeAggregates: query.includeAggregates,
    })}`,
    options,
  );
}

/* -------------------------------------------------------------------------- */
/* settlements                                                                */
/* -------------------------------------------------------------------------- */

export function fetchSettlements(
  householdId: string,
  query: Partial<PaginationQuery> = {},
  options?: RequestOptions,
): Promise<TransactionListResponse> {
  return request<TransactionListResponse>(
    `/api/households/${seg(householdId)}/finance/settlements${queryString({
      limit: query.limit,
      offset: query.offset,
    })}`,
    options,
  );
}

export function createSettlement(
  householdId: string,
  body: CreateSettlementRequest,
  options?: RequestOptions,
): Promise<SettlementResponse> {
  return request<SettlementResponse>(`/api/households/${seg(householdId)}/finance/settlements`, {
    ...options,
    method: "POST",
    body,
  });
}

/* -------------------------------------------------------------------------- */
/* participants (M3 decision 4)                                               */
/* -------------------------------------------------------------------------- */

function participantsBase(householdId: string): string {
  return `/api/households/${seg(householdId)}/finance/participants`;
}

export function fetchFinanceParticipants(
  householdId: string,
  options?: RequestOptions,
): Promise<FinanceParticipantListResponse> {
  return request<FinanceParticipantListResponse>(participantsBase(householdId), options);
}

export function updateFinanceParticipants(
  householdId: string,
  body: UpdateFinanceParticipantsRequest,
  options?: RequestOptions,
): Promise<FinanceParticipantListResponse> {
  return request<FinanceParticipantListResponse>(participantsBase(householdId), {
    ...options,
    method: "PUT",
    body,
  });
}

export function updateMyFinanceDisplayName(
  householdId: string,
  body: UpdateFinanceDisplayNameRequest,
  options?: RequestOptions,
): Promise<FinanceParticipantResponse> {
  return request<FinanceParticipantResponse>(`${participantsBase(householdId)}/me`, {
    ...options,
    method: "PATCH",
    body,
  });
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
  return request<FinanceParticipantResponse>(`${participantsBase(householdId)}/${seg(userId)}`, {
    ...options,
    method: "PATCH",
    body,
  });
}
