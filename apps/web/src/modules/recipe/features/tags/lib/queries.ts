/** TanStack Query hooks for household tags. Keys come from `@/lib/queries`. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateTagRequest, Tag, UpdateTagRequest } from "@toon/shared";
import { createTag, deleteTag, updateTag } from "@/modules/recipe/lib/api";
import { invalidate, tagsQuery } from "@/modules/recipe/lib/queries";

/** Tag list of the active household, unwrapped to `Tag[]`. */
export function useTags(householdId: string | null) {
  const options = tagsQuery(householdId ?? "");
  return useQuery({
    ...options,
    enabled: householdId !== null,
    select: (response) => response.items,
  });
}

export function useCreateTag(householdId: string | null) {
  const client = useQueryClient();
  return useMutation<Tag, Error, CreateTagRequest>({
    mutationFn: async (input) => {
      const response = await createTag(householdId ?? "", input);
      return response.tag;
    },
    onSuccess: async () => {
      if (householdId) await invalidate.tags(client, householdId);
    },
  });
}

export interface UpdateTagInput extends UpdateTagRequest {
  tagId: string;
}

/**
 * Renaming or deleting a tag changes what every recipe CARD shows, so the recipe
 * list has to go too — creating one does not, which is why `useCreateTag` above
 * invalidates less.
 */
function invalidateTagsAndRecipes(
  client: ReturnType<typeof useQueryClient>,
  householdId: string,
): Promise<unknown> {
  return Promise.all([invalidate.tags(client, householdId), invalidate.recipes(client, householdId)]);
}

export function useUpdateTag(householdId: string | null) {
  const client = useQueryClient();
  return useMutation<Tag, Error, UpdateTagInput>({
    mutationFn: async ({ tagId, ...patch }) => {
      const response = await updateTag(householdId ?? "", tagId, patch);
      return response.tag;
    },
    onSuccess: async () => {
      if (!householdId) return;
      await invalidateTagsAndRecipes(client, householdId);
    },
  });
}

export function useDeleteTag(householdId: string | null) {
  const client = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (tagId) => deleteTag(householdId ?? "", tagId),
    onSuccess: async () => {
      if (!householdId) return;
      await invalidateTagsAndRecipes(client, householdId);
    },
  });
}
