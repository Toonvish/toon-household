# Design project · screen map (verbatim from the design project's `github.md`)

repo: Toonvish/toon-recipe
branch: main
path: apps/web

## Last sync
date: 2026-09-04T10:40:53Z

### Updated in this project
- Redesign concept (dark) for library, recipe detail, shopping overview and shopping list, desktop + mobile
- Palette lifted from apps/web/src/styles/theme.css; type evolved to Newsreader + Figtree
- Logo mark reused from components/layout/Logo.tsx

## Screen map
| Screen | Repo files |
| --- | --- |
| Rezepte Redesign.dc.html · 1a/1e Library | features/recipes/RecipeListPage.tsx, components/RecipeCard.tsx, RecipeRow.tsx, RecipeFilters.tsx, layout/SideNav.tsx, nav-items.ts |
| Rezepte Redesign.dc.html · 1b/1f Detail | features/recipes/RecipeDetailPage.tsx, IngredientList.tsx, StepList.tsx, ServingsScaler.tsx |
| Rezepte Redesign.dc.html · 1c/1g Shopping overview | features/shopping/ShoppingListsPage.tsx, features/cards/components/CardsCard.tsx |
| Rezepte Redesign.dc.html · 1d/1h Shopping list | features/shopping/ShoppingListDetailPage.tsx, ShoppingItemCard.tsx, ShoppingItemTile.tsx, FrequentlyUsed.tsx, AddItemBar.tsx |

> NOTE (added during import, 2026-09-08): this table is **wrong about 1a/1b**. See
> `SPEC.md` § "Artboard inventory" — `1a` is captioned "Recipe library" and labelled
> `Library desktop` but its CONTENT is the recipe detail screen, and `1b` does not
> exist in the file. The desktop library artboard was never drawn.
