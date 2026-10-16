import { Schema, type Types } from "effect";
import { IdSchema } from "../../../core/schemas/common.ts";
import { Bool, Int, Str, maxLength, minLength, nonnegative, trim } from "../../../core/schemas/checks.ts";

export const CategoryLabelSchema = Str.pipe(trim).check(minLength(1), maxLength(80));

export const CategoryResponseSchema = Schema.Struct({
  id: IdSchema,
  slug: Str,
  /** Fully rendered: `customLabel ?? t(categories.name.<slug>)` in the negotiated locale. */
  label: Str,
  customLabel: Schema.NullOr(Str),
  isSystem: Bool,
  isHidden: Bool,
  position: Int,
  usageCount: Int.check(nonnegative()),
});
export type CategoryResponse = Types.DeepMutable<typeof CategoryResponseSchema.Type>;

export const CategoryListResponseSchema = Schema.Struct({ items: Schema.Array(CategoryResponseSchema) });
export type CategoryListResponse = Types.DeepMutable<typeof CategoryListResponseSchema.Type>;

export const CreateCategoryRequestSchema = Schema.Struct({
  label: CategoryLabelSchema,
  position: Schema.optional(Int),
});
export type CreateCategoryRequest = Types.DeepMutable<typeof CreateCategoryRequestSchema.Type>;

export const UpdateCategoryRequestSchema = Schema.Struct({
  label: Schema.optional(CategoryLabelSchema),
  isHidden: Schema.optional(Bool),
  position: Schema.optional(Int),
});
export type UpdateCategoryRequest = Types.DeepMutable<typeof UpdateCategoryRequestSchema.Type>;
