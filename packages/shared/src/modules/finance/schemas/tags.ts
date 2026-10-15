import { z } from "zod";
import { TAG_MAX_LENGTH } from "../tags.ts";
import { IdSchema } from "../../../core/schemas/common.ts";

export const TagNameSchema = z.string().trim().min(1).max(TAG_MAX_LENGTH);

export const FinanceTagResponseSchema = z.object({
  id: IdSchema,
  name: z.string(),
  usageCount: z.number().int().nonnegative(),
});
export type FinanceTagResponse = z.infer<typeof FinanceTagResponseSchema>;

export const FinanceTagListResponseSchema = z.object({ items: z.array(FinanceTagResponseSchema) });
export type FinanceTagListResponse = z.infer<typeof FinanceTagListResponseSchema>;

export const FinanceUpdateTagRequestSchema = z.object({ name: TagNameSchema });
export type FinanceUpdateTagRequest = z.infer<typeof FinanceUpdateTagRequestSchema>;

export const TagQuerySchema = z.object({
  q: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type TagQuery = z.infer<typeof TagQuerySchema>;
