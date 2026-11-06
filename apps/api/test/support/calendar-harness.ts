/**
 * The calendar test harness (plan m8 M8-T02 step 5): households built through the REAL core routes on the shared
 * process `db` (ADR 0009; the routes read it), with the calendar module enabled the way the owner does it on Home
 * (`POST /api/households/:householdId/modules/calendar`, no settings: the module needs none).
 *
 * The user, request and membership helpers are the finance harness's (`./finance-harness.ts`): a verified user with a
 * session cookie, the in-memory `app.request()` wrapper, an invited member and a placeholder. None of them touches a
 * finance table.
 */
import { type TestUser, body, call, createPlainHousehold } from "./finance-harness.ts";

export { addMember, addPlaceholder, body, call, createPlainHousehold, createUser } from "./finance-harness.ts";
export type { CallOptions, TestUser } from "./finance-harness.ts";

/** `/api/households/<householdId>/calendar<rest>` (`rest` starts with `/`, or is empty for the bare prefix). */
export function calendarPath(householdId: string, rest = ""): string {
  return `/api/households/${householdId}/calendar${rest}`;
}

/** Enables the calendar on an existing household (owner or admin); throws with the answer on anything but 200. */
export async function enableCalendar(owner: TestUser, householdId: string): Promise<void> {
  const response = await call(`/api/households/${householdId}/modules/calendar`, { method: "POST", cookie: owner.cookie });
  if (response.status !== 200) throw new Error(`enableCalendar failed: ${response.status} ${await response.text()}`);
  const payload = await body<{ household: { modules: string[] } }>(response);
  if (!payload.household.modules.includes("calendar")) throw new Error("enableCalendar: calendar is not enabled");
}

/** A plain household owned by `owner` with the calendar enabled (recipe stays on by default); returns its id. */
export async function createCalendarHousehold(owner: TestUser, name: string): Promise<string> {
  const householdId = await createPlainHousehold(owner, name);
  await enableCalendar(owner, householdId);
  return householdId;
}
