/**
 * Tags feature barrel.
 *
 * The route screens are NOT re-exported here. `router.tsx` loads them with
 * `lazyRouteComponent(() => import(...))`; a static re-export that anything imports
 * would pull them into the main chunk and break the code splitting.
 */
export { TagChip, TagFilterButton, type TagChipProps } from "./components/TagChip";
export { TagCombobox, type TagComboboxProps } from "./components/TagCombobox";
export { useTags, useCreateTag, useUpdateTag, useDeleteTag } from "./lib/queries";
