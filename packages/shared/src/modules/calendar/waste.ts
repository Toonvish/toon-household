/**
 * The waste-collection providers and categories (design §3, §5; plan m8 P17). Pure data plus the source-URL rule
 * the API's fetch and the web's form share.
 */

/** The waste types in display order (design §5.6): Restmüll, Gelber Sack, Biotonne, Papiertonne, Tannenbaum. */
export const WASTE_CATEGORIES = ["waste_rest", "waste_yellow", "waste_bio", "waste_paper", "waste_tree"] as const;
export type WasteCategory = (typeof WASTE_CATEGORIES)[number];

/** Details a pickup can carry: `bio_cleaning` is a Biotonne pickup inside a cleaning range ("+ Reinigung"). */
export const WASTE_DETAILS = ["bio_cleaning"] as const;
export type WasteDetail = (typeof WASTE_DETAILS)[number];

/** The provider registry. `tours` are the tour numbers ("Bezirke") the flyer prints; `hosts` the exact hosts a
 * flyer may be fetched from (every redirect hop is checked against the same list). */
export const WASTE_PROVIDERS = {
  hattingen: {
    name: "Stadt Hattingen",
    tours: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    hosts: ["www.hattingen.de", "hattingen.de"],
    defaultUrl:
      "https://www.hattingen.de/stadt_hattingen/Rathaus/Fachbereiche/Stadtbetriebe/Abfallentsorgung/AbfallFlyer%202027.pdf",
  },
} as const;

export type WasteProviderId = keyof typeof WASTE_PROVIDERS;

/** The provider ids, for the wire enum. */
export const WASTE_PROVIDER_IDS = ["hattingen"] as const satisfies ReadonlyArray<WasteProviderId>;

/**
 * True when `url` may be fetched for `provider` (P17): it parses, its scheme is `https:`, it carries no user name
 * or password, its port is the default one, and its host is EXACTLY one of the provider's `hosts` (no suffix match,
 * so `evil-hattingen.de` and `hattingen.de.example` are refused). A redirect target is checked the same way.
 */
export function isWasteSourceHost(provider: WasteProviderId, url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "" || parsed.port !== "") return false;
  const hosts: ReadonlyArray<string> = WASTE_PROVIDERS[provider].hosts;
  return hosts.includes(parsed.hostname);
}
