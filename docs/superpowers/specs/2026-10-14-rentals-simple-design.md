# Rentals (simple version) — design

Date: 2026-10-14. Status: draft for the owner's review (not yet approved to build).

The longer study is in `2026-10-14-rental-management-feasibility-and-spec.md`. This is the **small version the owner asked for**: a few tenants (three or four today, built for up to ten), a list of places and tenants, files, a "paid or not paid" check each month, and a button that sends the same rent reminder on WhatsApp.

## What it does

1. **Places**: the owner adds each rented place (name, address, usual monthly rent, notes) and can attach files to it.
2. **Tenants**: the owner adds each tenant (name, WhatsApp number, which place, monthly rent, move-in date, notes) and can attach files (agreement, ID copy, photo).
3. **This month**: one screen listing every current tenant with **Paid** or **Not paid** for the month, a button to mark one paid or undo it, and a button to send the reminders.
4. **Reminders**: one fixed message asking for this month's rent, sent on WhatsApp to the tenants who have not paid.

## Screens (one sidebar item, "Rentals", with three tabs)

- **This month** (opens first). A month switcher; one row per current tenant: name, place, rent, status. **Mark paid** asks for the date (today) and amount (the rent) and a note; **Undo** puts it back to Not paid. Totals: paid X of Y, collected ₹, pending ₹. Earlier months can be looked at the same way. A new month starts with everyone as Not paid.
- **Tenants**. List with add and edit. A tenant who has moved out is marked **Moved out**: they leave the monthly list from that month, their history stays.
- **Places**. List with add and edit; shows the current tenant or "Vacant".

Both forms have a **Files** section: add a PDF, Word file or photo (up to 10 MB each), view it, remove it. This is the same file section used on purchase orders and quotations.

## The reminder, and "one click for everyone"

The message is fixed, with the tenant's details filled in:

> Hello {name}, this is a reminder for your {Month Year} rent of ₹{amount} for {place}. Please pay at your earliest convenience. Thank you.

**Send reminders (N)** opens a small list of the tenants who have not paid. Each has a **Send on WhatsApp** button: it opens that tenant's chat with the message already typed, and **the owner presses Send in WhatsApp**. The row then shows "Reminder opened". For three or four tenants this takes under a minute. There is also a **Copy message** button for each, in case WhatsApp is not signed in on the PC.

**It cannot be literally one click for everyone.** A normal WhatsApp account only lets a link fill in a message; a person must press Send in each chat, and WhatsApp's terms forbid software that sends by itself from a personal number. The options:

| Option | What it takes | Verdict |
|---|---|---|
| **A. List with one button per tenant (above)** | Nothing extra. Free | **Recommended** |
| B. WhatsApp "Broadcast list" on the owner's phone | The owner types or pastes one message and sends it to all in one go. Only tenants who have saved the owner's number receive it. The app can copy the message | Good if one generic message is fine |
| C. Official WhatsApp Business Platform | A Meta business account, a separate number, an approved message template, each tenant's consent, a small fee per message, and a small online service to receive replies | Real one-click, but far too heavy for four tenants |

## Rules

- A place has at most one current tenant.
- WhatsApp numbers: ten digits are treated as Indian (+91); a number typed with another country code is kept as typed. Wrong numbers are rejected with a plain message.
- A tenant cannot be deleted once they have rent history; use **Moved out**.
- A month's rent is "paid" only if it has a paid date. Changing a tenant's rent affects later months; months already marked paid keep the amount recorded.
- Months before a tenant's move-in month are not shown.
- If nobody is unpaid, the reminder button says "Everyone has paid" and is off.
- The month is taken from the PC's date.

## Where the data lives, and what to know

The Rentals tabs are protected by a **PIN** (four to six digits), asked when the owner opens Rentals and again after a few idle minutes. Rental data sits in the **same database as the company records**, so:

- It is **backed up with the company data** (to Google Drive if that is connected). This is good if the PC fails, and not good if other people can see that Drive or use this PC.
- Files are **not encrypted**. The PIN keeps casual viewers out of the screens; it does not protect the database file itself. Windows login and BitLocker do that.
- Tenant ID copies are sensitive. Ask for a **masked Aadhaar** (first eight digits hidden) or another ID, and delete copies when no longer needed. The app does not read the files.
- A forgotten PIN is reset by the developer; there is no self-service reset in this version.

If other people use the PC or the Drive account, the better design is a **separate data file** that is left out of the company backup. That is about one extra task (the database layer currently runs one set of migrations for one file).

## Data (migration 16)

- `rental_places`: name, address, monthly_rent, notes, timestamps.
- `rental_tenants`: place_id, name, whatsapp_number, monthly_rent, move_in_date, moved_out_date, notes, timestamps.
- `rent_months`: tenant_id, month (`YYYY-MM`), paid_on, amount, note, reminded_on; one row per tenant and month; **paid** means `paid_on` is set.
- `rental_files`: owner (place or tenant), file name, type, size, contents, created_at (same checks as other files).
- The PIN is stored as a salted hash in the existing settings table, never as plain digits.
- Change-log triggers and the backup summary line ("rental place", "tenant") like the other records.

## Size

About ten to twelve tasks: migration, rules and tests, PIN, commands, the three tabs, files, WhatsApp opening and the fixed message, docs. Roughly half the size of supplier bills and payments.

## Left out on purpose

Due dates and overdue tracking, late fees, deposits, lease terms and rent increases, receipts, reports, encryption of files, Windows pop-up alerts, automatic sending, editing the message, more than one user.

## Decided with the owner

1. Sending: option A, one button per tenant, the owner presses Send in WhatsApp.
2. Only the owner uses the PC and the backup account, so Rentals sits inside the app behind a PIN and is backed up with the company data. If that changes, move it to a separate data file.
