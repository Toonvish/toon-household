/**
 * Site adapter registry.
 *
 * Adding a site = one new file next to this one + one entry in `SITE_ADAPTERS`.
 * Selection order used by the URL pipeline:
 *   1. adapters whose `hosts` match the page hostname,
 *   2. adapters whose `appliesTo(doc)` recognises the markup (e.g. WPRM),
 *   3. `genericAdapter` as the universal last resort.
 */
import type { ElementNode } from "../../html/parse.ts";
import { chefkochAdapter } from "./chefkoch.ts";
import { genericAdapter } from "./generic.ts";
import type { AdapterContext, SiteAdapter } from "./types.ts";
import { wprmAdapter } from "./wprm.ts";

/** Hostname-registered adapters, most specific first. */
export const SITE_ADAPTERS: readonly SiteAdapter[] = [chefkochAdapter, wprmAdapter];

export { chefkochAdapter, genericAdapter, wprmAdapter };
export type { AdapterContext, SiteAdapter };

/** Normalises a hostname for matching: lowercase, no trailing dot, no "www.". */
export function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
}

/** True when `host` is `pattern` or a subdomain of it. */
export function hostMatches(host: string, pattern: string): boolean {
  const normalized = normalizeHost(host);
  const target = normalizeHost(pattern);
  return normalized === target || normalized.endsWith(`.${target}`);
}

/** The adapter registered for this hostname, if any. */
export function adapterForHost(hostname: string): SiteAdapter | undefined {
  return SITE_ADAPTERS.find((adapter) => adapter.hosts.some((pattern) => hostMatches(hostname, pattern)));
}

/**
 * Ordered list of adapters to try for a page: hostname match, then markup
 * match, then generic. Never empty.
 */
export function adaptersFor(hostname: string, doc: ElementNode): SiteAdapter[] {
  const out: SiteAdapter[] = [];
  const byHost = adapterForHost(hostname);
  if (byHost) out.push(byHost);
  for (const adapter of SITE_ADAPTERS) {
    if (out.includes(adapter)) continue;
    if (adapter.appliesTo?.(doc) === true) out.push(adapter);
  }
  out.push(genericAdapter);
  return out;
}
