/**
 * Form validation glue: run the SAME Zod schemas the API uses (from @toon/shared)
 * in the browser and turn failures into `{ field: "message" }` maps that the
 * `<Input error>` prop understands.
 */
import { resolveWireKey, resolveZodIssue } from "@toon/shared";
import type { z } from "zod";
import type { $ZodIssue } from "zod/v4/core";
import { isApiError } from "./api";
import { getLocale, translate } from "./i18n/store.ts";

/** `{ email: "Bitte eine gültige E-Mail-Adresse angeben" }` */
export type FieldErrors = Record<string, string>;

/**
 * First message per field path, joined with "." for nested paths. Resolves
 * through the SAME `resolveZodIssue` the server uses (§5), so a field that
 * fails client-side and again server-side reads identically.
 */
export function zodFieldErrors(error: z.ZodError): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.map((part) => String(part)).join(".") : "_form";
    if (!(key in errors)) errors[key] = resolveZodIssue(issue as $ZodIssue, getLocale()).message;
  }
  return errors;
}

export type ValidationResult<T> =
  | { ok: true; data: T; errors: null }
  | { ok: false; data: null; errors: FieldErrors };

/**
 * `const result = validate(LoginRequestSchema, values)` —
 * on success `result.data` is fully typed and normalised (e-mails are trimmed and
 * lower-cased by the shared schema).
 */
export function validate<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
): ValidationResult<z.output<Schema>> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return { ok: true, data: parsed.data, errors: null };
  return { ok: false, data: null, errors: zodFieldErrors(parsed.error) };
}

/**
 * Pulls field errors out of a 422 `ApiError` (`details` carries the server-side Zod
 * issues). Falls back to `{ _form: message }` so nothing is ever swallowed.
 *
 * NOTHING is the one input that must produce no error at all. A TanStack mutation
 * reports `error: null` while it is idle, so a form rendering
 * `apiFieldErrors(mutation.error)` on every pass would otherwise greet the user with
 * "Etwas ist schiefgelaufen / Unbekannter Fehler." on a blank form they have not
 * submitted yet — which is exactly what /recipes/new and /recipes/:id/edit did.
 */
export function apiFieldErrors(error: unknown): FieldErrors {
  if (error === null || error === undefined) return {};
  if (!isApiError(error)) {
    return { _form: error instanceof Error ? error.message : translate("common.error.unknownValue") };
  }

  const details = error.details;
  let errors: FieldErrors = {};

  if (Array.isArray(details)) {
    errors = fromIssues(details);
  } else if (typeof details === "object" && details !== null) {
    const record = details as { fieldErrors?: unknown; issues?: unknown };
    if (Array.isArray(record.issues)) {
      errors = fromIssues(record.issues);
    } else if (typeof record.fieldErrors === "object" && record.fieldErrors !== null) {
      for (const [key, value] of Object.entries(record.fieldErrors as Record<string, unknown>)) {
        const first = Array.isArray(value) ? value[0] : value;
        if (typeof first === "string") errors[key] = first;
      }
    }
  }

  if (Object.keys(errors).length === 0) errors._form = error.message;
  return errors;
}

/**
 * Server-side Zod issues (`ValidationIssue[]`, packages/shared/src/schemas/common.ts).
 *
 * `path` is a STRING on the wire (`issue.path.join(".")`) — accepting both a
 * string and an array here is deliberate: an older/local shape used an array
 * (the `title`/`servingsAmount` fixtures right below use it), and the real
 * server has only ever sent a string. Before this, every server-side 422
 * landed on `_form` because the array check always failed against a real
 * response (see docs/i18n.md §4/§14.6) — accepting the string is what makes a
 * field error land on its field instead of the form-level panel.
 *
 * `message` is used only when the client's bundle does not know `i18n.key`
 * (a version skew) — `resolveWireKey` is the only sanctioned way to translate
 * a key that came off the wire; never cast it to a catalog key type.
 */
function fromIssues(issues: readonly unknown[]): FieldErrors {
  const errors: FieldErrors = {};
  for (const entry of issues) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as {
      path?: unknown;
      message?: unknown;
      i18n?: { key?: unknown; values?: Record<string, string | number> };
    };
    const wireMessage = typeof record.message === "string" ? record.message : undefined;
    const key = typeof record.i18n?.key === "string" ? record.i18n.key : undefined;
    const message = (key && resolveWireKey(getLocale(), key, record.i18n?.values)) ?? wireMessage;
    if (!message) continue;
    const field = Array.isArray(record.path)
      ? record.path.map((part) => String(part)).join(".")
      : typeof record.path === "string"
        ? record.path
        : "";
    const fieldKey = field.length > 0 ? field : "_form";
    if (!(fieldKey in errors)) errors[fieldKey] = message;
  }
  return errors;
}

/** Convenience for controlled forms: clears one field's error on change. */
export function clearField(errors: FieldErrors, field: string): FieldErrors {
  if (!(field in errors)) return errors;
  const next = { ...errors };
  delete next[field];
  return next;
}
