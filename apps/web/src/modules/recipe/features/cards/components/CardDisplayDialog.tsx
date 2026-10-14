/**
 * The screen you hold up at a till.
 *
 * Everything here serves one goal — a scanner reads it on the first try, and a
 * cashier can read the number out loud if it does not:
 *
 *  - **White panel, black symbol, always.** The barcode is drawn on its own white
 *    sheet regardless of the app theme (see BarcodeImage). A dark-mode barcode is
 *    unreadable to a lot of hand scanners.
 *  - **A screen wake lock** while the dialog is open. Reaching the till after the
 *    phone dimmed itself in the queue is the failure this prevents; the API is
 *    Chromium-only, so it is strictly a bonus and the copy still suggests turning
 *    the brightness up.
 *  - **The number in large monospace** under the symbol. Half the tills in a German
 *    supermarket end up typed in by hand, and grouping the digits is what makes that
 *    possible over a counter.
 *  - **`lastUsedAt` is bumped on open**, which is what puts this card first in the
 *    wallet next time — recorded fire-and-forget, because at a till there is often
 *    no signal and the barcode must appear anyway (see ../lib/queries.ts).
 */
import { useEffect } from "react";
import type { Card } from "@toon/shared";
import { Dialog } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { BarcodeImage } from "./BarcodeImage";
import { useMarkCardUsed } from "../lib/queries";
import { CARD_FORMAT_LABEL_KEYS } from "../lib/formats";

/**
 * The Screen Wake Lock API, which the TypeScript DOM library does not know yet.
 * Declared locally and feature-detected rather than globally augmented — a global
 * `navigator.wakeLock` would make the API look available in every file.
 */
interface WakeLockLike {
  released: boolean;
  release: () => Promise<void>;
}
interface WakeLockNavigator {
  wakeLock?: { request: (type: "screen") => Promise<WakeLockLike> };
}

/**
 * Holds the screen awake while `active`. Never throws: the request is refused on a
 * hidden document, on a battery-saving device, and in every browser but Chromium's,
 * and none of that is worth a message.
 */
function useScreenWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const api = (navigator as WakeLockNavigator).wakeLock;
    if (api === undefined) return;

    let sentinel: WakeLockLike | null = null;
    let cancelled = false;
    void api
      .request("screen")
      .then((lock) => {
        if (cancelled) void lock.release().catch(() => undefined);
        else sentinel = lock;
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      if (sentinel !== null && !sentinel.released) void sentinel.release().catch(() => undefined);
    };
  }, [active]);
}

/**
 * Groups a long number so it can be read aloud: "4059 1234 5678 8".
 * Left alone when it is short, or when it is not all digits (a URL in a QR code).
 */
function readable(value: string): string {
  if (value.length <= 8 || !/^[0-9]+$/.test(value)) return value;
  return value.replace(/(.{4})/g, "$1 ").trim();
}

export interface CardDisplayDialogProps {
  card: Card | null;
  onClose: () => void;
}

export function CardDisplayDialog({ card, onClose }: CardDisplayDialogProps) {
  const t = useT();
  const markUsed = useMarkCardUsed();
  const open = card !== null;
  useScreenWakeLock(open);

  // One bump per opening, keyed on the card's id so switching cards inside the
  // wallet records both. `markUsed` is stable enough for this: it only closes over
  // the query client, and re-running it on identity change would be harmless.
  const cardId = card?.id ?? null;
  useEffect(() => {
    if (cardId !== null) markUsed(cardId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one bump per opened card
  }, [cardId]);

  if (card === null) return null;

  return (
    <Dialog open={open} onClose={onClose} title={card.label} size="md">
      <div className="flex flex-col gap-4 pb-2">
        {/*
          The white sheet. `bg-white` and `text-black` are literal on purpose — see
          the header. A QR matrix gets a square box, a linear code a wide short one.
        */}
        <div className="flex flex-col items-center gap-3 rounded-card bg-white p-4 shadow-card">
          <div className={card.format === "qr" ? "aspect-square w-full max-w-64" : "h-28 w-full"}>
            <BarcodeImage format={card.format} value={card.value} label={card.label} />
          </div>
          <p className="text-center font-mono text-lg font-semibold tracking-wide text-black">
            {readable(card.value)}
          </p>
        </div>

        <dl className="flex items-center justify-between gap-3 text-sm">
          <div>
            <dt className="text-fg-muted">{t("recipe.cards.form.format.label")}</dt>
            <dd className="font-medium text-fg">{t(CARD_FORMAT_LABEL_KEYS[card.format])}</dd>
          </div>
          {card.note !== null && card.note.length > 0 ? (
            <div className="min-w-0 text-right">
              <dt className="text-fg-muted">{t("recipe.cards.form.note.label")}</dt>
              <dd className="truncate font-medium text-fg">{card.note}</dd>
            </div>
          ) : null}
        </dl>

        <p className="text-sm text-fg-muted">{t("recipe.cards.show.brightnessHint")}</p>
      </div>
    </Dialog>
  );
}
