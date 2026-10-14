import { ReactNode } from "react";
import { Button, Card, RowChevron, rowClass, rowProps, SectionTitle } from "../ui";

/** A titled card with a "see all" link, used for each short list on the dashboard. */
export function ListCard({
  title,
  actionLabel,
  onAction,
  empty,
  isEmpty,
  note,
  children,
}: {
  title: string;
  actionLabel: string;
  onAction: () => void;
  empty: string;
  isEmpty: boolean;
  /** A small line under the list, e.g. "Showing the oldest 5 of 12". */
  note?: string;
  children: ReactNode;
}) {
  return (
    <Card className="flex h-full flex-col p-5">
      <SectionTitle
        action={
          <Button size="sm" variant="ghost" onClick={onAction}>
            {actionLabel}
          </Button>
        }
      >
        {title}
      </SectionTitle>
      {isEmpty ? <p className="py-6 text-center text-sm text-slate-500">{empty}</p> : <table className="w-full text-sm"><tbody className="divide-y divide-slate-100">{children}</tbody></table>}
      {note && (
        <div className="mt-auto pt-3">
          <p className="border-t border-slate-100 pt-3 text-xs text-slate-500">{note}</p>
        </div>
      )}
    </Card>
  );
}

/** One line of a list card: a name and detail on the left, an amount or status on the right. */
export function ListRow({
  title,
  detail,
  right,
  rightNote,
  rightTone = "default",
  onOpen,
}: {
  title: string;
  detail?: string;
  right: ReactNode;
  rightNote?: string;
  rightTone?: "default" | "warn" | "good";
  onOpen: () => void;
}) {
  const tone = rightTone === "warn" ? "font-medium text-amber-700" : rightTone === "good" ? "text-emerald-700" : "text-slate-500";
  return (
    <tr {...rowProps(onOpen)} className={rowClass}>
      <td className="w-full max-w-0 py-2.5">
        <div className="truncate font-medium text-slate-900" title={title}>
          {title}
        </div>
        {detail && <div className="truncate text-xs text-slate-500">{detail}</div>}
      </td>
      <td className="whitespace-nowrap py-2.5 pl-3 text-right tabular">
        <div>{right}</div>
        {rightNote && <div className={`text-xs ${tone}`}>{rightNote}</div>}
      </td>
      <RowChevron />
    </tr>
  );
}
