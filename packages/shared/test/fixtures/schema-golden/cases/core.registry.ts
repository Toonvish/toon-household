import { enumLeaf, uniqueIds, type Case } from "./_lib.ts";

export const cases: Case[] = uniqueIds([
  ...enumLeaf("ModuleIdSchema", ["recipe", "finance"], ["Recipe", "households", "recipe,finance"]),
]);
