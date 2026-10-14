/**
 * Collections feature barrel.
 *
 * The route screens are NOT re-exported here. `router.tsx` loads them with
 * `lazyRouteComponent(() => import(...))`; a static re-export that anything imports
 * would pull them into the main chunk and break the code splitting.
 */
export {
  useCollections,
  useCollection,
  useCreateCollection,
  useUpdateCollection,
  useDeleteCollection,
  useAddRecipeToCollection,
  useRemoveRecipeFromCollection,
  useReorderCollectionRecipes,
} from "./lib/queries";
