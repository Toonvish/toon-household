/**
 * Catalog + translator typing. Flat, dotted, namespace-prefixed keys — see
 * docs/i18n.md §2. No React, no `Intl` construction: this file is pure types
 * plus the tiny structural helpers the translator needs.
 */

/** A plural entry. `other` is the only mandatory form (§2, §11). */
export type PluralForms = { readonly other: string } & {
  readonly [C in Exclude<Intl.LDMLPluralRule, "other">]?: string;
};

/** One catalog value: a plain string, or a plural entry. */
export type CatalogEntry = string | PluralForms;

/** A namespace's `de` catalog: every key must start with `${Prefix}.`. */
export type NamespaceCatalog<Prefix extends string> = Record<`${Prefix}.${string}`, CatalogEntry>;

/**
 * The `en` (or any non-`de`) shape of a catalog: same keys as `C`, same
 * string-vs-plural shape per key, checked by `tsc` (§2):
 *  - a key missing from this type is a compile error (mapped types are not optional),
 *  - an extra key is an excess-property error against an annotated `const`,
 *  - a plural-vs-string mismatch on one key is a compile error.
 */
export type LocaleCatalog<C extends Record<string, CatalogEntry>> = {
  readonly [K in keyof C]: C[K] extends string ? string : PluralForms;
};

export type MessageValues = Readonly<Record<string, string | number>>;

/** Placeholder names in a catalog literal: `Placeholders<"Remove {name}"> = "name"`. */
export type Placeholders<S extends string> = S extends `${string}{${infer Name}}${infer Rest}`
  ? Name | Placeholders<Rest>
  : never;

/** The "other" form of a plural entry, extracted with `infer` (not `E["other"]`
 *  indexed access) — indexing a generic narrowed inside a conditional's branch
 *  is unreliable across TS versions; `infer …extends string` is not. */
type OtherFormOf<E> = E extends { readonly other: infer O extends string } ? O : never;

/** The values object a given catalog entry requires. */
export type ValuesFor<E extends CatalogEntry> = E extends string
  ? { readonly [K in Placeholders<E>]: string | number }
  : { readonly count: number } & {
      readonly [K in Exclude<Placeholders<OtherFormOf<E>>, "count">]: string | number;
    };

/** No placeholders -> no second argument; otherwise it is required. */
export type TranslateArgs<E extends CatalogEntry> = [keyof ValuesFor<E>] extends [never]
  ? []
  : [values: ValuesFor<E>];

/** The shape of `t()` for one catalog. */
export interface Translator<C extends Record<string, CatalogEntry>> {
  <K extends keyof C & string>(key: K, ...args: TranslateArgs<C[K]>): string;
}
