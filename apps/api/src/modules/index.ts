/**
 * The modules this BUILD contains (SPEC §2) — the core's only door into a module.
 * `/api/health` reports their ids, and the module mount (M0-T09) mounts their
 * routers. Empty in M0; recipe joins in M2, finance in M3.
 */
import type { ApiModule } from "./types.ts";

export const API_MODULES: readonly ApiModule[] = [];
