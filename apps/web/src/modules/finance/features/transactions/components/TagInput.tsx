/**
 * Free-text tag entry (docs/spec.md §4.5): a text field where Enter or a
 * comma commits the current word as a tag, plus the household's top-8 most
 * used tags as tappable chips above it. Tags themselves are plain NAMES on
 * the wire (`CreateTransactionRequest.tags: string[]`) — normalisation and
 * "is this a new tag" happen server-side (`normalizeTagName`,
 * `packages/shared/src/tags.ts`), so this component only de-duplicates
 * case-insensitively for its own chip list, never decides identity.
 */
import { useState } from "react";
import { X } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useTagSuggestions } from "../lib/queries";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";

export interface TagInputProps {
  householdId: string;
  value: readonly string[];
  onChange: (tags: string[]) => void;
}

const SUGGESTION_LIMIT = 8;

export function TagInput({ householdId, value, onChange }: TagInputProps) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const suggestions = useTagSuggestions(householdId, { limit: SUGGESTION_LIMIT });

  const selectedKeys = new Set(value.map((name) => name.trim().toLowerCase()));

  function addTag(rawName: string) {
    const name = rawName.trim();
    if (name === "") return;
    if (selectedKeys.has(name.toLowerCase())) return;
    onChange([...value, name]);
  }

  function removeTag(name: string) {
    onChange(value.filter((tag) => tag !== name));
  }

  function commitDraft() {
    if (draft.trim() === "") return;
    addTag(draft);
    setDraft("");
  }

  const availableSuggestions = (suggestions.data?.items ?? []).filter(
    (tag) => !selectedKeys.has(tag.name.trim().toLowerCase()),
  );

  return (
    <div className="flex flex-col gap-2">
      <Label optional>{t("finance.transactions.form.tags")}</Label>

      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((name) => (
            <li key={name}>
              <button
                type="button"
                onClick={() => removeTag(name)}
                className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand-soft-fg"
              >
                {name}
                <X aria-hidden="true" className="size-3.5" />
                <span className="sr-only">{t("finance.common.remove")}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <Input
        value={draft}
        placeholder={t("finance.transactions.form.tagsPlaceholder")}
        onChange={(event) => {
          const raw = event.currentTarget.value;
          // A trailing comma commits the word before it and clears the field —
          // typing "Amazon," should not leave a dangling comma on screen.
          if (raw.endsWith(",")) {
            addTag(raw.slice(0, -1));
            setDraft("");
            return;
          }
          setDraft(raw);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commitDraft();
          } else if (event.key === "Backspace" && draft === "" && value.length > 0) {
            removeTag(value[value.length - 1] as string);
          }
        }}
        onBlur={commitDraft}
      />

      {availableSuggestions.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-fg-muted">{t("finance.transactions.form.tagsSuggestions")}</span>
          <ul className="flex flex-wrap gap-1.5">
            {availableSuggestions.map((tag) => (
              <li key={tag.id}>
                <button
                  type="button"
                  onClick={() => addTag(tag.name)}
                  className="min-h-8 rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-medium text-fg transition-colors duration-150 hover:border-line-strong"
                >
                  {tag.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
