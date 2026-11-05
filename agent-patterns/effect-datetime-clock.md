# effect-datetime-clock: time, calendar values and schedules

Distilled from the vendored Effect source (`repos/effect`, effect@4.0.5). Read-only reference; every API name
below was grepped in `repos/effect/packages/effect/src`. Time is a service in v4: read it through `Clock` /
`DateTime.now` so `TestClock` can drive it, never through `Date.now()` in a service (E12).

## 1. What it is for, and the imports

- `Clock`: the time service (`currentTimeMillis`, `currentTimeNanos`, `monotonicTimeNanos`, `sleep`). In v4 it is a
  `Context.Reference` (`Clock.Clock`) with a default, so it needs no layer in production.
- `DateTime`: immutable instants (`Utc`) and zoned instants (`Zoned`), parsing, calendar math, ISO formatting.
- `Schedule`: retry / repeat / polling policies for `Effect.retry`, `Effect.repeat`, `Effect.schedule`.
- `TestClock`: a virtual clock for `bun test` (`effect/testing`).

```ts
import { Clock, DateTime, Duration, Effect, Fiber, Option, Schedule, Schema } from "effect"
import { TestClock } from "effect/testing"
import { describe, expect, test } from "bun:test"
```

All of these are in the `effect` barrel except `TestClock` (`effect/testing`, a real package export, not an
`effect/unstable/*` path). Never `@effect/vitest`, never an import from `repos/`.

## 2. Constructors and call shapes

### 2.1 The current time, as an Effect (replaces `Date.now()` / `new Date()` in services)

```ts
Effect.gen(function*() {
  const nowMs = yield* Clock.currentTimeMillis        // number, unix ms: what the DB columns store
  const now = yield* DateTime.now                     // DateTime.Utc built from the same Clock
  const iso = DateTime.formatIso(now)                 // "2024-06-15T14:30:00.000Z": what the wire carries
  return { nowMs, iso, again: DateTime.toEpochMillis(now) }
})
```

