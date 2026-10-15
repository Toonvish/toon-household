/**
 * Session + active-household context.
 *
 *  - `useSession()`     — current user, households, loading/auth flags.
 *  - `useCurrentUser()` — the user, or throws inside guarded routes (never null there).
 *  - `useActiveHousehold()` — the household every household-scoped screen works on (persisted in
 *                         localStorage, defaults to the user's `activeHouseholdId`, then
 *                         the first household).
 *  - `useLogin() / useRegister() / useLogout()` — mutations that keep the cache in sync.
 *  - `<RequireAuth>`    — route guard, redirects to `/login?next=…`.
 *  - `<RequireActiveHousehold>` — for screens that need a household (Home and every module).
 *  - `<RequireModule>`  — module route guard: a module the active household has not enabled goes Home.
 *
 * The provider lives INSIDE the router (root route) so it can navigate on a 401.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { useT } from "@/lib/i18n";
import type {
  AuthSessionResponse,
  HouseholdRole,
  HouseholdWithRole,
  LoginRequest,
  MeResponse,
  ModuleId,
  RegisterRequest,
  User,
} from "@toon/shared";
import { roleAtLeast } from "@toon/shared";
import {
  loginWithPassword,
  logout as logoutRequest,
  registerAccount,
  setUnauthorizedHandler,
  updateProfile,
} from "./api";
import { safeNextPath } from "./navigation";
import { purgePersistedCache, setActiveCacheUser } from "./persist";
import { useOnlineStatus } from "./pwa";
import { healthQuery, invalidate, meQuery, queryKeys } from "./queries";
import { readStorage, storageKeys, writeStorage } from "./storage";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { FullPageLoader } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
// `enabled.ts` is pure and imports no registry; `@/modules` (the registry) must never be
// imported here — manifests import screens that import this file (plan §1 decision 7).
import { moduleGuard } from "@/modules/enabled";

export interface SessionContextValue {
  user: User | null;
  households: readonly HouseholdWithRole[];
  /** True while the bootstrap request is in flight (first load only). */
  isLoading: boolean;
  isAuthenticated: boolean;
  /** Bootstrap failure (server down) — a 401 is NOT an error. */
  error: unknown;
  refetch: () => Promise<unknown>;

  /**
   * False while the device reports no connection. Screens use it to disable writes
   * BEFORE they fail (see `useCanMutate`), because offline the app is read-only.
   */
  isOnline: boolean;
  /**
   * True when the user/recipes on screen come from the persisted offline cache and
   * the server could not be reached to confirm them. Cook mode is fine; anything
   * that writes is not.
   */
  isOfflineData: boolean;

  activeHouseholdId: string | null;
  activeHousehold: HouseholdWithRole | null;
  /** Switches the active household and remembers it on the server + in localStorage. */
  setActiveHousehold: (householdId: string) => void;
  /** Role in the active household. */
  role: HouseholdRole | null;
  /** `hasRole("admin")` — owner satisfies admin. */
  hasRole: (required: HouseholdRole) => boolean;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const meResult = useQuery(meQuery());
  const isOnline = useOnlineStatus();

  const me: MeResponse | null = meResult.data ?? null;
  const user = me?.user ?? null;
  const households = useMemo<readonly HouseholdWithRole[]>(() => me?.households ?? [], [me]);

  /**
   * Keep the offline cache pointed at the account on screen.
   *
   * This is the data-leak guard from lib/persist.ts: the id decides which
   * IndexedDB blob is written, and a change purges the store, so a second person on
   * the same phone can never restore the first one's recipes. Runs as an effect (not
   * in render) because it performs I/O.
   */
  useEffect(() => {
    if (user) setActiveCacheUser(user.id);
  }, [user]);

  /**
   * `data` from the persisted cache plus a failed refetch = we are showing what the
   * device already had. That is the honest signal for "read-only right now" — a
   * plain `navigator.onLine === false` also covers the captive-wifi case where the
   * browser thinks it is online and every request still fails.
   */
  const isOfflineData = user !== null && (!isOnline || meResult.isError);

  const [selectedHouseholdId, setSelectedHouseholdId] = useState<string | null>(() =>
    readStorage(storageKeys.activeHouseholdId),
  );

  /** Server-side "remember my active household"; failures are non-fatal. */
  const rememberHousehold = useMutation({
    mutationFn: (householdId: string) => updateProfile({ activeHouseholdId: householdId }),
    onSuccess: () => {
      void invalidate.me(queryClient);
    },
  });

  const activeHouseholdId = useMemo(() => {
    if (households.length === 0) return null;
    const candidates = [selectedHouseholdId, user?.activeHouseholdId ?? null];
    for (const candidate of candidates) {
      if (candidate && households.some((household) => household.id === candidate)) return candidate;
    }
    return households[0]?.id ?? null;
  }, [households, selectedHouseholdId, user?.activeHouseholdId]);

  const activeHousehold = useMemo(
    () => households.find((household) => household.id === activeHouseholdId) ?? null,
    [households, activeHouseholdId],
  );

  // Keep localStorage in sync with the effective household (also after joining a household).
  useEffect(() => {
    if (activeHouseholdId && activeHouseholdId !== readStorage(storageKeys.activeHouseholdId)) {
      writeStorage(storageKeys.activeHouseholdId, activeHouseholdId);
    }
  }, [activeHouseholdId]);

  const setActiveHousehold = useCallback(
    (householdId: string) => {
      setSelectedHouseholdId(householdId);
      writeStorage(storageKeys.activeHouseholdId, householdId);
      rememberHousehold.mutate(householdId);
    },
    [rememberHousehold],
  );

  // A 401 from any endpoint sends the user to the login screen (client-side). The server just
  // said this session is gone (expired, revoked elsewhere, password reset), so the persisted
  // cache goes the way `useLogout` sends it (toon-finance 1715207): otherwise the previous
  // user's data stays in IndexedDB on a shared device, restorable on the next cold offline start.
  useEffect(() => {
    setUnauthorizedHandler((next) => {
      queryClient.setQueryData(queryKeys.me(), null);
      setActiveCacheUser(null);
      void purgePersistedCache();
      void navigate({ to: "/login", search: { next }, replace: true });
    });
    return () => setUnauthorizedHandler(null);
  }, [navigate, queryClient]);

  const role = activeHousehold?.role ?? null;

  const value = useMemo<SessionContextValue>(
    () => ({
      user,
      households,
      isLoading: meResult.isPending,
      isAuthenticated: user !== null,
      error: meResult.error,
      refetch: () => meResult.refetch(),
      isOnline,
      isOfflineData,
      activeHouseholdId,
      activeHousehold,
      setActiveHousehold,
      role,
      hasRole: (required: HouseholdRole) => (role ? roleAtLeast(role, required) : false),
    }),
    [
      user,
      households,
      meResult.isPending,
      meResult.error,
      meResult.refetch,
      isOnline,
      isOfflineData,
      activeHouseholdId,
      activeHousehold,
      setActiveHousehold,
      role,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used inside <SessionProvider>.");
  }
  return context;
}

