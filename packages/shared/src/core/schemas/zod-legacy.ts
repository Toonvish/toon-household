import { z } from "zod";
import { refineKey } from "../i18n/zod.ts";
import { isHttpUrl } from "./common.ts";

export const IdSchema = z.uuid();

export const IsoDateSchema = z.iso.datetime({ offset: true });

export const HttpUrlSchema = z
  .string()
  .max(2000)
  .refine(isHttpUrl, refineKey("server.validation.httpUrlOnly"));

export function listResponse<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
  });
}

export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(24),
  offset: z.coerce.number().int().min(0).default(0),
});

export const PublicUserSchema = z.object({
  id: IdSchema,
  name: z.string(),
  email: z.string().nullable(),
  avatarUrl: z.string().nullish(),
});
