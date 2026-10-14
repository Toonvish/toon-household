import type { LocaleCatalog } from "@toon/shared";
import type { FinanceParticipantsCatalog } from "./participants.de.ts";

export const financeParticipantsEn: LocaleCatalog<FinanceParticipantsCatalog> = {
  "finance.module.name": "Finances",
  "finance.participants.title": "Finances: participants",
  "finance.participants.description":
    "The household budget settles between exactly two people. Slot 1 anchors the balance.",
  "finance.participants.slot1": "Slot 1",
  "finance.participants.slot2": "Slot 2",
  "finance.participants.save": "Save participants",
  "finance.participants.saved": "Participants saved",
  "finance.participants.sameMember": "Please choose two different people.",
  "finance.participants.adminOnly": "Only owners and admins can change the participants.",
  "finance.participants.needsTwoMembers":
    "The household budget needs at least two members. Invite someone first.",
  "finance.participants.enableTitle": "Enable finances",
  "finance.participants.notParticipantTitle": "You are not part of the household budget",
  "finance.participants.notParticipantBody": "{first} and {second} keep this household's budget.",
  "finance.participants.notParticipantAdminHint":
    "Owners and admins can change the participants in Settings.",
  "finance.participants.toSettings": "Go to Settings",
};
