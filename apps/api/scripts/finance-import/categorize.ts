/**
 * [IMPORT] Category heuristic (docs/ledger-spec.md §7.2). First match wins;
 * every rule below is copied verbatim from the spec's ordered table, and
 * `geschenke` sits at its documented position 18 like everything else.
 *
 * One narrow, deliberate exception, spelled out here rather than left
 * implicit: the spec's own worked examples name exactly two keyword
 * collisions where `geschenke` must win despite running later —
 * "`Nadja Karten`"/"`HandyHülle Nadja`" (`nadja` before `elektronik`'s
 * `handy` and `hobby_kreativ`'s `karten\b`) and "`Blumen Häckeln`" (`blumen`
 * before `hobby_kreativ`'s `h(ä|ae)ckel`). Promoting `geschenke`'s FULL
 * pattern ahead of everything (an earlier draft of this file did exactly
 * that) satisfies those three vectors but overshoots badly on the real
 * corpus: measured against the spec's own §7.2 distribution table, it
 * steals 13 rows from `elektronik`/`hobby_kreativ`/`haushalt_kueche`/
 * `drogerie`/`mobilitaet`/`freizeit` that the table says belong there. So
 * only the two colliding keywords (`nadja`/`nadia`, `blumen`) are
 * promoted; the rest of `geschenke`'s pattern runs at its documented
 * position, and the measured full-corpus distribution matches §7.2 exactly
 * (tiere 38, moebel_wohnen 32, elektronik 22, hobby_kreativ 21, … geschenke
 * 13, …, steuern_abgaben 1 — apps/api/test/import-haushalt.test.ts).
 */

export const DEFAULT_CATEGORY_FALLBACK = "sonstiges";

interface CategoryRule {
  slug: string;
  pattern: RegExp;
}

/** The two named exceptions — see the module doc comment. Everything else of `geschenke` stays at position 18. */
const PROMOTED_RULE: CategoryRule = {
  slug: "geschenke",
  pattern: /nadja|nadia|blumen/i,
};

/** The 20 rules in the spec's documented order (docs/ledger-spec.md §7.2), `geschenke` included at position 18. */
const ORDERED_RULES: CategoryRule[] = [
  { slug: "tiere", pattern: /fressnapf|futter|katze|tierarzt|tierazrt|kratzbaum|velivery|kokku|napf|streu/i },
  { slug: "miete", pattern: /\bmiete|mietkaution|kaution/i },
  { slug: "nebenkosten", pattern: /strom|nachzahlung|r(ü|ue)ckerstattung|internet|gas|wasser|abschlag/i },
  { slug: "versicherung", pattern: /haftpflicht|versicherung/i },
  // `\bgez\b`, not the spec table's bare `gez`: as a substring it fires on
  // any "…gez…" word, and the sheet's own D-column header is literally
  // "Partner gezahlt" — the trap is in the corpus vocabulary, one typed label
  // away from filing a partner's repayment under taxes. Bounded, it still
  // matches "GEZ" and "GEZ-Gebühren"; on the real corpus it changes nothing
  // (the single steuern_abgaben row is "Steuern 2025", via `steuern`).
  { slug: "steuern_abgaben", pattern: /steuern|\bgez\b|rundfunk/i },
  {
    slug: "baumarkt",
    pattern: /\bobi\b|farbe|maler|hammer|fliegengitter|tischbeine|kohle ?filter|bauhaus|hornbach|schrauben/i,
  },
  {
    slug: "moebel_wohnen",
    pattern:
      /schrank|\bbett\b|esstisch|st(ü|ue)hle|sideboard|sofa|schreibtisch|couch|garderobe|gartenm(ö|oe)bel|matratze|lattenrost|kommode|\bikea\b|\blutz\b|menke|osterman|zurbr(ü|ue)ggen|badezimmerm|gardinen|lampe|leuchte|spiegel|teppich|regal|topper|rollen/i,
  },
  {
    slug: "elektronik",
    pattern:
      /elektronik|drucker|tablet|pc\b|festplatte|headset|monitor|moitor|usb|handy|vivoactive|analouge|analogue|pocket|logitech|kamera|akku|kabel|k(ä|ae)rcher|f(ö|oe)hn|b(ü|ue)geleisen|staples|office 20|zubeh(ö|oe)r/i,
  },
  {
    slug: "lebensmittel",
    pattern: /lebensmittel|kaufland|marktkauf|supermark|edeka|rewe|aldi|lidl|essen|sirup|getr(ä|ae)nk|bautzener/i,
  },
  {
    slug: "haushalt_kueche",
    pattern:
      /\bwmf\b|mepal|pfanne|friteuse|reiskocher|thermoskanne|kochblume|m(ü|ue)lleimer|abfalleimer|messer|tischdecke|kerzen|weichsp(ü|ue)ler|toilette|zahnb(ü|ue)rste|kalender|lichterkette|weihnachtsbaum|\buhr\b|schiff|grill|liity/i,
  },
  { slug: "drogerie", pattern: /parfum|pafum|douglas|rituals|creme|apotheke|holy\b/i },
  {
    slug: "kleidung",
    pattern: /zalando|schuhe|hose|pulli|adidas|intersport|kingsley|kingley|birkenstock|hoodie|outlet|jacke|shopping|schmuck|swarovski/i,
  },
  {
    slug: "spiele_medien",
    pattern:
      /hogwarts|sims|steam|last of us|staffel|dvd|houseflipper|sun haven|chef life|roots of pacha|only up|the crew|battlefield|007|simulator|contract vile|tiny bookshop|b(ü|ue)cher|spiel|nintendo|playstation|lenkrad/i,
  },
  {
    slug: "hobby_kreativ",
    pattern:
      /wolle|h(ä|ae)ckel|h(ä|ae)kel|scheepjes|malen nach zahlen|faltkarten|kreativa|creativa|stempelm(ü|ue)hle|alpaka|\betsy\b|hula hoop|bluebrixx|karten\b|buchst(ä|ae)nder/i,
  },
  { slug: "mobilitaet", pattern: /\bauto\b|sprit|tanken|\bbahn\b|dienstreise|ticket/i },
  { slug: "reisen", pattern: /hotel|raddison|radisson|urlaub|reise|flug/i },
  { slug: "freizeit", pattern: /kygo|ed sheeran|konzert|\bbar\b|\bjga\b|hochzeit|kino|restaurant|chinesisch/i },
  {
    slug: "geschenke",
    pattern:
      /geschenk|geburtstag|gebrtstag|burzeltag|weihnachten|weihnachts|fleurop|blumen|(ü|ue)mit|nadja|nadia|omi|oma|lena|spende/i,
  },
  {
    slug: "ausgleich",
    pattern: /r(ü|ue)ckzahlung|bargeld|(ü|ue)berweisung|erstattung/i,
  },
];

/** `categorySource: 'heuristic'` for every row this resolves to anything but the fallback. */
export function categorize(label: string): { slug: string; matched: boolean } {
  if (PROMOTED_RULE.pattern.test(label)) return { slug: PROMOTED_RULE.slug, matched: true };
  for (const rule of ORDERED_RULES) {
    if (rule.pattern.test(label)) return { slug: rule.slug, matched: true };
  }
  return { slug: DEFAULT_CATEGORY_FALLBACK, matched: false };
}