/** Inside `<RequireAuth>` the user is guaranteed — use this to avoid null checks. */
export function useCurrentUser(): User {
  const { user } = useSession();
  if (!user) throw new Error("useCurrentUser may only be used inside a protected route.");
  return user;
}

export interface ActiveHouseholdValue {
  /** Null only when the user is in no household at all. */
  householdId: string | null;
  household: HouseholdWithRole | null;
  households: readonly HouseholdWithRole[];
  setActiveHousehold: (householdId: string) => void;
  role: HouseholdRole | null;
  hasRole: (required: HouseholdRole) => boolean;
}

export function useActiveHousehold(): ActiveHouseholdValue {
  const { activeHouseholdId, activeHousehold, households, setActiveHousehold, role, hasRole } = useSession();
  return { householdId: activeHouseholdId, household: activeHousehold, households, setActiveHousehold, role, hasRole };
}

/**
 * Same as {@link useActiveHousehold} but the id is non-null — only valid below
 * `<RequireActiveHousehold>`, which is exactly where recipe/import screens live.
 */
export function useRequiredHouseholdId(): string {
  const { activeHouseholdId } = useSession();
  if (!activeHouseholdId) {
    throw new Error("No active household — <RequireActiveHousehold> is missing around this route.");
  }
  return activeHouseholdId;
}