Source: `ai-docs/src/07_datetime/10_creating-and-formatting.ts` ("Use DateTime.now to get the current time from
Effect's Clock service. Using the Clock service ensures tests can use the `TestClock`"); `Clock.ts`
(`currentTimeMillis`), `DateTime.ts` (`now`, `toEpochMillis`, `formatIso`).

### 2.2 Parsing untrusted input, safe and unsafe

```ts
const parsed: Option.Option<DateTime.Utc> = DateTime.make("2024-06-15T14:30:00.000Z") // None on a bad string
const trusted = DateTime.makeUnsafe(1_718_461_800_000)  // throws IllegalArgumentError on an invalid input
const fromSeconds = DateTime.fromEpochSeconds(1_704_067_200)
```

`DateTime.Input` is a `DateTime`, a `Date`, epoch millis, a `Partial<Parts>` object or a string. A string with no
zone is read as UTC (`internal/dateTime.ts` appends `"Z"`). For wire input prefer a Schema (section 3) over
`make`. Source: `DateTime.ts` (`make`, `makeUnsafe`, `fromEpochSeconds`), `ai-docs/src/07_datetime/10_...ts`.

### 2.3 Calendar math, comparison, parts

```ts
const endsAt = now.pipe(DateTime.add({ hours: 2 }))                 // new value, the original is immutable
const monthStart = now.pipe(DateTime.startOf("month"))
const due = DateTime.isGreaterThan(now, monthStart)                  // boolean
const gap: Duration.Duration = DateTime.distance(monthStart, now)    // signed: other minus self
const { year, month, day } = DateTime.toPartsUtc(now)                // month is 1-12
```

`add` / `subtract` take plural fields (`years`, `months`, `days`, `hours`, `minutes`, `seconds`, `milliseconds`),
`startOf` / `endOf` take a singular unit (`"day"`, `"week"`, `"month"` ...; `weekStartsOn` option, default 0 =
Sunday). `DateTime.formatIsoDateUtc(dt)` gives `YYYY-MM-DD` in UTC. Source: `DateTime.ts` (`add`, `startOf`,
`distance`, `isGreaterThan`, `toPartsUtc`, `formatIsoDateUtc`, `DateTime.Parts`, `PartsForMath`).

### 2.4 Time zones (only where a zone is a requirement)

```ts
const inAuckland = now.pipe(DateTime.setZoneNamedUnsafe("Pacific/Auckland"))
const maybeSydney: Option.Option<DateTime.Zoned> = now.pipe(DateTime.setZoneNamed("Australia/Sydney"))
const local = yield* DateTime.nowInCurrentZone     // needs DateTime.CurrentTimeZone in the environment
// provide it: Effect.provide(DateTime.layerCurrentZoneNamed("Europe/Berlin"))
```

`DateTime.formatIso` always prints the UTC instant, also for a `Zoned` value; use `formatIsoDate` for the
zone-adjusted calendar day. Source: `ai-docs/src/07_datetime/20_time-zones.ts`, `DateTime.ts` (`CurrentTimeZone`,
`layerCurrentZoneNamed`, `withCurrentZoneNamed`).

### 2.5 Schedules for retry, repeat and the periodic tick

```ts
export const retryBackoff = Schedule.min([
  Schedule.exponential("250 millis"),
  Schedule.spaced("10 seconds")                     // caps each delay at 10 s
]).pipe(Schedule.jittered)

const tick = task.pipe(Effect.repeat(Schedule.spaced("6 hours")))  // runs once now, then 6 h after each end
const later = task.pipe(Effect.schedule(Schedule.spaced("6 hours"))) // waits 6 h FIRST (the schedule is stepped before the run), then every 6 h
const retried = task.pipe(Effect.retry(Schedule.recurs(3)))        // 1 initial attempt + up to 3 retries
const limited = task.pipe(Effect.repeat({ times: 2 }))             // Effect.repeat also takes {times, while, until, schedule}
```

Source: `ai-docs/src/06_schedule/10_schedules.ts` (`min`, `exponential`, `spaced`, `jittered`, `recurs`, `while`,
`setInputType`, `tap`), `Effect.ts` (`repeat`, `retry`, `Repeat.Options`), `Schedule.ts` (`fixed`: "aligned to a
regular cadence", `spaced`: "delay starts after the previous action completes"; `cron`, `upTo`, `during`).

## 3. Composing, encoding and decoding, providing

- **Schema is the decode path for wire and DB values.** `Schema.DateTimeUtcFromMillis` decodes an `Int` of epoch
  ms to `DateTime.Utc` and encodes back with `DateTime.toEpochMillis`; `Schema.DateTimeUtcFromString` (ISO string),
  `Schema.DateTimeUtcFromDate`, `Schema.DateTimeUtc` (default JSON codec: UTC ISO string) and `Schema.DateTimeZoned`
  exist. Source: `Schema.ts` (the `DateTimeUtc*` block, around line 11545).
- **Provide time zones as a layer**, `DateTime.layerCurrentZoneNamed(id)` (fails with `IllegalArgumentError` on a
  bad id), `layerCurrentZone`, `layerCurrentZoneOffset`, `layerCurrentZoneLocal`.
- **Provide a clock in a test**: `Effect.provide(TestClock.layer())` (it also replaces the `Scheduler`).
- **Schedules compose**: `Schedule.max([a, b])` continues while all continue and takes the slowest delay,
  `Schedule.min([a, b])` continues while any continues and takes the fastest, `Schedule.concat`, `Schedule.upTo`,
  `Schedule.while(({ input }) => ...)`, `Schedule.tap`, `Schedule.map`, `Schedule.addDelay`. Both take ARRAYS.
  Source: `ai-docs/src/06_schedule/10_schedules.ts`, `Schedule.ts`.
- **`Duration.Input`** is what every delay accepts: a `Duration`, millis as a number, or a string like
  `"250 millis"`, `"6 hours"`. Convert out with `Duration.toMillis`. Source: `Duration.ts` (`Input`, `toMillis`).

```ts
// A TestClock test (bun:test): fork the sleeper, advance virtual time, join.
test("the tick fires after 6 hours", async () => {
  const program = Effect.gen(function*() {
    const fiber = yield* Effect.forkChild(Effect.sleep("6 hours").pipe(Effect.as("fired" as const)))
    yield* TestClock.adjust("6 hours")
    const at = yield* Clock.currentTimeMillis        // 21_600_000: the clock starts at epoch 0
    return [yield* Fiber.join(fiber), at] as const
  }).pipe(Effect.provide(TestClock.layer()))
  expect(await Effect.runPromise(program)).toEqual(["fired", 21_600_000])
})
```

Source: `ai-docs/src/09_testing/10_effect-tests.ts` (adapted to `bun:test`), `testing/TestClock.ts` header examples
(`adjust`, `setTime(timestampMs)`, `withLive`, `testClockWith`).

## 4. Error handling

- `DateTime.make*` return `Option` (no error); `*Unsafe` constructors throw `IllegalArgumentError`
  (`Cause.IllegalArgumentError`). Treat a throw in an Effect as a defect: wrap with `Effect.try` or parse through
  a `Schema` so a bad value becomes a typed `Schema.SchemaError`.
- `Effect.timeout(duration)` adds `Cause.TimeoutError` to the error channel; recover with
  `Effect.catchTag("TimeoutError", ...)`. `Effect.timeoutOption` turns it into `Option.none`.
- `Effect.retry` re-runs only typed failures: defects and interruptions are not retried; when the schedule is
  exhausted the LAST failure propagates (the example uses `Effect.orDie` to make it fatal).
  `Effect.repeat` stops at the first failure; `Effect.repeatOrElse` / `retryOrElse` take a fallback.
- `Schedule.cron(expr, tz?)` has a `Cron.CronParseError` in its error channel (a bad expression fails the run).
- A failed periodic tick must not kill the loop: catch inside the repeated effect (`Effect.catch`, log, continue).

## 5. v3 to v4 renames that bite

| v3 | v4 |
| --- | --- |
| `DateTime.unsafeMake`, `unsafeFromDate`, `unsafeNow` | `DateTime.makeUnsafe`, `fromDateUnsafe`, `nowUnsafe` (suffix moved) |
| `unsafeMakeZoned`, `unsafeSetZoneNamed`, `zoneUnsafeMakeNamed` | `makeZonedUnsafe`, `setZoneNamedUnsafe`, `zoneMakeNamedUnsafe` |
| `unsafeIsPast`, `unsafeIsFuture` | `isPastUnsafe`, `isFutureUnsafe` |
| `epochMillis`, `adjustedEpochMillis` fields | `epochMilliseconds`, `adjustedEpochMilliseconds` |
| `Parts` `millis`, `seconds`, `minutes`, `hours` | `millisecond`, `second`, `minute`, `hour`; `PartsForMath.millis` is `milliseconds` |
| unit `"milli"` / `"millis"` | `"millisecond"` / `"milliseconds"` |
| `DateTime.greaterThan`, `lessThan` (and `...OrEqualTo`) | `isGreaterThan`, `isLessThan`, `isGreaterThanOrEqualTo`, `isLessThanOrEqualTo` |
| `DateTime.distance` returns signed ms | returns a signed `Duration` (`Duration.toMillis(DateTime.distance(a, b))`) |
| `DateTime.distanceDuration` | `Duration.abs(DateTime.distance(a, b))` |
| `Clock.unsafeCurrentTimeMillis` / `Nanos` | `currentTimeMillisUnsafe` / `currentTimeNanosUnsafe` |
| `Clock.make`, `ClockScheduler`, `CancelToken` | removed: provide `Layer.succeed(Clock.Clock, clock)`; use `Effect.sleep` |
| `effect/TestClock`, `TestContext` | `effect/testing` (`TestClock.layer()`); `TestContext` is `Layer.mergeAll(TestConsole.layer, TestClock.layer())` |
| `Schedule.andThen`, `check`, `as`, `addDelayEffect` | `Schedule.concat`, `Schedule.while`, `Schedule.map`, `Schedule.addDelay` |
| `Schedule.collectAllOutputs`, `collectUntil`, `bothInOut` | removed: rebuild with `Schedule.fromStep` / `toStep` |
| `ScheduleDriver` | `Schedule.toStepWithSleep` (raw delays: `toStep`) |
| `Schedule.CurrentIterationMetadata`, `recurrence` | `Schedule.CurrentMetadata`, `attempt` |
| `Effect.fork`, `forkDaemon` | `Effect.forkChild`, `forkDetach` (also `forkScoped`, `forkIn`) |

Source: `migration/v3-to-v4.md` sections `effect/Clock`, `effect/DateTime`, `effect/Schedule`, `effect/ScheduleDecision`.

## 6. Pitfalls

- **`DateTime.nowUnsafe`, `isPastUnsafe`, `isFutureUnsafe` read `Date.now()` directly** (`DateTime.ts`: "synchronous
  version of `now` that directly uses `Date.now()`"). `TestClock` does not move them. In a service use
  `DateTime.now`, `DateTime.isPast`, `DateTime.isFuture` (the Effect forms, Clock-based) or `Clock.currentTimeMillis`.
- **`TestClock` time starts at epoch 0 and `sleep` blocks until you advance.** Fork the effect, then
  `TestClock.adjust`, then join. An effect that sleeps, run without `adjust`, hangs (the clock prints a warning).
  Ordered wake-ups need fibers under `TestClock.layer()`, not a hand-built clock from `TestClock.make`.
  A row stamped with `Date.now()` ignores the test clock: pass the instant in or read it from `Clock`.
- **Test the time-based pieces with a pinned instant**: `TestClock.setTime(Date.UTC(2026, 9, 1))` then run the code;
  that replaces the setter seam `setClockForTest` of `apps/api/src/modules/finance/lib/clock.ts`.
- **`Effect.retry` and `Effect.repeat` always run the effect once first.** `Schedule.recurs(3)` is 3 retries, 4
  attempts. `Effect.repeat(Schedule.spaced(d))` waits `d` between a finish and the next start; `Schedule.fixed(d)`
  keeps a cadence and skips (does not replay) missed intervals.
- **`Effect.schedule(effect, schedule)` waits for the schedule's first delay before the first run**; `Effect.repeat`
  runs first. Use `repeat` for "now, then every 6 hours".
- **A retry schedule needs its input type** to inspect the error: `Schedule.setInputType<MyError>()` before
  `Schedule.while(({ input }) => input.retryable)`, or use the builder form `Effect.retry(($) => $(schedule).pipe(...))`.
- **`Schedule.jittered` multiplies each delay by 0.8 to 1.2**, so a test of exact delays leaves it off.
- **`DateTime.toDate` of a `Zoned` stores the wall clock in the Date's UTC fields**, not the instant: use `toDateUtc`
  or `toEpochMillis` for the instant.
- **Month is 1-12 in `Parts`**, unlike `Date#getMonth`. `DateTime.make` of a zone-less string means UTC, not local.
- **Never write a `DateTime` into a row.** Rows hold integer unix ms (`toEpochMillis`), the wire holds ISO
  (`formatIso`); `planned_on` and finance periods stay text (D-rules of the SPEC): they are not instants.
- The vendored examples import `@effect/platform-node`; here run with `Effect.runPromise` or the `ManagedRuntime`.

## 7. In this repo

- `apps/api/src/core/health.ts` already reads `time` through `DateTime.now` and `DateTime.formatIso` (the pattern).
- E2 (`Clock` where the core reads time): `apps/api/src/core/services/auth/{sessions,tokens,passwordReset,
  emailVerification,invites,rateLimit}.ts`, `households/{modules,support,mappers}.ts`, `media/thumbnails.ts`:
  replace `Date.now()` / `new Date()` with `Clock.currentTimeMillis` / `DateTime.now`; the idioms rule "no `Date.now()`
  / `new Date()` in `apps/api/src/**/services/**`" (`apps/api/test/effect-idioms.test.ts`) switches on with a
  pinned allow list for rows that stamp a DB default.
- E3 / E4: `apps/api/src/modules/recipe/services/plan/plan.service.ts`, `import/*`, and finance
  `apps/api/src/modules/finance/lib/clock.ts` (the `nowMs` / `setClockForTest` seam becomes `Clock`),
  `finance/services/**` (the plan catch-up; the 6-hour tick is `Effect.schedule(tick, Schedule.spaced("6 hours"))` on a
  `Effect.forkDetach` fiber, NOT `Effect.repeat` (that would run once at once, before the first interval), tested with
  `TestClock`: `apps/api/test/finance-scheduler.test.ts`, finance gotcha "The `start` hook and the clock").
- E5: `apps/api/scripts/{uploads-gc,seed,reset-password,migrate-legacy}.ts`, `scripts/legacy/{ledger,claims}.ts`.
- Pure code stays pure: `packages/shared/src/core/calendar.ts`, `modules/finance/period.ts` and
  `apps/api/scripts/finance-import/dates.ts` keep their `Date`-free or injected-clock arithmetic (money and period
  math is not wrapped in Effect, E3).
- Rule served: E12, "`DateTime` / `Clock` instead of `Date` in services", together with E9 (`TestClock` from
  `effect/testing` where a test fakes time today, under plain `bun test`).

**As built (E2, E2-T04):** the five infrastructure services read time from the `Clock`; no `Date.now()` / `new Date(`
is left in `mail/index.ts`, `mail/smtp.ts`, `auth/rateLimit.ts`, `auth/verifiedEmail.ts`, `media/uploads.ts` and
`media/thumbnails.ts` (the grep of the task's verify command).
- **`Clock.currentTimeMillis` inside an `Effect.fnUntraced`, store at module level.** `auth/rateLimit.ts` `checkIn(key,
  rule)` reads the Clock once per call and keeps the one module-level `Map` of buckets shared by the `RateLimiter`
  service and the three synchronous bridges. A bridge runs the SAME service-free effect with `Effect.runSync` (the default
  Clock, no service), a service method runs it on the runtime, and a test runs it under `TestClock.layer()`
  (`runTest(effect, { clock: "test" })`, `TestClock.adjust("61 seconds")`). The failure of `enforceIn` is the tagged
  `RateLimited`; `Effect.runSync` THROWS it (the squashed cause: the error itself), which is why `enforceRateLimit` stays
  a synchronous `: string` (recipe's `imports.ts` calls it as an unawaited statement).
- **A failure cache on the Clock.** `media/thumbnails.ts` records `failedAt.set(path, yield* Clock.currentTimeMillis)` and
  compares `(yield* Clock.currentTimeMillis) - failure < FAILURE_TTL_MS`; `apps/api/test/thumbnails.test.ts` runs the
  ten minutes out with `TestClock.adjust("11 minutes")` inside ONE `runTest(..., { clock: "test" })` (a new `TestClock`
  per run, so fork-adjust-read has to be one effect). Real I/O (sharp, the disk) is unaffected by the `TestClock`.
- **A `Date` for an API that wants one.** `DateTime.nowAsDate` (`DateTime.ts`, the `Clock`'s time as a `Date`) feeds the
  SMTP `Date:` header: the `Mailer` layer reads it per send and hands it to `SmtpMailer.send(message, now?)`. A direct
  `SmtpMailer.send(message)` without `now` falls back to `DateTime.toDateUtc(DateTime.nowUnsafe())`, which reads the
  wall clock (the pitfall of section 6, accepted for the one path no layer reaches). The pure `buildMessage` has no
  default for `now`. `apps/api/test/mail/smtp.test.ts` proves the Clock reaches the header:
  `TestClock.setTime(Date.UTC(2026, 7, 4, 9, 30))` gives `Date: Tue, 04 Aug 2026 09:30:00 +0000`.
- **Do not capture the time at layer build.** Every method reads the Clock in its body; a layer-time read would freeze
  the first instant of the process (and ignore a per-run `TestClock`).

**As built (E2, integration):** idioms rule (11) is on. `Date.now(` and `new Date(` are forbidden in any `services/` directory under
`apps/api/src` except `apps/api/src/core/services/households/support.ts` (`nowMs()`, the module helper recipe and finance still call
until E3/E4) and `apps/api/src/modules/recipe/services/` (E3); and `nowMs(` may not be CALLED anywhere under `apps/api/src/core/`
(it reads `Date.now()`, so a call bypasses the `Clock` as surely as the literal; the core uses `yield* Clock.currentTimeMillis`). Finance's
services hold no `Date.now(` today, so the stale-entry test of the rule refuses an E4 entry. `lib/` (`cookies.ts`, `http.ts`,
`uploadUrls.ts`) is outside the rule and keeps `Date`.

**In this repo (E2 example):** `apps/api/src/core/services/media/thumbnails.ts`, the failure cache reads the `Clock` in the method body, and
`apps/api/test/thumbnails.test.ts` moves it with `TestClock.adjust("11 minutes")` inside one `runTest(..., { clock: "test" })`:
```ts
failedAt.set(thumbnailPath, yield* Clock.currentTimeMillis);
// …later, on the next request:
if (failure !== undefined && (yield* Clock.currentTimeMillis) - failure < FAILURE_TTL_MS) return false;
```

**As built (E3):** every recipe service reads `Clock.currentTimeMillis` inside the method body (a draft's `createdAt`, the commit time, the shopping
timestamps, the cook-log undo window, the duration of a URL import):

```ts
const startedAt = yield* Clock.currentTimeMillis;
const fetched = yield* http.fetchHtml(rawUrl, { timeoutMs: options.timeoutMs, maxBytes: options.maxBytes, maxRedirects: options.maxRedirects });
// …
const sourceMeta: ImportSourceMeta = { method: extraction.method, host: extraction.host.slice(0, 200), durationMs: (yield* Clock.currentTimeMillis) - startedAt };
```

Idioms rule (11) now covers the recipe module twice: no `Date.now(` / `new Date(` under any `services/` directory (the recipe prefix left the allow list in E3-T07)
and no `nowMs(` call under `apps/api/src/core/` or `apps/api/src/modules/recipe/` (widened in E3-T13). `Date.now()` stays where rule (11) does not look:
`apps/api/src/modules/recipe/seed.ts`, the column defaults of `schema.ts` and `parseSinceQuery` in `routes/shopping.ts`.

**As built (E4-T06):** `apps/api/src/modules/finance/services/plan/scheduler.ts` runs the boot catch-up awaited, then
`tickFiber = yield* Effect.forkDetach(Effect.schedule(tick, Schedule.spaced("6 hours")))` (`Effect.schedule` steps the
schedule before the first run, so the first interval run is six hours after the start, as `setInterval` was; a tick
that failed is recovered inside `tick` so the schedule goes on) and `stopAccrualSchedule` is `Fiber.interrupt(tickFiber)`.
The catch-all of the booking transaction in `accrual.service.ts` is `Effect.catchCause` + `Cause.hasInterruptsOnly`
(an interruption is passed on without a log line or an audit row) + `Cause.squash` (the original error, a
`DatabaseError` unwrapped to its `cause`) + `Effect.failCause(cause)`. The test `apps/api/test/finance-scheduler.test.ts`
sets the instant with `TestClock.setTime(Date.UTC(2026, 9, 31, 20, 0))`, moves it with `TestClock.adjust("5 hours")` and
`TestClock.adjust("1 hour")`, and starts and stops the scheduler inside one `runTest(..., { clock: "test" })`.

**As built (E4):** the finance module clock (`apps/api/src/modules/finance/lib/clock.ts`) is an Effect that the services read INSIDE the
method body on every call, so a `TestClock` reaches every row stamp, the catch-up and the scheduler; the `setClockForTest` override, kept
because the pinned plan tests pin "now" through it, wins over the `Clock`:

```ts
export const financeTimeMillis: Effect.Effect<number> = Effect.suspend(() =>
  override === null ? Clock.currentTimeMillis : Effect.succeed(override),
);
```

The synchronous `nowMs()` survives for `apps/api/test/support/finance-harness.ts` only; idioms rule (11) fails any other call under the core,
recipe or finance, and the core `nowMs()` of `households/support.ts` is deleted. The fixed-cost period is still computed from the integer
millis (`currentPeriod(timestamp)` of `@toon/shared`, pure). The plan's wrong line about the 6-hour tick is fixed in section 2.5 (E4-T06):
`Effect.schedule` waits first, `Effect.repeat` runs at once.
