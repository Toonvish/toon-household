/**
 * Creatable tag combobox.
 *
 * The API accepts tag NAMES and creates unknown ones inside the household
 * (docs/API.md → "CreateRecipeRequest.tags are tag names"), so this control never has to
 * call the tag endpoint itself — it just manages a list of strings.
 *
 * Keyboard: ↑/↓ through the suggestions, Enter picks the highlighted one (or creates the
 * typed value), Backspace on an empty input removes the last tag, Escape closes the list.
 */
import { useId, useMemo, useRef, useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { foldText, type Tag, type TagKind } from "@toon/shared";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { Label } from "@/components/ui";
import { TagChip } from "./TagChip";

/** The recipe library filter rail draws the exact same "Gänge" / "Tags" split (D5) off
 * the exact same two keys — reusing them here rather than minting a combobox-scoped pair
 * is what keeps the wording identical everywhere a household's tags are grouped by kind. */
const COURSE_SECTION_KEY = "recipe.recipes.filters.courseLegend" as const;
const FREE_SECTION_KEY = "recipe.recipes.filters.tagsLegend" as const;

export interface TagComboboxProps {
  /** Selected tag names. */
  value: readonly string[];
  onChange: (value: string[]) => void;
  /** Existing tags of the household, used for suggestions. */
  available: readonly Tag[];
  label?: string;
  disabled?: boolean;
  error?: string | undefined;
  maxTags?: number;
}

/**
 * Tag identity, folded exactly the way the server folds it.
 *
 * `getOrCreateTagIds` keys existing tags by `foldText()`, which folds umlauts and
 * accents onto their base letter ("Käse" and "Kase" are both "kase"). A plain
 * `toLowerCase()` here disagreed with that: the control offered "Kase" as a new tag
 * next to an existing "Käse", and the server then silently merged the two on save.
 */
function sameName(a: string, b: string): boolean {
  return foldText(a.trim()) === foldText(b.trim());
}

export function TagCombobox({
  value,
  onChange,
  available,
  label,
  disabled = false,
  error,
  maxTags = 30,
}: TagComboboxProps) {
  const t = useT();
  const resolvedLabel = label ?? t("recipe.tagCombobox.label");
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const inputId = useId();
  const listId = `${inputId}-list`;

  const suggestions = useMemo(() => {
    // Folded too, or typing "Kase" would match nothing while `sameName` below has
    // already decided it IS the existing "Käse" — no suggestion, and no way to create.
    const query = foldText(text.trim());
    const matches = available
      .filter((tag) => !value.some((name) => sameName(name, tag.name)))
      .filter((tag) => query.length === 0 || foldText(tag.name).includes(query));
    // Grouped by `kind` (D5), course first — same order the filter rail draws its own
    // "Gänge" above "Tags" — each half keeping its own relative order (server-sorted
    // alphabetically by `tagsByRecipe`/the household's tag listing). The cap stays 8 total,
    // now measured across both groups so a long free-tag match can't crowd every course
    // out of the list.
    const courses = matches.filter((tag) => tag.kind === "course");
    const free = matches.filter((tag) => tag.kind !== "course");
    return [...courses, ...free].slice(0, 8);
  }, [available, text, value]);

  const trimmed = text.trim();
  const canCreate =
    trimmed.length > 0 &&
    !value.some((name) => sameName(name, trimmed)) &&
    !available.some((tag) => sameName(tag.name, trimmed));

  const options: Array<{ kind: "existing"; tag: Tag } | { kind: "create"; name: string }> = [
    ...suggestions.map((tag) => ({ kind: "existing" as const, tag })),
    ...(canCreate ? [{ kind: "create" as const, name: trimmed }] : []),
  ];

  /** The section an option falls under — a "create" option is always **Tags**, since a
   * new tag is always `kind:'free'` (`getOrCreateTagIds` never creates one any other
   * way), whatever it happens to follow. */
  function sectionOf(option: (typeof options)[number]): TagKind {
    return option.kind === "existing" ? option.tag.kind : "free";
  }

  function add(name: string) {
    const clean = name.trim();
    if (clean.length === 0) return;
    if (value.length >= maxTags) return;
    if (value.some((existing) => sameName(existing, clean))) return;
    onChange([...value, clean]);
    setText("");
    setHighlight(0);
    setOpen(false);
    inputRef.current?.focus();
  }

  function removeAt(index: number) {
    onChange(value.filter((_name, position) => position !== index));
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setHighlight((current) => (options.length === 0 ? 0 : (current + 1) % options.length));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setHighlight((current) =>
        options.length === 0 ? 0 : (current - 1 + options.length) % options.length,
      );
      return;
    }
    if (event.key === "Enter" || event.key === ",") {
      if (trimmed.length === 0 && event.key === "Enter") return;
      event.preventDefault();
      const option = options[highlight];
      if (option) add(option.kind === "existing" ? option.tag.name : option.name);
      else add(trimmed);
      return;
    }
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "Backspace" && text.length === 0 && value.length > 0) {
      event.preventDefault();
      removeAt(value.length - 1);
    }
  }

  const colorOf = (name: string): string | null =>
    available.find((tag) => sameName(tag.name, name))?.color ?? null;
  // A NEW tag (not yet in `available`) is always `kind:'free'` — `getOrCreateTagIds`
  // only ever creates one that way (see the tags.ts gotcha), so that's the right
  // default for a selected chip the household's own listing hasn't caught up with yet.
  const kindOf = (name: string): Tag["kind"] =>
    available.find((tag) => sameName(tag.name, name))?.kind ?? "free";

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={inputId} optional>
        {resolvedLabel}
      </Label>

      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((name, index) => (
            <li key={`${name}-${index}`} className="inline-flex">
              <span className="inline-flex items-center gap-1">
                <TagChip tag={{ name, color: colorOf(name) }} kind={kindOf(name)} />
                <button
                  type="button"
                  onClick={() => removeAt(index)}
                  disabled={disabled}
                  aria-label={t("recipe.tagCombobox.removeLabel", { name })}
                  className="flex size-6 items-center justify-center rounded-full text-fg-muted hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
                >
                  <X aria-hidden="true" className="size-3.5" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="relative">
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={open && options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : `${inputId}-hint`}
          value={text}
          disabled={disabled || value.length >= maxTags}
          placeholder={
            value.length >= maxTags
              ? t("recipe.tagCombobox.maxReached")
              : t("recipe.tagCombobox.placeholder")
          }
          onChange={(event) => {
            setText(event.target.value);
            setOpen(true);
            setHighlight(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          className={cn(
            "min-h-11 w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-fg shadow-soft",
            "placeholder:text-fg-subtle focus:border-brand focus:outline-2 focus:outline-brand/40",
            "disabled:cursor-not-allowed disabled:opacity-60",
            error && "border-danger",
          )}
        />

        {open && options.length > 0 ? (
          <ul
            id={listId}
            role="listbox"
            className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-pop"
          >
            {options.map((option, index) => {
              const key = option.kind === "existing" ? option.tag.id : `create-${option.name}`;
              const name = option.kind === "existing" ? option.tag.name : option.name;
              const group = sectionOf(option);
              const previousGroup = index > 0 ? sectionOf(options[index - 1] ?? option) : undefined;
              const heading =
                group === previousGroup
                  ? null
                  : t(group === "course" ? COURSE_SECTION_KEY : FREE_SECTION_KEY);
              return (
                <li key={key}>
                  {heading !== null ? (
                    // Presentational — the flat `options` array (and `highlight`) is what
                    // keyboard nav walks; this heading is never itself an `option`.
                    <p
                      role="presentation"
                      className={cn(
                        "eyebrow px-2 pt-1.5 pb-0.5 text-fg-faint",
                        index > 0 && "mt-1 border-t border-line",
                      )}
                    >
                      {heading}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === highlight}
                    // onMouseDown so the click lands before the input's blur closes the list.
                    onMouseDown={(event) => {
                      event.preventDefault();
                      add(name);
                    }}
                    onMouseEnter={() => setHighlight(index)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm",
                      index === highlight ? "bg-brand-soft text-brand-soft-fg" : "text-fg",
                    )}
                  >
                    {option.kind === "create" ? (
                      <>
                        <Plus aria-hidden="true" className="size-4" />
                        <span>{t("recipe.tagCombobox.createOption", { name })}</span>
                      </>
                    ) : (
                      <>
                        <Check aria-hidden="true" className="size-4 opacity-0" />
                        <TagChip tag={option.tag} kind={option.tag.kind} showCount />
                      </>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      {error ? (
        <p id={`${inputId}-error`} role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : (
        <p id={`${inputId}-hint`} className="text-sm text-fg-muted">
          {t("recipe.tagCombobox.hint")}
        </p>
      )}
    </div>
  );
}