/**
 * Whether an unconfirmed e-mail address is what is stopping this account writing.
 *
 * TWO conditions, and both are needed. The server only enforces the gate when it
 * can actually send a confirmation link (`features.verifiedEmailRequired` on
 * `/api/health`, see the API's services/auth/verifiedEmail.ts), and the account
 * only fails it while `emailVerifiedAt` is null. Reading just the second would
 * grey out every write on the default self-hosted stack, where no mail transport
 * is configured and nothing is gated at all.
 *
 * UNKNOWN COUNTS AS "NOT REQUIRED" — the opposite bias from
 * `useOcrImportAvailable`, on purpose. While the health probe is in flight, or
 * against a server predating the field, guessing "gated" would disable the whole
 * app and demand a confirmation that server never asks for; guessing "open" costs
 * at worst one 403 that {@link useCanMutate}'s copy already explains. The server
 * is the enforcement either way.
 *
 * THE TIMESTAMP, NOT THE FLAG. `emailVerified` was true for every account before
 * the confirmation flow existed; `emailVerifiedAt` is the only evidence, exactly
 * as on the server.
 */
export function useEmailVerificationBlock(): string | undefined {
  const { user } = useSession();
  const { data } = useQuery(healthQuery());
  const t = useT();

  if (data?.features?.verifiedEmailRequired !== true) return undefined;
  if (user === null) return undefined;
  if (user.emailVerifiedAt != null) return undefined;
  return t("common.session.emailUnverifiedBlocked");
}

/**
 * Whether the app may write right now.
 *
 * Two independent reasons it may not, and the ORDER matters: an unconfirmed
 * address is reported first because it is the one the user can actually do
 * something about, and it does not go away by walking towards the router.
 *
 * Offline support here is READ-ONLY on purpose: there is no conflict story for two
 * flatmates editing one recipe, so a "saved" that silently evaporates would be
 * worse than a disabled button. Screens use this to disable editors, the import
 * flow and every destructive action BEFORE the request fails, and to render
 * `reason` next to them.
 *
 * DO NOT USE THIS ON THE SHOPPING SCREENS. The shopping list is the one feature
 * that IS editable offline — its writes go through a persisted mutation outbox
 * (features/shopping/lib/offline.ts) and replay on reconnect — so `canMutate:
 * false` there is exactly backwards. Those screens gate only list
 * create/rename/delete on `isOnline`, and take the verification half of this
 * answer from {@link useEmailVerificationBlock} directly: a write the server will
 * refuse with 403 must not enter the outbox, because a queued mutation that can
 * never succeed just fails loudly on every reconnect.
 *
 * ```tsx
 * const { canMutate, reason } = useCanMutate();
 * <Button disabled={!canMutate} title={reason}>Save</Button>
 * ```
 */
export function useCanMutate(): { canMutate: boolean; reason: string | undefined } {
  const { isOnline } = useSession();
  const unverified = useEmailVerificationBlock();
  const t = useT();

  if (unverified !== undefined) return { canMutate: false, reason: unverified };
  return isOnline
    ? { canMutate: true, reason: undefined }
    : {
        canMutate: false,
        reason: t("common.session.offlineSaveBlocked"),
      };
}

/* -------------------------------------------------------------------------- */
/* auth mutations                                                             */
/* -------------------------------------------------------------------------- */

function useAuthSuccessHandler() {
  const queryClient = useQueryClient();
  return useCallback(
    (data: AuthSessionResponse) => {
      queryClient.setQueryData(queryKeys.me(), data);
      const householdId = data.activeHouseholdId ?? data.households[0]?.id ?? null;
      if (householdId) writeStorage(storageKeys.activeHouseholdId, householdId);
      void invalidate.households(queryClient);
    },
    [queryClient],
  );
}

export function useLogin() {
  const onAuthenticated = useAuthSuccessHandler();
  return useMutation<AuthSessionResponse, unknown, LoginRequest>({
    mutationFn: (body) => loginWithPassword(body),
    onSuccess: onAuthenticated,
  });
}

export function useRegister() {
  const onAuthenticated = useAuthSuccessHandler();
  return useMutation<AuthSessionResponse, unknown, RegisterRequest>({
    mutationFn: (body) => registerAccount(body),
    onSuccess: onAuthenticated,
  });
}

