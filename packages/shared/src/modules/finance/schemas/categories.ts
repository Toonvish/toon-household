import { z } from "zod";
import { IdSchema } from "../../../core/schemas/common.ts";

export const CategoryLabelSchema = z.string().trim().min(1).max(80);

export const CategoryResponseSchema = z.object({
  id: IdSchema,
  slug: z.string(),
  /** Fully rendered: `customLabel ?? t(categories.name.<slug>)` in the negotiated locale. */
  label: z.string(),
  customLabel: z.string().nullable(),
  isSystem: z.boolean(),
  isHidden: z.boolean(),
  position: z.number().int(),
  usageCount: z.number().int().nonnegative(),
});
export type CategoryResponse = z.infer<typeof CategoryResponseSchema>;

export const CategoryListResponseSchema = z.object({ items: z.array(CategoryResponseSchema) });
export type CategoryListResponse = z.infer<typeof CategoryListResponseSchema>;

export const CreateCategoryRequestSchema = z.object({
  label: CategoryLabelSchema,
  position: z.number().int().optional(),
});
export type CreateCategoryRequest = z.infer<typeof CreateCategoryRequestSchema>;

export const UpdateCategoryRequestSchema = z.object({
  label: CategoryLabelSchema.optional(),
  isHidden: z.boolean().optional(),
  position: z.number().int().optional(),
});
export type UpdateCategoryRequest = z.infer<typeof UpdateCategoryRequestSchema>;
