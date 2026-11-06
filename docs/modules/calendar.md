# Calendar module (`calendar`) — design

Status: DESIGN (2026-11-06), to be built by milestone M8 (`docs/plans/m8-calendar-module.md`, written by the
plan stage of the build workflow). This document is the module's spec until M8 rewrites it "as built" in the
shape of `docs/modules/finance.md` (section 4a gotchas, section 5 verification). ADR 0016
(`docs/adr/0016-calendar-module.md`) records what it adds to SPEC §1, §2, §3 and §5.

The household's shared calendar: appointments for everybody or for one person, car bookings ("wer braucht das
Auto?") and chores (Müll rausstellen, Blumen gießen) with a rotating assignee, plus an import of the city's
waste collection schedule (Stadt Hattingen, by Abfuhrbezirk/Tour number 1-9).

Unlike recipe and finance it has no source repository: every German string is NEW German (ADR 0016), every
decision is H's own, and there is no "inherited gotchas" section.

## 1. What the module owns

### 1.1 Concepts

| Concept | German UI | What it is |
| --- | --- | --- |
| Entry, kind `event` | Termin | An appointment: title, all-day or timed, single or recurring, for **everybody** (no members selected) or for named household members (attendees). |
| Entry, kind `task` | Aufgabe | A chore on a day (optionally at a time), single or recurring; each OCCURRENCE can be marked done (`erledigt`) or skipped (`übersprungen`). Assignee: nobody, one fixed member, or a **rotation** over an ordered member list (occurrence n goes to rotation[n mod len]). |
| Entry, kind `car` | Autobuchung | A member needs a car (a resource) for a time range; single or recurring. Overlapping bookings of the same car are refused with `409 calendar_car_conflict` unless the request says `allowConflict: true` (the UI shows who has the car and offers "Trotzdem buchen"). |
| Resource | Auto | A household's car (`kind = "car"`, name such as "Familienauto" or "VW Golf"); archived, never hard-deleted while bookings reference it. |
| Waste schedule | Müllabfuhr | The household's provider (`hattingen`), its tour number (1-9), the assignee rule, and the imports: each import writes one `task` entry per (waste type, date) with `category = waste_*`, removable as a unit. |

Members are household members (`household_members`, placeholders included: a placeholder can have a dentist
appointment or water the flowers). A person's colour is derived deterministically from their position in the
household's member list (sorted by join time), one of six person tokens (section 4.6).

### 1.2 Tables (all `calendar_`, D7 conventions: text UUID ids, unix-ms timestamps, `YYYY-MM-DD` dates)

