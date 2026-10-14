import { createContext, useContext } from "react";
import { ReminderLinkKind } from "../../types/reminder";

interface RemindersApi {
  /** Call after saving or finishing a reminder, so the banner at the top loads again. */
  changed: () => void;
  /** Go to a record a reminder is linked to. */
  openRecord: (kind: ReminderLinkKind, id: number) => void;
}

export const RemindersContext = createContext<RemindersApi>({ changed: () => {}, openRecord: () => {} });

export const useReminders = () => useContext(RemindersContext);
