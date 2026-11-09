/**
 * The calendar module's TanStack Query layer (plan m8 P24, section 5.4), built on the core key factory in
 * `@/lib/queries`. Core keys come from the spread, never redefined.
 *
 * Key layout:
 *   ["toon","household",householdId,"calendar"]                                    <- every calendar query (a write invalidates it)
 *   [...all, "occurrences", from, to, filterKey(filters)]                          <- persisted
 *   [...all, "entries", filterKey(filters)]                                        <- persisted
 *   [...all, "entry", entryId]                                                     <- persisted
 *   [...all, "resources", { includeArchived }]                                     <- persisted
 *   [...all, "waste", from]                                                        <- persisted
 *   [...all, "feed"]                                                               <- NOT persisted (plan m9 P17)
 *
 * Reads are `offlineFirst` and persisted (the manifest's `persistQueryAllowList`), so a cold offline start renders
 * the last-seen calendar. WRITES ARE ONLINE ONLY (P24): every mutation hook goes through the offline guard, which
 * shows the core offline toast and sends nothing while `onlineManager` says offline; there is no outbox. Every
 * write invalidates `[...all]` when it settles. The done toggle is optimistic over EVERY cached occurrence list of
 * the household and rolls back on error.
 */
import {
  onlineManager,
  queryOptions,
  useMutation,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import type {
  CalendarEntry,
  CalendarEntryListQuery,
  CalendarFeedCreatedResponse,
  CalendarFeedResponse,
  CalendarOccurrence,
  CalendarOccurrenceListResponse,
  CalendarResource,
  CalendarWasteImportResponse,
  CalendarWastePreview,
  CalendarWasteSettings,
  CalendarWasteSourceRequest,
  CreateCalendarEntryRequest,
  CreateCalendarFeedRequest,
  CreateCalendarResourceRequest,
  PutCalendarWasteSettingsRequest,
  UpdateCalendarEntryRequest,
  UpdateCalendarFeedRequest,
  UpdateCalendarResourceRequest,
} from "@toon/shared";
import { useCallback } from "react";
import { useToast } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { filterKey, STALE_TIME } from "@/lib/queries";
import { runPromise } from "@/lib/runtime";
import {
  CalendarApi,
  createEntry,
  createFeed,
  createResource,
  deleteEntry,
  deleteFeed,
  deleteResource,
  deleteWasteImport,
  importWasteFromFile,
  importWasteFromUrl,
  previewWasteFromFile,
  previewWasteFromUrl,
  putWasteSettings,
  setOccurrenceStatus,
  updateEntry,
  updateFeed,
  updateResource,
  type CalendarOccurrenceFilters,
} from "./api";

export * from "@/lib/queries";

const ROOT = "toon" as const;

/* -------------------------------------------------------------------------- */
/* keys                                                                       */
/* -------------------------------------------------------------------------- */

export const calendarKeys = {
  all: (householdId: string) => [ROOT, "household", householdId, "calendar"] as const,
  occurrences: (householdId: string, from: string, to: string, filters?: Record<string, unknown>) =>
    [ROOT, "household", householdId, "calendar", "occurrences", from, to, filterKey(filters)] as const,
  /** The prefix of every occurrence list of the household (the optimistic toggle walks them all). */
  occurrencesRoot: (householdId: string) => [ROOT, "household", householdId, "calendar", "occurrences"] as const,
  entries: (householdId: string, filters?: Record<string, unknown>) =>
    [ROOT, "household", householdId, "calendar", "entries", filterKey(filters)] as const,
  entry: (householdId: string, entryId: string) => [ROOT, "household", householdId, "calendar", "entry", entryId] as const,
  resources: (householdId: string, includeArchived = false) =>
    [ROOT, "household", householdId, "calendar", "resources", { includeArchived }] as const,
  waste: (householdId: string, from: string) => [ROOT, "household", householdId, "calendar", "waste", from] as const,
  /** The member's subscription link (plan m9 P17): never persisted, so `lastUsedAt` is always the server's. */
  feed: (householdId: string) => [ROOT, "household", householdId, "calendar", "feed"] as const,
};

/* -------------------------------------------------------------------------- */
/* query options                                                              */
/* -------------------------------------------------------------------------- */

/** The occurrences overlapping `[from, to]` (at most 400 days, plan m8 P4) plus the household's members (P9a). */
export const occurrencesQuery = (
  householdId: string,
  from: string,
  to: string,
  filters: CalendarOccurrenceFilters = {},
) =>
  queryOptions({
    queryKey: calendarKeys.occurrences(householdId, from, to, filters),
    queryFn: ({ signal }) => runPromise(CalendarApi.fetchOccurrences(householdId, from, to, filters), { signal }),
    staleTime: STALE_TIME.list,
    networkMode: "offlineFirst",
  });

/** The household's series (P9b; never the waste imports'). */
export const entriesQuery = (householdId: string, query: Partial<CalendarEntryListQuery> = {}) =>
  queryOptions({
    queryKey: calendarKeys.entries(householdId, query),
    queryFn: ({ signal }) => runPromise(CalendarApi.fetchEntries(householdId, query), { signal }),
    staleTime: STALE_TIME.list,
    networkMode: "offlineFirst",
  });

export const entryQuery = (householdId: string, entryId: string) =>
  queryOptions({
    queryKey: calendarKeys.entry(householdId, entryId),
    queryFn: ({ signal }) => runPromise(CalendarApi.fetchEntry(householdId, entryId), { signal }),
    staleTime: STALE_TIME.detail,
    networkMode: "offlineFirst",
  });

/** The cars; archived ones only when asked for (the Autos screen). */
export const resourcesQuery = (householdId: string, includeArchived = false) =>
  queryOptions({
    queryKey: calendarKeys.resources(householdId, includeArchived),
    queryFn: ({ signal }) => runPromise(CalendarApi.fetchResources(householdId, includeArchived), { signal }),
    staleTime: STALE_TIME.meta,
    networkMode: "offlineFirst",
  });

/** The waste overview from the client's today (`from`, P16). */
export const wasteQuery = (householdId: string, from: string) =>
  queryOptions({
    queryKey: calendarKeys.waste(householdId, from),
    queryFn: ({ signal }) => runPromise(CalendarApi.fetchWaste(householdId, from), { signal }),
    staleTime: STALE_TIME.list,
    networkMode: "offlineFirst",
  });

/**
 * The member's subscription link (plan m9 P17): `{ feed: null }` without one. Online only and refetched on every
 * mount (no stale time): `lastUsedAt` is the proof that a phone subscribed, so a cached value would mislead. The
 * answer never carries the token or the URL.
 */
export const feedQuery = (householdId: string) =>
  queryOptions({
    queryKey: calendarKeys.feed(householdId),
    queryFn: ({ signal }) => runPromise(CalendarApi.fetchFeed(householdId), { signal }),
    // Explicit: the query client's default is `STALE_TIME.list` (30 s), which would show a stale "not fetched yet"
    // right after the phone subscribed (M9-T09 review).
    staleTime: 0,
  });

/* -------------------------------------------------------------------------- */
/* writes: online only                                                        */
/* -------------------------------------------------------------------------- */

/** Whether a calendar write may be sent now (P24). The argument is the test seam; the app reads `onlineManager`. */
export function canWriteNow(isOnline: boolean = onlineManager.isOnline()): boolean {
  return isOnline;
}

/** `() => boolean`: true when online; when offline it shows the core offline toast and answers false. */
export function useOfflineGuard(): () => boolean {
  const toast = useToast();
  const t = useT();
  return useCallback(() => {
    if (canWriteNow()) return true;
    toast.toast({ title: t("common.session.offlineSaveBlocked"), variant: "warning" });
    return false;
  }, [toast, t]);
}

interface MutateCallbacks<TData> {
  onSuccess?: (data: TData) => void;
  onError?: (error: unknown) => void;
  onSettled?: () => void;
}

/**
 * A calendar write: guarded (offline sends nothing), `networkMode: "always"` (a write is never paused into a queue
 * that no outbox would keep), and invalidating every calendar query of the household when it settles (or only
 * `invalidateKey` when given: the feed writes touch no entry).
 */
function useCalendarMutation<TVars, TData>(
  mutationFn: (vars: TVars) => Promise<TData>,
  householdId: string,
  invalidateKey: QueryKey = calendarKeys.all(householdId),
) {
  const queryClient = useQueryClient();
  const guard = useOfflineGuard();
  const mutation = useMutation<TData, unknown, TVars>({
    mutationFn,
    networkMode: "always",
    onSettled: () => queryClient.invalidateQueries({ queryKey: invalidateKey }),
  });
  const mutate = (vars: TVars, callbacks: MutateCallbacks<TData> = {}): void => {
    if (!guard()) return;
    mutation.mutate(vars, callbacks);
  };
  return { ...mutation, mutate };
}

export function useCreateEntry(householdId: string) {
  return useCalendarMutation((body: CreateCalendarEntryRequest): Promise<CalendarEntry> => createEntry(householdId, body), householdId);
}

export function useUpdateEntry(householdId: string) {
  return useCalendarMutation(
    (vars: { entryId: string; body: UpdateCalendarEntryRequest }): Promise<CalendarEntry> =>
      updateEntry(householdId, vars.entryId, vars.body),
    householdId,
  );
}

export function useDeleteEntry(householdId: string) {
  return useCalendarMutation((entryId: string): Promise<void> => deleteEntry(householdId, entryId), householdId);
}

export function useCreateResource(householdId: string) {
  return useCalendarMutation(
    (body: CreateCalendarResourceRequest): Promise<CalendarResource> => createResource(householdId, body),
    householdId,
  );
}

export function useUpdateResource(householdId: string) {
  return useCalendarMutation(
    (vars: { resourceId: string; body: UpdateCalendarResourceRequest }): Promise<CalendarResource> =>
      updateResource(householdId, vars.resourceId, vars.body),
    householdId,
  );
}

export function useDeleteResource(householdId: string) {
  return useCalendarMutation((resourceId: string): Promise<void> => deleteResource(householdId, resourceId), householdId);
}

export function usePutWasteSettings(householdId: string) {
  return useCalendarMutation(
    (body: PutCalendarWasteSettingsRequest): Promise<CalendarWasteSettings> => putWasteSettings(householdId, body),
    householdId,
  );
}

/** Where a flyer comes from: the city's URL, or a PDF the user picked. */
export type WasteSource =
  | { readonly type: "url"; readonly request: CalendarWasteSourceRequest }
  | { readonly type: "file"; readonly file: File; readonly tour: number };

export function usePreviewWaste(householdId: string) {
  return useCalendarMutation(
    (source: WasteSource): Promise<CalendarWastePreview> =>
      source.type === "url"
        ? previewWasteFromUrl(householdId, source.request)
        : previewWasteFromFile(householdId, source.file, source.tour),
    householdId,
  );
}

export function useImportWaste(householdId: string) {
  return useCalendarMutation(
    (source: WasteSource): Promise<CalendarWasteImportResponse> =>
      source.type === "url"
        ? importWasteFromUrl(householdId, source.request)
        : importWasteFromFile(householdId, source.file, source.tour),
    householdId,
  );
}

export function useDeleteWasteImport(householdId: string) {
  return useCalendarMutation((importId: string): Promise<void> => deleteWasteImport(householdId, importId), householdId);
}

/*
 * The subscription link (plan m9 P13, P17): each write invalidates only `calendarKeys.feed`. The URL of a created
 * link reaches the caller through `onSuccess` and lives in component state; it is never written to the cache.
 */

export function useCreateFeed(householdId: string) {
  return useCalendarMutation(
    (body: CreateCalendarFeedRequest): Promise<CalendarFeedCreatedResponse> => createFeed(householdId, body),
    householdId,
    calendarKeys.feed(householdId),
  );
}

export function useUpdateFeed(householdId: string) {
  return useCalendarMutation(
    (body: UpdateCalendarFeedRequest): Promise<CalendarFeedResponse> => updateFeed(householdId, body),
    householdId,
    calendarKeys.feed(householdId),
  );
}

export function useDeleteFeed(householdId: string) {
  return useCalendarMutation((): Promise<void> => deleteFeed(householdId), householdId, calendarKeys.feed(householdId));
}

/* -------------------------------------------------------------------------- */
/* the optimistic done toggle                                                 */
/* -------------------------------------------------------------------------- */

/** One occurrence's new state: `done` (tasks), `skipped`, or `null` (open again). */
export interface OccurrenceStatusChange {
  readonly entryId: string;
  readonly date: string;
  readonly status: "done" | "skipped" | null;
}

/** What `applyOccurrenceStatus` replaced, for the rollback. */
export type OccurrenceSnapshot = ReadonlyArray<readonly [QueryKey, CalendarOccurrenceListResponse | undefined]>;

/** The occurrence with its new state (`doneBy` is the viewer for `done`, else null; P12). */
export function withStatus(
  occurrence: CalendarOccurrence,
  status: OccurrenceStatusChange["status"],
  userId: string,
): CalendarOccurrence {
  return { ...occurrence, status: status ?? "open", doneBy: status === "done" ? userId : null };
}

/**
 * Writes the new state into EVERY cached occurrence list of the household (any range, any filter) and returns
 * what it replaced. Lists without the occurrence are left as they are.
 */
export function applyOccurrenceStatus(
  queryClient: QueryClient,
  householdId: string,
  change: OccurrenceStatusChange,
  userId: string,
): OccurrenceSnapshot {
  const filter = { queryKey: calendarKeys.occurrencesRoot(householdId) };
  const snapshot = queryClient.getQueriesData<CalendarOccurrenceListResponse>(filter);
  const id = `${change.entryId}:${change.date}`;
  queryClient.setQueriesData<CalendarOccurrenceListResponse>(filter, (data) =>
    data === undefined || !data.items.some((occurrence) => occurrence.id === id)
      ? data
      : { ...data, items: data.items.map((occurrence) => (occurrence.id === id ? withStatus(occurrence, change.status, userId) : occurrence)) },
  );
  return snapshot;
}

/** Puts back what `applyOccurrenceStatus` replaced. */
export function restoreOccurrences(queryClient: QueryClient, snapshot: OccurrenceSnapshot): void {
  for (const [key, data] of snapshot) queryClient.setQueryData(key, data);
}

/**
 * Done, skipped or reset, optimistically (design §4.2): the lists change at once, an error puts them back and
 * shows the error, and the settle refetches the household's calendar.
 */
export function useSetOccurrenceStatus(householdId: string, userId: string) {
  const queryClient = useQueryClient();
  const guard = useOfflineGuard();
  const toast = useToast();
  const mutation = useMutation<CalendarOccurrence, unknown, OccurrenceStatusChange, OccurrenceSnapshot>({
    mutationFn: (change) => setOccurrenceStatus(householdId, change.entryId, change.date, { status: change.status }),
    networkMode: "always",
    onMutate: async (change) => {
      await queryClient.cancelQueries({ queryKey: calendarKeys.occurrencesRoot(householdId) });
      return applyOccurrenceStatus(queryClient, householdId, change, userId);
    },
    onError: (error, _change, snapshot) => {
      if (snapshot) restoreOccurrences(queryClient, snapshot);
      toast.fromError(error);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: calendarKeys.all(householdId) }),
  });
  const mutate = (change: OccurrenceStatusChange): void => {
    if (!guard()) return;
    mutation.mutate(change);
  };
  return { ...mutation, mutate };
}
