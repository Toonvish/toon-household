/**
 * The request body of `POST …/calendar/waste/preview` and `…/waste/import` (plan m8 P17), read into a `WasteSource`:
 *
 * - `multipart/form-data`: the `file` part (the flyer PDF) and `tour` (`CalendarWasteUploadFieldsSchema`, a numeric string
 *   1-9). No file: `422 validation_failed` at path `file` (`server.calendar.wasteFileRequired`); more than 10 MiB:
 *   `413 payload_too_large` (`server.calendar.wasteTooLarge`); bytes that do not start with `%PDF-`:
 *   `415 unsupported_media_type` (`server.calendar.wasteNotPdf`). The client's file name is kept for display only
 *   (`source_name`, at most 200 characters), never trusted for the type.
 * - JSON: `CalendarWasteSourceRequestSchema` (`{ provider?, tour, url }`, provider default `hattingen`); a body without a
 *   `url` (or any other content type) is the same `422` at path `file`: neither a file nor a link was given.
 *
 * A plain function over the request (no service): the multipart reading and the checks are the module's own, in the
 * SHAPE of the recipe importer's `ImportFiles.readUploadedFile`, never imported from it (module boundary).
 */
import { basename } from "node:path";
import {
  CALENDAR_LIMITS,
  CalendarWasteSourceRequestSchema,
  CalendarWasteUploadFieldsSchema,
  DEFAULT_LOCALE,
  serverText,
} from "@toon/shared";
import { Effect, Predicate, type Schema } from "effect";
import type { HttpServerRequest } from "effect/http";
import { header, rawJsonOr, webRequest } from "../../../../http/request.ts";
import { BadRequest, PayloadTooLarge, UnsupportedMediaType, ValidationFailed } from "../../../../lib/errors.ts";
import { decode } from "../../../../lib/validate.ts";
import { hasPdfHeader } from "./pdf-text.ts";
import type { WasteSource } from "./waste.service.ts";

/** What reading the body may refuse with. */
export type WasteSourceRefusal =
  | BadRequest
  | PayloadTooLarge
  | UnsupportedMediaType
  | ValidationFailed
  | Schema.SchemaError;

/** `422 validation_failed` at path `file`: neither a file nor a link. */
function fileRequired(): ValidationFailed {
  return new ValidationFailed({
    text: "server.calendar.wasteFileRequired",
    details: [
      {
        path: "file",
        code: "custom",
        message: serverText(DEFAULT_LOCALE, "server.calendar.wasteFileRequired"),
        i18n: { key: "server.calendar.wasteFileRequired" },
      },
    ],
  });
}

const MULTIPART = /^multipart\/form-data\b/i;
const JSON_TYPE = /^application\/(?:[a-z.-]+\+)?json\b/i;

/** The uploaded flyer of a multipart body. */
const readUpload = Effect.fn("CalendarWaste.readUpload")(function* (request: Request) {
  // Bun's `Request.formData()` is undici's `FormData`; read it as such.
  const form = yield* Effect.tryPromise({
    try: () => request.formData(),
    catch: () => new BadRequest({ text: "server.error.requestFailed" }),
  });
  const tourValue = form.get("tour");
  const fields = yield* decode(CalendarWasteUploadFieldsSchema, { tour: Predicate.isString(tourValue) ? tourValue : undefined });
  const value = form.get("file");
  if (value === null || Predicate.isString(value)) return yield* fileRequired();
  const file = value as File;
  if (file.size > CALENDAR_LIMITS.wastePdfMaxBytes) return yield* new PayloadTooLarge({ text: "server.calendar.wasteTooLarge" });
  const bytes = new Uint8Array(yield* Effect.promise(() => file.arrayBuffer()));
  if (bytes.byteLength === 0) return yield* fileRequired();
  if (bytes.byteLength > CALENDAR_LIMITS.wastePdfMaxBytes) {
    return yield* new PayloadTooLarge({ text: "server.calendar.wasteTooLarge" });
  }
  if (!hasPdfHeader(bytes)) return yield* new UnsupportedMediaType({ text: "server.calendar.wasteNotPdf" });
  const name = Predicate.isString(file.name) && file.name.length > 0 ? basename(file.name).slice(0, 200) : "upload.pdf";
  return { kind: "upload", provider: "hattingen", tour: fields.tour, bytes, fileName: name } satisfies WasteSource;
});

/** The request body as a `WasteSource` (multipart upload or JSON link); see the file header for the refusals. */
export const readWasteSource: Effect.Effect<WasteSource, WasteSourceRefusal, HttpServerRequest.HttpServerRequest> =
  Effect.gen(function* () {
    const contentType = (yield* header("content-type")) ?? "";
    if (MULTIPART.test(contentType)) return yield* readUpload(yield* webRequest);
    if (!JSON_TYPE.test(contentType)) return yield* fileRequired();
    const value = yield* rawJsonOr(() => new BadRequest({ text: "server.error.requestFailed" }));
    if (!Predicate.isObject(value) || !Predicate.hasProperty(value, "url") || value.url === undefined || value.url === "") {
      return yield* fileRequired();
    }
    const body = yield* decode(CalendarWasteSourceRequestSchema, value);
    return { kind: "url", provider: body.provider ?? "hattingen", tour: body.tour, url: body.url } satisfies WasteSource;
  });
