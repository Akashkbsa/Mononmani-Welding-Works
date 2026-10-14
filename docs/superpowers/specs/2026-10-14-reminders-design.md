# Reminders — design

Date: 2026-10-14. Status: approved in chat; written for the owner's review.

## Purpose

A simple reminder feature inside the app, like a phone reminder app: the owner writes what to do, picks a date and how early to be warned. When the warning time comes, a coloured banner shows at the top of every screen each time the app is open, until the owner presses **Done** or **Dismiss**. Examples: "Collect rent from Joel on the 6th, remind me 2 days before" and "Pay GST on the last day of the month, remind me 3 days before".

## Decisions (made with the owner)

1. **Inside the app only.** No Windows pop-ups, no Google Calendar. Works offline; backed up with the company data.
2. **Repeating reminders:** none, weekly, monthly or yearly. Monthly can be "on the last day of the month".
3. **Banner buttons: Done and Dismiss** (no snooze).
4. **Rent reminders are made by hand** (a monthly reminder linked to the tenant). Marking rent Paid does not clear them.

## A reminder

- **Title** (required) and optional **note**.
- **Date** (`YYYY-MM-DD` stored, `DD-MM-YYYY` shown).
- **Remind me:** on the day, 1, 2, 3 or 7 days before, or a custom number of days (0–365).
- **Repeat:** none / weekly / monthly / yearly. Monthly offers **"last day of the month"**. A monthly reminder set for the 31st falls on the last day of shorter months and returns to the 31st when the month has one; a yearly one on 29 February falls on 28 February in other years.
- **Optional link** to one record: invoice, quotation, purchase order, payment, supplier bill, supplier payment, company (customer or supplier), tenant or place.

## When it shows

For a reminder that is not done and not dismissed, with date *D* and "remind *N* days before", on day *T*:

| Condition | State | Colour |
|---|---|---|
| T < D − N | Waiting (not on the banner) | — |
| D − N ≤ T < D | Coming up ("in 2 days") | amber |
| T = D | Due today | orange |
| T > D | Overdue ("3 days late") | red |

## Top banner

- On every screen above the page, every time the app opens. Shows the reminders that are coming up, due or overdue: overdue first, then by date. Up to 3, then "and N more" which opens the Reminders page.
- Each shows its title, date, the state text and, when linked, the record's name; clicking the title opens the linked record.
- **Done:** a one-time reminder is finished; a repeating one moves to its next date (dismissal cleared).
- **Dismiss:** off the banner for good, kept on the Reminders page as not done. A repeating reminder comes back for its next date after Done; dismissing does not move it.

## Reminders page (sidebar item "Reminders")

Tabs: **Due now** (coming up, due, overdue, including dismissed ones, marked "dismissed"), **Upcoming** (waiting), **Done** (finished one-time reminders). New reminder, edit, delete, mark done, mark not done (for finished one-time reminders), show again on the banner (for dismissed ones).

## "Remind me" on records

Each record's details window (invoice, quotation, purchase order, payment, supplier bill, supplier payment, company) and the tenant and place forms get a **Remind me** button that opens the new-reminder form already linked, with a suggested title (for a tenant: "Collect rent from {name}"), and a short list of that record's reminders that are not done.

## Rules

- A deleted record leaves its reminders in place, shown with "link removed".
- "Today" is the PC's local date.
- Stored in a new table in the same database (new migration), tracked in `change_log` with a backup summary line ("reminder"/"reminders"), so the existing backup covers it.

## Left out

Times of day, snooze, Windows notifications, Google Calendar, automatic rent reminders from tenants, attachments on reminders, more than one link per reminder.
