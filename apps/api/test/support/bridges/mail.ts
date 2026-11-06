/**
 * The test door of `apps/api/src/core/services/mail/index.ts` (docs/EFFECT.md E7, E9; plan `docs/plans/e8-harden.md`
 * P1): moved from `apps/api/src/core/services/mail/index.ts` at E8 (plan e8 P1). The seams `setMailer`, `getMailer` and
 * `isMailerOverridden` stay in `src` (plan e8 P2).
 */
import { Effect } from "effect";
import {
  type MailMessage,
  type MailSendResult,
  getMailer,
  makeMailer,
  plain,
} from "../../../src/core/services/mail/index.ts";

/**
 * Sends a message and NEVER throws: the `MailerService` logic over `getMailer()` (which honours `setMailer`) for a
 * caller that holds no runtime; a failed send is logged and reported back as data. Moved from
 * `apps/api/src/core/services/mail/index.ts` at E8 (plan e8 P1). Callers: `apps/api/test/mail.test.ts`. Promise.
 */
export function trySendMail(message: MailMessage): Promise<MailSendResult> {
  const service = makeMailer(plain(getMailer()));
  return Effect.runPromise(service.trySendMail(message));
}