export function useLogout(options: { stayOnPage?: boolean } = {}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation<void, unknown, void>({
    mutationFn: () => logoutRequest(),
    // `onSettled`, not `onSuccess`: if the logout request itself fails (offline,
    // server down) the local state must still be gone. Leaving a persisted cache
    // behind on a phone whose owner just tapped "Abmelden" is the exact failure this
    // feature must not introduce.
    onSettled: async () => {
      writeStorage(storageKeys.activeHouseholdId, null);
      queryClient.setQueryData(queryKeys.me(), null);
      queryClient.clear();
      // Drops the IndexedDB blob AND the lastUserId pointer, so the next start has
      // nothing to restore and no id to restore it under.
      setActiveCacheUser(null);
      await purgePersistedCache();
      // The claim invite page logs out and stays where it is (its logged-out variant follows).
      if (!options.stayOnPage) await navigate({ to: "/login", replace: true });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* guards                                                                     */
/* -------------------------------------------------------------------------- */

/** Redirects to `/login?next=<current url>` when there is no session. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, error, refetch } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const redirecting = useRef(false);
  const t = useT();

  /**
   * AT MOST ONE REDIRECT PER MOUNT — the ref is the whole point.
   *
   * `useLocation()` reads `router.stores.location`, which flips to the new URL the
   * moment `navigate()` touches history, while THIS tree is still rendered (matches
   * only swap once the target route has loaded). So an effect keyed on
   * `location.href` fires again with `/login?next=%2F` already in hand and folds it
   * into the next redirect — `/login?next=%2Flogin%3Fnext%3D…`, growing on every
   * pass until the app is wedged on a multi-kilobyte URL.
   *
   * `safeNextPath` is the second, independent stop: it rejects any target that
   * itself starts with `/login`, so the parameter can never nest even once.
   */
  useEffect(() => {
    if (isLoading || error) return;
    if (isAuthenticated) {
      redirecting.current = false;
      return;
    }
    if (redirecting.current) return;
    redirecting.current = true;
    const next = safeNextPath(location.href);
    void navigate({ to: "/login", search: next === "/" ? {} : { next }, replace: true });
  }, [isLoading, isAuthenticated, error, navigate, location.href]);

  if (isLoading) return <FullPageLoader label={t("common.session.checkingLogin")} />;

  // A RESTORED SESSION WINS OVER A FAILED REFETCH. This is what makes the installed
  // app usable in airplane mode: `/api/auth/me` cannot be reached, but the persisted
  // bootstrap payload is there, so the app renders and cook mode works on recipes
  // that were opened before. The banner and the disabled editors say the rest.
  //
  // It is not a way in: the cookie is still the only thing the API accepts, and a
  // 401 once there IS a connection clears the cache and redirects (lib/api.ts).
  if (isAuthenticated) return <>{children}</>;

  if (error) {
    return (
      <div className="mx-auto w-full max-w-md p-4">
        <ErrorState
          error={error}
          title={t("common.session.serverUnreachable")}
          onRetry={() => {
            void refetch();
          }}
        />
      </div>
    );
  }

  return <FullPageLoader label={t("common.session.redirectingToLogin")} />;
}

/** For household-scoped screens: shows an onboarding card when the user has no household. */
export function RequireActiveHousehold({ children }: { children: ReactNode }) {
  const { households, activeHouseholdId } = useSession();
  const navigate = useNavigate();
  const t = useT();

  if (households.length === 0 || !activeHouseholdId) {
    return (
      <div className="mx-auto w-full max-w-md p-4">
        <EmptyState
          icon={<Users />}
          title={t("common.session.noGroupTitle")}
          description={t("common.session.noGroupDescription")}
          action={
            <Button
              fullWidth
              onClick={() => {
                void navigate({ to: "/households" });
              }}
            >
              {t("common.session.createGroup")}
            </Button>
          }
        />
      </div>
    );
  }

  return <>{children}</>;
}

/**
 * Module route guard (SPEC D2, §5): a module route for a household without that module goes
 * Home with a toast. Rendered by the module layout route (router.tsx), never around a lazy screen.
 */
export function RequireModule({ moduleId, children }: { moduleId: ModuleId; children: ReactNode }) {
  const { activeHousehold } = useSession();
  const navigate = useNavigate();
  const { toast } = useToast();
  const t = useT();

  const modules = activeHousehold?.modules ?? [];
  const decision = moduleGuard(modules, moduleId);

  useEffect(() => {
    if (decision !== "redirect") return;
    toast({ variant: "info", title: t("home.moduleDisabled.toast") });
    void navigate({ to: "/", replace: true });
    // `toast`/`t`/`navigate` identities are not part of the decision; fire once per redirect.
  }, [decision, moduleId]);

  return decision === "render" ? <>{children}</> : null;
}
