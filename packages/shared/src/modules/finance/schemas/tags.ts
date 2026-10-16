import { Effect, Schema, type Types } from "effect";
import { TAG_MAX_LENGTH } from "../tags.ts";
import { IdSchema } from "../../../core/schemas/common.ts";
import { CoercedInt, Int, Str, max, maxLength, min, minLength, nonnegative, trim } from "../../../core/schemas/checks.ts";

export const TagNameSchema = Str.pipe(trim).check(minLength(1), maxLength(TAG_MAX_LENGTH));

export const FinanceTagResponseSchema = Schema.Struct({
  id: IdSchema,
  name: Str,
  usageCount: Int.check(nonnegative()),
});
export type FinanceTagResponse = Types.DeepMutable<typeof FinanceTagResponseSchema.Type>;

export const FinanceTagListResponseSchema = Schema.Struct({ items: Schema.Array(FinanceTagResponseSchema) });
export type FinanceTagListResponse = Types.DeepMutable<typeof FinanceTagListResponseSchema.Type>;

export const FinanceUpdateTagRequestSchema = Schema.Struct({ name: TagNameSchema });
export type FinanceUpdateTagRequest = Types.DeepMutable<typeof FinanceUpdateTagRequestSchema.Type>;

export const TagQuerySchema = Schema.Struct({
  q: Schema.optional(Str.check(maxLength(100))),
  limit: CoercedInt.check(min(1), max(100)).pipe(Schema.withDecodingDefault(Effect.succeed(20))),
});
export type TagQuery = Types.DeepMutable<typeof TagQuerySchema.Type>;