- `calendar_entries`: `id`, `household_id` (cascade), `kind` (`event|task|car`, CHECK), `title` (text, NULL only
  when `category` is set: a waste entry's label is rendered from the catalog, never stored, section 5.6),
  `notes`, `location`, `all_day` (bool), `start_date`, `start_time` (`HH:MM` or NULL when all-day), `end_date`,
  `end_time`, `repeat_freq` (`none|daily|weekly|monthly|yearly`), `repeat_interval` (1-99), `repeat_weekdays`
  (`MO,TU,…` for weekly, else NULL), `repeat_until` (date or NULL), `resource_id` (NULL unless `car`; RESTRICT),
  `assignee_mode` (`none|fixed|rotate`, tasks only; events and car bookings use attendees), `category` (NULL or
  `waste_rest|waste_yellow|waste_bio|waste_paper|waste_tree`), `category_detail` (NULL or `bio_cleaning`),
  `waste_import_id` (NULL or the import, cascade), `created_by` (SET NULL), `created_at`, `updated_at`.
  Indexes: `(household_id, start_date)`, `(household_id, repeat_freq)`, `(resource_id)`, `(waste_import_id)`.
- `calendar_entry_members`: `entry_id` (cascade), `user_id` (cascade), `role` (`attendee|assignee`), `position`
  (the rotation order; 0 for the rest). PK `(entry_id, user_id, role)`.
- `calendar_occurrence_states`: `entry_id` (cascade), `occurrence_date` (the occurrence's start date),
  `status` (`done|skipped`), `done_by` (SET NULL), `updated_at`. PK `(entry_id, occurrence_date)`. A row exists
  only for a marked occurrence; "reset" deletes it.
- `calendar_resources`: `id`, `household_id` (cascade), `kind` (`car`), `name`, `archived_at`, `created_at`.
- `calendar_waste_settings`: `household_id` PK (cascade), `provider` (`hattingen`), `tour` (1-9), `source_url`
  (the last URL used), `assignee_mode`, plus its members in `calendar_waste_assignees(household_id, user_id,
  position)`, `updated_at`.
- `calendar_waste_imports`: `id`, `household_id` (cascade), `provider`, `year`, `tour`, `source` (`url|upload`),
  `source_name` (URL or file name), `entry_count`, `imported_at`, `imported_by` (SET NULL). Unique
  `(household_id, provider, year)`: re-importing a year REPLACES that import (section 5.5).

Wall-clock local dates and times are stored as text (`YYYY-MM-DD`, `HH:MM`) with no time zone: a household
calendar lives in one zone, and storing local wall time makes DST a non-issue. **The server never decides
"today"**: every read takes explicit `from`/`to` dates from the client (time rule of CLAUDE.md "Effect idioms"
(11), (19) stays trivially true); only `created_at`/`updated_at`/`imported_at` come from the `Clock`.

### 1.3 Recurrence (`packages/shared/src/modules/calendar/recurrence.ts`, pure, shared by API and web)

A deliberately small RRULE subset: `freq` `daily|weekly|monthly|yearly`, `interval` n ≥ 1, `weekdays` for weekly
(default: the start date's weekday), `until` inclusive. Monthly repeats on the start date's day of month and
SKIPS months without it (31st); yearly on the same month/day (29 Feb only in leap years). A multi-day entry keeps
its duration in every occurrence. `expandOccurrences(entry, from, to)` returns `{ date, endDate, ordinal }` for
every occurrence that OVERLAPS `[from, to]`, where `ordinal` counts occurrences from the series start (the
rotation index). Caps: a range of at most 400 days and at most 2000 occurrences per entry per request (a cap
hit is a `422`, never a silent truncation). No per-occurrence move/edit ("nur diesen Termin ändern") in M8: an
edit changes the series; an occurrence can be done, skipped or reset (open work, section 7).

## 2. API (`/api/households/:householdId/calendar/…`, D8)

Every group goes through `householdModuleApi("calendar", …)` (ApiErrorBoundary → RequireSession →
RequireHouseholdMember → RequireModule); every WRITE group adds `RequireVerifiedEmail` (unconfirmed accounts are
read-only, as everywhere). Any member may write (household content, D1); there is no admin-only route. Every by-id
lookup filters by the household (D8 cross-household guard: another household's id is `404 not_found`), and every
member id in a body must be a member of THIS household (`422` with the catalog message otherwise). Route files
(`X.api.ts` + `X.ts` each, E7): `entries`, `occurrences`, `resources`, `waste`.

| Method | Path (below `…/calendar`) | Body / query | Answer |
| --- | --- | --- | --- |
| GET | `/occurrences?from=&to=[&memberId=][&kind=]` | dates inclusive, ≤ 400 days | `{ items: CalendarOccurrence[] }` sorted by date, all-day first, then time |
| GET | `/entries/:entryId` | – | `CalendarEntry` (the series, with members and resource) |
| POST | `/entries` | `CreateCalendarEntryRequest` (+ `allowConflict?`) | 201 `CalendarEntry`; 409 `calendar_car_conflict` with `details: [{ entryId, date, title, memberIds }]` |
| PATCH | `/entries/:entryId` | partial, same rules | `CalendarEntry`; a waste entry's `category`/`waste_import_id` cannot change (`409 calendar_entry_imported` for kind/date/category edits; notes and assignees may change) |
| DELETE | `/entries/:entryId` | – | 204 (the series and its states) |
| PUT | `/entries/:entryId/occurrences/:date` | `{ status: "done" \| "skipped" \| null }` | `CalendarOccurrence`; 404 when `:date` is not an occurrence of the series; `done` only on tasks (`409 calendar_not_a_task`), `skipped` on any kind |
| GET | `/resources` | `?includeArchived=` | `{ items: CalendarResource[] }` |
| POST | `/resources` | `{ name }` | 201 |
| PATCH | `/resources/:resourceId` | `{ name?, archived? }` | 200 |
| DELETE | `/resources/:resourceId` | – | 204, or `409 calendar_resource_in_use` while bookings exist (archive instead) |
| GET | `/waste?from=` | `from` = the client's today | `{ settings \| null, imports: [...], next: [{ category, date, detail }] }` (the next pickup per type on or after `from`) |
| PUT | `/waste/settings` | `{ provider, tour, assigneeMode, assigneeIds }` | settings; re-assigns the members of the FUTURE entries of every import of the household (dates ≥ the body's `today`) |
| POST | `/waste/preview` | multipart `file` (PDF ≤ 10 MiB) OR JSON `{ url }`; plus `tour` | `WastePreview`: `{ provider, year, tour, counts: { waste_rest: n, … }, dates: [{ category, date, detail }], warnings: [] }`; nothing written |
| POST | `/waste/import` | same as preview | 201 `{ import, entryCount }`; replaces an existing import of that year (section 5.5) |
| DELETE | `/waste/imports/:importId` | – | 204, its entries go with it |

`CalendarOccurrence` = `{ id: "<entryId>:<date>", entryId, kind, title | null, category | null, categoryDetail |
null, date, endDate, allDay, startTime | null, endTime | null, location | null, recurring, memberIds (attendees),
assigneeId | null (fixed, or the rotation's pick for this ordinal), resourceId | null, status: "open" | "done" |
"skipped", doneBy | null }`.

New error codes (added to `ERROR_CODES`, a row each in `docs/API.md` "Error codes", server catalog messages in
`server.calendar.*`): `calendar_car_conflict` (409), `calendar_resource_in_use` (409), `calendar_entry_imported`
(409), `calendar_not_a_task` (409), `calendar_range_too_large` (422 path `to`), `calendar_waste_source_refused`
(400: URL not https or host not the provider's), `calendar_waste_fetch_failed` (502: the city's server failed or
timed out), `calendar_waste_unparseable` (422: the PDF is not a Hattingen flyer this parser understands; `details`
name the failed check, section 5.3).

Hooks (`apps/api/src/modules/calendar/index.ts`, an `ApiModule<CalendarServices>` with `layer:
Layer.suspend(calendarLayer)`): `onMemberRemoving` removes the leaving user from attendees, assignees, rotations
and the waste assignees (no veto; a placeholder's appointments must not block a removal); `seedDemo` (section
6); `onHouseholdCreated`/`onEnable` none (the module needs no setup; `DEFAULT_ENABLED_MODULES` stays `["recipe"]`,
the owner enables Kalender on Home). No `start`/`shutdown`, no `uploadReferences`.

## 3. Shared package (`packages/shared/src/modules/calendar/`)

`recurrence.ts` (section 1.3), `waste.ts` (the provider registry `WASTE_PROVIDERS = { hattingen: { name: "Stadt
Hattingen", tours: 1..9, hosts: ["www.hattingen.de", "hattingen.de"], defaultUrl:
"https://www.hattingen.de/stadt_hattingen/Rathaus/Fachbereiche/Stadtbetriebe/Abfallentsorgung/AbfallFlyer%202027.pdf"
} }`, the category list in display order `waste_rest, waste_yellow, waste_bio, waste_paper, waste_tree`), and
`schemas/{entries,occurrences,resources,waste}.ts` built from the core vocabulary
(`packages/shared/src/core/schemas/checks.ts`, decoded with `ALL_ISSUES`, `Types.DeepMutable` types; ADR 0013).
Re-exported FLAT from `packages/shared/src/index.ts` with a `Calendar` prefix on every name that could collide
(`CalendarEntrySchema`, `CalendarResourceSchema`, …). `MODULE_IDS` becomes `["recipe", "finance", "calendar"]`.

## 4. Web (`apps/web/src/modules/calendar/`)

Manifest `index.ts` (literal-typed, `satisfies WebModule<"calendar">`), `routes.tsx` (lazy screens), `HomeCard.tsx`,
`catalogs/` (`calendar.*`), `lib/{api,queries,format}.ts` (`CalendarApi` over the one web runtime, E6: each endpoint
names its response schema; READ rows in the web contract test), `features/{agenda,month,tasks,entries,cars,waste}/`,
`components/` (`CalendarPageHeader` with `PhoneHeaderRow`, `OccurrenceRow`, `PersonDot`, `WasteDot`, `DayHeading`).
Icon `CalendarDays`; name "Kalender".

### 4.1 Navigation (D6)

Tabs: **Übersicht** `/calendar` · **Monat** `/calendar/month` · **Aufgaben** `/calendar/tasks` · Profil (shared).
Sidebar-only: **Autos** `/calendar/cars`, **Müllabfuhr** `/calendar/waste`. Reachability: the car card on
Übersicht links to Autos (and the booking form's car picker has "Autos verwalten"); the Müllabfuhr card on
Aufgaben links to Müllabfuhr. Creating is the ONE header action of every tab screen (`+`, "Neu"), opening
`/calendar/new` with the current day preselected. Outside a module the phone tab bar shows up to THREE enabled
modules (`MAX_MODULE_TABS` 2 → 3, ADR 0016): Start · Rezepte · Finanzen · Kalender · Profil.

Routes: `/calendar`, `/calendar/month?month=YYYY-MM&day=YYYY-MM-DD`, `/calendar/tasks`, `/calendar/new?kind=&date=`,
`/calendar/entries/$entryId?date=` (an occurrence's detail; `date` selects the occurrence), `/calendar/entries/$entryId/edit`,
`/calendar/cars`, `/calendar/waste`.

### 4.2 Übersicht (`/calendar`)

Phone (390), top to bottom:

```
┌──────────────────────────────────────┐
│ (F) Familie ▾            ▣ Kalender ▾│  PhoneHeaderRow, action: +
├──────────────────────────────────────┤
│ HEUTE · MITTWOCH, 11. NOVEMBER       │  eyebrow
│ ┌──────────────────────────────────┐ │  Today card (Card, elevation-card)
│ │ 08:00  ● Zahnarzt          Robin │ │  person dot + name
│ │ ganzt. □ Blumen gießen  Eric ↻   │ │  task checkbox, rotation mark
│ │ ─────────────────────────────── │ │
│ │ Heute Abend rausstellen:         │ │  only when tomorrow has pickups
│ │  ● Restmüll  ● Gelber Sack       │ │  waste dots (grey, yellow)
│ │ ─────────────────────────────── │ │
│ │ 🚗 Familienauto · Robin 08–17 Uhr│ │  car status today ("frei" if none)
│ └──────────────────────────────────┘ │
│ [Alle] [Eric] [Robin] [Kim]          │  member filter chips (Chip)
│ MORGEN · DO 12.11.                   │  DayHeading per day, next 14 days
│  ● Restmüll · Gelber Sack  ✓ Kim     │  waste occurrences merge into ONE row per day
│  18:30 ● Elternabend    Alle         │
│ FR 13.11.                            │
│  □ Blumen gießen          Robin ↻    │
│  …                                   │
│ (empty days are skipped; "Nichts geplant" if the 14 days are empty)
└──────────────────────────────────────┘
```

Desktop (`lg`, 1204 content): two columns: agenda (left, 2/3) and a right rail with the Today card, the car card
("Autos": each car with its next/current booking, link Autos verwalten) and the next pickups card. Overdue task
occurrences (open, date before today, at most 7 days back) are listed first under "Überfällig" with the danger-soft
tone. Tapping a row opens the occurrence detail; the checkbox toggles `done` in place (optimistic, rolled back on
error; online only, section 4.7).

### 4.3 Monat (`/calendar/month`)

Phone: month title with ‹ › and "Heute", a 7-column grid (Mo-So, ISO weeks) with the day number and up to three
dots (person colour, waste colour, car = `--fg-muted`), today ringed with `--brand`, the selected day filled
`--brand-soft`; below the grid the selected day's occurrence list (same `OccurrenceRow`). Desktop: the full grid,
each cell lists up to three chips (time + title, colour bar on the left) and "+N weitere", which selects the day
and opens its list in a side panel. Weekends use `--bg-sunken`.

### 4.4 Aufgaben (`/calendar/tasks`)

Sections: **Offen** (overdue, today, the next 7 days; task occurrences with checkbox, assignee and the rotation's
next person), **Wiederkehrend** (each task series: rhythm in words "alle 3 Tage", "jeden Mo, Do", the rotation
order as avatars with the next one marked), **Müllabfuhr** (the next pickup per waste type with its dot and date,
the tour, "Einrichten" / "Ändern" → `/calendar/waste`; when nothing is configured a short explainer and the
button).

### 4.5 Neu / Bearbeiten (`/calendar/new`, `/calendar/entries/$entryId/edit`)

A segmented control **Termin · Aufgabe · Auto** (kind; fixed on edit), then: Titel; Ganztägig (switch); Datum
and Uhrzeit von/bis (an all-day task needs only the date); **Wiederholen**: Nie · Täglich · Wöchentlich (weekday
chips) · Monatlich · Jährlich, "alle [n]", "bis [Datum]" (optional), with a live preview line "Nächste: Fr 13.11.,
Mo 16.11., Do 19.11." from the shared `expandOccurrences`; **Wer**: Termin = member chips (none selected = "Alle");
Aufgabe = Niemand · Person · Abwechselnd (choose and order members); Auto = the car (Select) and the person who
needs it (one member), a conflict answer shows "Robin hat das Familienauto am Do 12.11., 08:00–17:00" with
"Trotzdem buchen"; Ort; Notiz. Leaving with unsaved input asks (`useNavigationGuard`).

### 4.6 Design (D5)

Inside toon-recipe's system: the `components/ui` primitives only (Card, Chip, Tabs as the segmented control,
Switch, Select, Input, Textarea, Dialog, ActionMenu, EmptyState, Skeleton), Newsreader for page titles and the
Today card's date, `.eyebrow` for day headings, the 1204 content width and 236 sidebar. New tokens, defined in all
four `theme.css` blocks (the design-system test's 39 becomes 50, ADR 0016):

- waste: `--waste-rest` (grey), `--waste-yellow` (yellow), `--waste-bio` (brown), `--waste-paper` (blue),
  `--waste-tree` (green): the flyer's colours, so the dots read like the paper calendar on the fridge; dark
  variants keep the hue at lower lightness, each with ≥ 3:1 against `--surface`;
- people: `--person-1` … `--person-6`, six tones harmonised with brand/accent/herb (light and dark).

A dot is 8 px, a colour bar 3 px; colour is never the only signal (the name or waste label is always written).

### 4.7 Home card, offline, service worker

Home card "Kalender": HEUTE and MORGEN with at most four rows together (time, title, person), the "Heute Abend
rausstellen" line when tomorrow has pickups, and two buttons Kalender / + Neu. Content (titles, names) is never
`t()` and never truncated in a way that hides the person.

Offline (D9): reads persist (`persistQueryAllowList`: `["calendar","occurrences"]`, `["calendar","entry"]`,
`["calendar","resources"]`, `["calendar","waste"]`); writes are ONLINE ONLY in M8 (no outbox; an offline toggle
shows the offline toast and changes nothing). The service worker gets a `NetworkOnly` rule for
`/api/households/<id>/calendar/…` before the one `NetworkFirst` rule (ADR 0011 order; the persisted TanStack
cache is the offline copy). Query keys `["toon","household",id,"calendar","occurrences",from,to,filters]`,
`["toon","household",id,"calendar","entry",entryId]`, `…,"resources"`, `…,"waste"`; a write invalidates
`["toon","household",id,"calendar"]`.

## 5. Waste import (Stadt Hattingen flyer)

### 5.1 The source

`https://www.hattingen.de/stadt_hattingen/Rathaus/Fachbereiche/Stadtbetriebe/Abfallentsorgung/AbfallFlyer%202027.pdf`
(2 pages, 2483 x 595 pt, RC4-encrypted with an empty user password, copy flag off: pdf.js reads it). Page 1: the
street directory "Straßenverzeichnis von A - Z mit Bezirken (1-9)" (`Waldweg……3`) and adverts. Page 2: the
"Umweltbrummi" dates and the four quarter grids "Abfallkalender / 1. Januar - 31. März 2027" … "1. Oktober - 31.
Dezember 2027", three months each. A month column: header row `R G B P` (January also `T`; March, June, July,
October and some others also a drop icon column, the Biotonnenreinigung), then one row per day: `01 Fr Neujahr`,
`04 Mo 9 9 4 4 4`: the day, the German weekday abbreviation, then in each type column the TOUR NUMBER (1-9) that
is collected that day. R = Restmülltonne, G = Gelber Wertstoffsack, B = Biotonne, P = Papiertonne, T =
Tannenbäume. Holidays carry their name and no numbers. The footer lines give the Biotonnen cleaning ranges:
"Reinigungstermine der Biotonnen: 08.03.-19.03.2027 | 28.06.-09.07.2027" and "… 18.10.-29.10.2027". The user
configures the tour ("Bezirk") of their street, as printed in the directory; the import keeps only that tour's
dates.

### 5.2 Extraction (`unpdf`, already a dependency of `apps/api`; pure JS, so it works in the published image
without poppler, `WITH_PDF=0`)

`getDocumentProxy(bytes, { isEvalSupported: false })`, then per page `getTextContent({ includeMarkedContent: true })`.
Each text item becomes `{ str, x: transform[4], y: transform[5], width, page, section }`, where `section` counts
the top-level marked-content blocks (`beginMarkedContentProps` … `endMarkedContent`, depth-tracked). Limits: ≤ 10
MiB, ≤ 6 pages, extraction under a 20 s timeout (an Effect `timeout`), a password-protected file (non-empty user
password) is `422 calendar_waste_unparseable`. The extractor is a `Context.Service` (`WastePdfText`) so tests can
feed recorded items; the parser is a pure function over the items.

### 5.3 Parsing (`apps/api/src/modules/calendar/services/waste/hattingen.ts`, pure) — THE TRAPS FOUND IN THE 2027 FLYER

The text layer is NOT what you see. The grids are InDesign "PlacedPDF" artwork, and the placed PDFs carry
**several copies of every grid**, all present in the text layer, only one visible:

1. Copies at the same y but shifted in x by a constant (14.4 pt for January-June: the visible January grid has
   `R` at x 477.6 and day `01` at 438.1; a hidden copy has `R` at 492.0 and `01` at 452.5). A copy's digits
   therefore fall INTO the neighbouring column of the other copy (copy B's R digit at 493.3 sits 1.2 pt from copy
   A's G digit at 492.1), and their rows differ in y by only 0.1-0.2 pt. **Geometry alone cannot separate them.**
2. July-December exists FOUR times: two sections titled "Abfallkalender 2026" (at the same position as one
   another) and two titled "Abfallkalender 2027" (x 1315.9 and 1338.0). Stale artwork of the previous year may sit
   underneath the visible grid.
3. Each copy is its own marked-content section (`PlacedPDF`), and the items of one section are geometrically
   consistent. **So: parse per section, never across sections.**

The algorithm:

- Year: the quarter titles `1. <Monat> - <d>. <Monat> <YYYY>` (all four must agree; "Abfallkalender 2026" is
  ignored).
- Per section, per month-name item (`Januar` … `Dezember`): the header items `R G B P [T]` just below it (same y
  within 3 pt, x from the month name -25 to +70) define the columns; the day items (`01`…`31`) and the weekday
  items (`Mo Di Mi Do Fr Sa So`) to the left define the rows. **Validate the block against the calendar**: every
  day of the month present once, and every row's weekday equal to the real weekday of that date in the year
  from the titles. A block that fails (e.g. a stale 2026 copy, whose weekdays are a day off) is DISCARDED.
- Within a valid block, a digit belongs to a row when its y is within the row's band (row pitch ≈ 13.6 pt; use
  half the pitch measured from the block's own day items, not a fixed tolerance) and to a column when its x lies
  within that column's own cell (from the column's header x to the next header x of the SAME block). Digits of
  other sections are never considered.
- Consensus: every date must be produced by at least one valid block, and all valid blocks producing the same
  date must agree on every column; disagreement is `422 calendar_waste_unparseable` (`details`: the date and the
  two readings). A missing month is the same refusal.
- Sanity (the refusal names the check): each tour 1-9 occurs in R at least 20 times in the year, no type column
  has a value outside 1-9, Sundays and the holidays carry nothing.
- Cleaning: the footer ranges `dd.mm.-dd.mm.YYYY`; a B pickup inside a range gets `category_detail =
  "bio_cleaning"` ("Biotonne + Reinigung").

The prototype on the 2027 flyer (the scratch spike of this design session) confirmed: sections separate the
copies, the weekday check rejects misaligned blocks, and a fixed ±3 pt column tolerance is WRONG (it read Jan 15
as `R9 G3 B4` because a neighbouring copy's digit leaked in). Build the parser test-first against the fixture.

### 5.4 Golden spot checks (read off the rendered 2027 flyer at 200 dpi, verified by eye)

Tours per type; an empty type is absent. These are acceptance tests of the parser
(`apps/api/test/calendar-waste-hattingen.test.ts`, over the committed fixture
`apps/api/test/fixtures/calendar/hattingen-abfall-2027.pdf`):

| Date | R | G | B | P | T |
| --- | --- | --- | --- | --- | --- |
| 2027-01-01 (Neujahr) | – | – | – | – | – |
| 2027-01-04 Mo | 9 | 9 | 4 | 4 | 4 |
| 2027-01-05 Di | 1 | 1 | 5 | 5 | 5 |
| 2027-01-08 Fr | 4 | 4 | 8 | 8 | 8 |
| 2027-01-11 Mo | 5 | 5 | 9 | 9 | 9 |
| 2027-01-12 Di | 6 | 6 | 1 | – | 1 |
| 2027-01-15 Fr | 9 | 9 | 4 | – | – |
| 2027-01-22 Fr | – | – | 9 | – | – |
| 2027-01-25 Mo | 5 | 5 | 1 | 1 | – |
| 2027-02-01 Mo | 1 | 1 | 5 | 5 | – |
| 2027-02-05 Fr | – | – | 9 | 9 | – |
| 2027-02-26 Fr | 9 | 9 | – | – | – |
| 2027-03-19 Fr | 5 | 5 | 9 (cleaning) | – | – |
| 2027-03-26 (Karfreitag) | – | – | – | – | – |
| 2027-03-31 Mi | 2 | 2 | 6 | 6 | – |
| 2027-04-05 Mo | 5 | 5 | 9 | 9 | – |
| 2027-05-01 Sa | – | – | – | – | – |
| 2027-06-14 Mo | 5 | 5 | 1 | 1 | – |
| 2027-07-01 Do | 8 | 8 | 4 (cleaning) | – | – |
| 2027-07-02 Fr | 9 | 9 | – | – | – |
| 2027-07-12 Mo | 5 | 5 | 1 | 1 | – |
| 2027-08-20 Fr | – | – | 9 | 9 | – |
| 2027-08-31 Di | 2 | 2 | 6 | – | – |
| 2027-10-18 Mo | 5 | 5 | 1 (cleaning) | – | – |
| 2027-11-01 (Allerheiligen) | – | – | – | – | – |
| 2027-11-02 Di | 6 | 6 | 1 | 1 | – |
| 2027-11-12 Fr | – | – | 9 | 9 | – |
| 2027-12-17 Fr | 9 | 9 | 5 | – | – |
| 2027-12-20 Mo | 1 | 1 | 6 | – | – |
| 2027-12-23 Do | 4 | 4 | 9 | – | – |
| 2027-12-24, -25, -26, -31 | – | – | – | – | – |
| 2027-12-27 Mo | 5 | 5 | 1 | 1 | – |
| 2027-12-30 Do | 8 | 8 | 4 | 4 | – |

Plus whole-year properties: 365 dates covered, tour 4 has R on every 2nd week (count it and pin the number the
parser produces once the spot checks pass), and the parse is deterministic (same input, same output).

### 5.5 Import semantics

Preview and import parse the same way; the preview writes nothing. Import, in ONE `Database.transaction`: upsert
the settings (provider, tour, `source_url`), delete the household's import of that `(provider, year)` with its
entries, then insert the new import and one entry per (category, date) for the tour (`kind task`, all-day,
`title NULL`, `assignee_mode` and members from the settings, `waste_import_id`), and carry the occurrence states
of the replaced entries over by `(category, date)` (a re-import keeps the "rausgestellt" ticks). URL source: only
`https`, host in the provider's `hosts`, every redirect hop re-checked against the same list, ≤ 10 MiB
(Content-Length and the streamed count), 20 s timeout, through the `HttpClient` of `effect/http` (no
`traceparent`), never `IMPORT_ALLOW_PRIVATE_HOSTS`. The test seam is a `Context.Service` for the fetch
(`WasteFlyerFetch`) whose test layer serves the fixture; no test reaches the network.

### 5.6 Rendering a waste entry

Label from the catalog by category (`calendar.waste.type.waste_rest` = "Restmüll", `…yellow` = "Gelber Sack",
`…bio` = "Biotonne", `…paper` = "Papiertonne", `…tree` = "Tannenbaum"), "+ Reinigung" for `bio_cleaning`. Several
pickups on one day render as ONE agenda row ("Restmüll · Gelber Sack") with their dots. The evening before a
pickup the Today card and the Home card show "Heute Abend rausstellen: …" (client side: tomorrow's pickups).

## 6. Seed (`bun run seed`, idempotent)

Demo household "Familie": a car "Familienauto" with Robin's weekly booking (Do 08:00-17:00); events "Elternabend"
(everybody, next Tuesday 19:30), "Zahnarzt" (Robin), "Kim: Fußballtraining" (weekly Mi 17:00); a task "Blumen
gießen" every 3 days rotating Demo → Robin → Kim; a task "Bad putzen" weekly Sa fixed Kim; a SYNTHETIC waste
schedule (`provider hattingen`, tour 4, the current and next 8 weeks: Restmüll and Gelber Sack fortnightly, Biotonne
weekly, Papier every 4 weeks), never data copied from the flyer. Dates are relative to the seed run's Clock date.

## 7. Out of scope for M8 (to `docs/open-work.md`)

Per-occurrence edits ("nur diesen Termin"), reminders/notifications (Web Push or e-mail), an ICS subscription
feed (the cheapest route to phone reminders: a secret-token `GET /api/calendar/feed/<token>.ics`), offline writes
(an outbox like finance's), other cities' waste providers, a street search over the flyer's directory (page 1:
street → tour), ICS import, calendar sharing outside the household.
