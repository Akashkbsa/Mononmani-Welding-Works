/**
 * Windows and SQLite problems that depend on the PC (disk full, antivirus, a file open elsewhere)
 * reach the screen as technical text such as "os error 112". This puts a sentence saying what to
 * do in front of it; the original text stays after "Details:" so support can still read it.
 */

const DISK_FULL = "The computer's disk is full. Free some space (empty the Recycle Bin, delete old downloads) and try again.";
const BLOCKED =
  "Windows did not let the app save to its data folder. If an antivirus or Controlled folder access is on, allow Mononmani Welding Works and try again.";
const IN_USE = "The file is open in another program. Close it and try again.";
const DISK_FAULT =
  "The disk could not be read or written. Restart the computer and try again; if it keeps happening, the disk may be failing, so back up now.";
const BUSY = "The data is busy for a moment. Wait a few seconds and try again.";
const DAMAGED = "The database file is damaged. Restore the latest backup in Settings, Backup.";

/** Windows error numbers ("os error N") and what to tell the owner. */
const OS_ERRORS: Record<number, string> = {
  5: BLOCKED, // access denied
  19: BLOCKED, // write protected
  32: IN_USE, // sharing violation
  33: IN_USE, // lock violation
  39: DISK_FULL, // handle disk full
  112: DISK_FULL, // not enough space on the disk
  225: BLOCKED, // blocked as a virus
  1392: DISK_FAULT, // file or folder corrupted
};

const SQLITE_ERRORS: [RegExp, string][] = [
  [/database or disk is full/i, DISK_FULL],
  [/attempt to write a readonly database/i, BLOCKED],
  [/disk I\/O error/i, DISK_FAULT],
  [/database disk image is malformed|file is not a database/i, DAMAGED],
  [/database is (locked|busy)/i, BUSY],
];

/** The plain sentence for a PC problem in `text`, or null when it is an ordinary message. */
export function plainReason(text: string): string | null {
  const os = /os error (\d+)/i.exec(text);
  if (os && OS_ERRORS[Number(os[1])]) return OS_ERRORS[Number(os[1])];
  for (const [pattern, reason] of SQLITE_ERRORS) {
    if (pattern.test(text)) return reason;
  }
  return null;
}

/** `text` with the plain sentence in front when it is a PC problem; otherwise unchanged. */
export function plainError(text: string): string {
  const reason = plainReason(text);
  if (!reason || text.startsWith(reason)) return text;
  return `${reason} Details: ${text.length > 200 ? `${text.slice(0, 200)}…` : text}`;
}
