import { Hono } from "hono";
import type { AppEnv } from "../../../lib/types.ts";

// STUB (M2-T03): M2-T05 replaces it with toon-recipe's routes/cards.ts (user-scoped, /api/recipe/cards).
export const cardRoutes = new Hono<AppEnv>();
