import type { CalendarMember } from "@toon/shared";
import { Chip } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { PersonDot } from "./PersonDot";

/** `[Alle] [Eric] [Robin] [Kim]` (design §4.2): one selected at a time; `undefined` is everybody. */
export function MemberFilterChips({
  members,
  value,
  onChange,
}: {
  members: ReadonlyArray<CalendarMember>;
  value: string | undefined;
  onChange: (memberId: string | undefined) => void;
}) {
  const t = useT();
  if (members.length < 2) return null;
  return (
    <div role="group" aria-label={t("calendar.common.filterLabel")} className="flex flex-wrap gap-2">
      <Chip label={t("calendar.common.everybody")} selected={value === undefined} onSelect={() => onChange(undefined)} />
      {members.map((member) => (
        <Chip
          key={member.userId}
          label={member.name}
          leadingIcon={<PersonDot colorIndex={member.colorIndex} />}
          selected={value === member.userId}
          onSelect={() => onChange(value === member.userId ? undefined : member.userId)}
        />
      ))}
    </div>
  );
}
