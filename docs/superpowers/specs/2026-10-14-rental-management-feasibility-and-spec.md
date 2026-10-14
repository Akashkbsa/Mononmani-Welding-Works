# Rental management — feasibility assessment and feature specification

Date: 2026-10-14. Status: **draft for the owner's review; nothing is approved to build.**

**The owner asked for a much smaller version (three to ten tenants, files, a monthly paid/not-paid check and one fixed WhatsApp reminder). That version is in `2026-10-14-rentals-simple-design.md`. This longer study stays as the reference for anything bigger.**

This is a feasibility study and a feature specification, not legal advice. Anything marked **(confirm)** should be checked with the client's chartered accountant or lawyer before it is relied on.

## 1. Verdict

**Feasible.** Property, tenant, tenancy and rent tracking, due and overdue alerts, and a prefilled WhatsApp reminder are all buildable on the current stack (Tauri 2, Rust, SQLite, React) with high confidence. Two parts need care: tenant identity documents (a privacy and legal risk, not a technical one) and WhatsApp (it cannot be fully automatic from a personal number).

| Capability | Verdict | Why |
|---|---|---|
| Properties, tenants, tenancies, rent terms | Yes, straightforward | Same patterns as invoices, customers and quotations already in this app |
| Rent schedule, mark collected, history, outstanding | Yes | Same allocation idea as customer payments; adds a date-schedule generator |
| Due and overdue alerts inside the app | Yes | Worked out whenever the app opens; always correct |
| Windows pop-up notifications | Partly | Only while the app is running (the app has no background service and no server). If the PC is off, nothing fires |
| Prefilled WhatsApp reminder the owner sends | Yes, low effort | A `wa.me` link opens the chat with the text filled in; **the owner must press Send** |
| Fully automatic WhatsApp from the owner's own number | **No — do not build** | WhatsApp's terms prohibit automated messaging and there is no official API for personal accounts; accounts get banned |
| Automatic WhatsApp through the WhatsApp Business Platform | Possible, heavy, not for the MVP | Needs a Meta business account, a dedicated number, approved templates, tenant opt-in, per-message fees, and a public web address to receive delivery status and replies, which an offline desktop app does not have |
| Storing tenant ID documents (Aadhaar, PAN) | Technically yes; legally and ethically the riskiest part | Recommend collecting as little as possible, encrypting everything, and a retention limit (section 8) |

Rough size: the MVP in section 13 is about **1.5 to 2 times the size of the supplier bills and supplier payments feature** just built (that was 17 tasks and 47 new tests), mainly because of the new lock screen, encryption and the rent schedule.

**Three decisions are needed before any build** (details in sections 3, 8 and 9): whether rentals live in a separate app, whether ID copies are stored at all, and whether reminders are "assisted" (owner presses Send) or the owner wants true automation and accepts the cost and complexity.

## 2. Assumptions

Please correct any that are wrong.

1. The client is an **individual landlord in India** (probably Puducherry or Tamil Nadu, since the company's invoices treat Puducherry, state code 34, as the home state), amounts in rupees only.
2. About **10 to 50 rented units**; mostly monthly rent; mix of residential and small commercial.
3. **One user on one Windows PC.** The app is offline, has no server and no phone version, and phone access is not part of the MVP.
4. The rental data must be **kept apart from the company's** invoices, exports and Google Drive backup.
5. Only the owner should see the rental data. It is **not known whether staff or the accountant use the same PC**.
6. The owner sends WhatsApp messages from their phone's WhatsApp (personal or the free Business app), and can use WhatsApp Desktop or WhatsApp Web on the PC.
7. Tenants' mobile numbers are WhatsApp numbers.
8. Rent is received **outside the app** (cash, UPI, bank, cheque). The app records it; it does not move money.
9. No GST or TDS filing support in the MVP (flagged as a question in section 16).
10. Reminders in English and Tamil are useful.
11. The existing company app stays unchanged.

## 3. Where the feature lives (keeping it separate)

The company app today stores everything in one database under `%APPDATA%\com.manonmani.app\`, and its Google Drive backup uploads a full copy of that database. Its Settings page also has a button that opens that data folder "for backups". Rental data placed in the same folder or database would travel with every company backup and every folder copy given to an accountant.

| Option | What it is | Separation | Cost |
|---|---|---|---|
| A. Inside this app | A "Rentals" area with its own database file and a lock screen | Medium: same installer, same Windows folder, same Google backup code | Lowest |
| **B. Separate app (recommended)** | A second small app with its own icon, installer, data folder (`com.manonmani.rentals`), lock and backup, reusing the same code pieces | High: nothing is shared at runtime, so a company backup or data-folder copy cannot contain rental data | A second installer and a shared-code setup; roughly one to two extra days |
| C. Same database | New tables beside invoices | None | Not recommended |

**Recommendation: B.** It is the only option that actually meets "separate from the company's business". If the client confirms that only they ever touch the PC, A is an acceptable cheaper route, provided it still gets its own database file, its own lock, and is **excluded from the existing Drive backup**.

Reuse either way: the file validation in `attachments.rs`, the migration framework, the backup snapshot pattern (VACUUM copy, integrity check, hashes), Windows Credential Manager access (already used for Google tokens), the money and date helpers, the UI kit, and the Rust test harness.

Note for the developer: the company's invoice screens deliberately dropped due dates and overdue tracking. Rentals need them by nature (rent has a due date), so this is a different rule set, not a regression.

## 4. Property records

One record is one rentable unit (a flat, shop, house, godown or plot). Building-level grouping is a label, not a separate table, to keep the MVP simple.

| Field | Required | Notes |
|---|---|---|
| Name / label | Yes | e.g. "Flat 2B, Lakshmi Apartments"; unique |
| Building / complex | No | Groups units in lists |
| Type | Yes | House, Flat, Shop, Office, Godown, Land, Other |
| Address lines, city, state, PIN | Yes (address, city) | State defaults to the home state |
| Area (sq ft) | No | |
| Furnishing | No | Unfurnished, semi, furnished |
| Ownership note | No | Sole, joint, with percentage |
| Property tax / assessment number | No | For reference only |
| Electricity service number, water connection number | No | Handy when disputes or transfers arise |
| Expected rent | No | Used for vacancy planning and the "vacant" list |
| Notes | No | |
| Status | Derived | Vacant or Occupied from the current tenancy; never typed |
| Documents | No | Sale deed copy, tax receipts, EB bills (Standard sensitivity) |

Rules: a property cannot be deleted once it has had a tenancy; it can be **archived**. Two active tenancies on one property are refused (co-tenants share one tenancy).

## 5. Tenant records

Principle: collect what the owner needs to run a tenancy and to meet any police verification duty, and nothing else.

| Group | Fields |
|---|---|
| Needed | Full name; mobile number (stored with country code, default +91; this is the WhatsApp number) |
| Optional | Alternate number; email; permanent address; emergency contact name and number; kind (individual or business; for a business: business name and optional GSTIN); number of occupants |
| ID **reference only** | ID type (Aadhaar, Voter ID, Driving licence, Passport, other); **last four characters only**; "seen on" date |
| Verification | Police verification status (not required / pending / submitted), date, acknowledgement reference |
| Consent record | "Agrees to reminders on WhatsApp" yes/no and date; "privacy notice given" date; **Do not message** flag |
| Never collected | The full Aadhaar number; fingerprints or any biometric; PAN of an individual tenant; bank account or card numbers; religion, caste, marital or family details; health information; income details |

Why no tenant PAN: a landlord does not generally need the tenant's PAN. It is the landlord's PAN that tenants ask for (rent receipts, HRA, TDS). A business tenant may need TDS paperwork, so an optional PAN field exists for **business tenants only**, off by default **(confirm)**.

Co-tenants: a tenancy has a primary tenant and optional co-tenants (each with the same minimal fields). Tenants are archived, not deleted, once they have rent history.

## 6. Tenancy and rent terms

A tenancy joins one property, one primary tenant (and optional co-tenants), and a set of terms.

| Term | Details |
|---|---|
| Start date, end date | End optional (open-ended); a renewal alert fires N days before the end (default 30) |
| Agreement type | Registered, notarised, 11-month unregistered, verbal; informational |
| Rent amount | Rupees per period, with paise |
| Maintenance / other recurring amount | Optional fixed add-on included in each charge |
| Payment frequency | Monthly (default), quarterly, half-yearly, yearly |
| Due day | A day from 1 to 28, or "last day of the month". A day beyond the month's end (30 or 31) is not offered, so February is never an exception |
| Paid in advance or in arrears | Advance (default): rent for a month is due in that month. Arrears: due in the next month |
| Grace days | Days after the due date before a charge counts as overdue (default 0) |
| Late fee | MVP: a free-text note only. Calculation is Phase 2 |
| Rent revisions | A list of "new rent from this date" entries. Phase 2 adds automatic yearly increase suggestions |
| First or last partial period | The first and last charge amounts can be overridden by hand (no automatic pro-rating in the MVP) |
| Security deposit | Amount, received date, mode; at move-out: deductions with reasons and refund amount and date |
| Lock-in months, notice period | Informational, shown in alerts |
| Notes | Free text |

Tenancy status is derived: Upcoming (starts in the future), Active, Notice given (a move-out date is set), Ended.

## 7. Rent tracking

**Charges.** For each tenancy the app generates one charge per rent period ("Rent for November 2026", amount, due date). Generation is automatic and repeatable: when the app opens and whenever terms change, it creates any missing charges up to one period ahead. It never creates charges forever, never duplicates, and never alters a charge that already has money allocated to it (only future unpaid charges follow a rent revision).

**Marking rent as collected.** On a charge, **Mark collected** asks for: amount (defaults to what is still due), date received (defaults to today), mode (cash, UPI, bank transfer, cheque), reference or UTR, and a note.
- A smaller amount leaves the charge **partly paid**; further payments add to it.
- A larger amount, or one covering several months, is allocated to the oldest unpaid charges first; any remainder is held as **credit** on the tenancy and applied to the next charges as they are generated.
- Payments can be edited or deleted; each change is written to the audit log. A bounced cheque is recorded as a reversal, not erased.

**Status of a charge** (worked out, never typed): Upcoming, Due soon (inside the reminder window), Due today, Overdue (past the due date plus grace), Partly paid, Paid.

**History and outstanding.**
- Per tenancy: a ledger of charges, payments and a running balance.
- Per property and per tenant: the same lists across their tenancies.
- Portfolio: expected this month, collected this month, outstanding, overdue count and amount, and overdue by age (1 to 7, 8 to 30, over 30 days).
- Filters by date range, property, tenant and status; export to CSV.
- Overdue always uses the PC's local date. The dashboard shows the date it used, and warns if the computer's date looks wrong.

## 8. Document management

### 8.1 What can be stored

| Category | Sensitivity | Examples |
|---|---|---|
| Agreement | Standard | Rent agreement, renewal, notice |
| Property | Standard | Sale deed copy, tax receipts, EB bills |
| Receipts | Standard | Deposit receipt, rent receipts |
| **ID proof** | **Sensitive** | Voter ID, driving licence, passport, masked Aadhaar |
| **Photo** | **Sensitive** | Tenant photograph (for example for the police form) |
| **PAN** | **Sensitive** | Business tenants only, off by default |

### 8.2 Principles

Minimum collection, one stated purpose per document, need-to-know access, a retention limit, encryption, and no sharing from the app. The app never sends documents anywhere, including over WhatsApp.

### 8.3 Aadhaar and PAN: what the law says and what to do

- **Aadhaar Act, 2016.** Section 29(4) bars publishing or displaying an Aadhaar number publicly. Section 29(3), section 37 (disclosure penalties) and section 40 are written for "requesting entities" and "offline verification-seeking entities", that is, parties that verify Aadhaar through UIDAI's systems. A landlord holding a photocopy is **not clearly** one of those, and the position is unsettled. UIDAI issued an advisory in May 2022 saying unlicensed private entities should not collect or keep Aadhaar photocopies, but **withdrew it the same day**. The safe design is to behave as if the strictest reading could apply (sources in section 17).
- **Digital Personal Data Protection Act, 2023.** Section 3(c)(i) excludes data "processed by an individual for any personal or domestic purpose". A landlord renting several properties for income may well fall outside that exclusion; this is untested. **Assume the Act applies.** The Rules were notified in November 2025 with an 18-month phase-in, so the main duties (notice, consent, reasonable security safeguards, breach notification, and a reply to access, correction or erasure requests within 90 days) apply from about **mid-May 2027**. The Act sets penalties up to ₹250 crore for failing to maintain reasonable security safeguards (a statutory ceiling, not a prediction). Building to this standard now costs little and avoids rework.
- **Police verification.** Many places require landlords to submit tenant details and an ID copy to the police. Puducherry reportedly has an online CCTNS tenant-verification service, but the only source found was a third-party guide and it did not confirm that filing is compulsory **(confirm with the local police station)**. This is the one clear, lawful reason to hold an ID copy, and it is short-lived.

**Rules the software enforces:**
1. **Default to holding no ID copy.** Record ID type, last four characters and the date seen.
2. If a copy is needed, accept **masked Aadhaar** (first eight digits hidden, downloadable from UIDAI) or another ID. The upload dialog for an Aadhaar document requires ticking "this copy is masked" and shows a warning.
3. The full 12-digit Aadhaar number is never stored in a field. Free-text fields warn if a 12-digit number is typed.
4. PAN is accepted only for business tenants.
5. Sensitive documents are never exported, never uploaded to any cloud by default, and never put into a WhatsApp message.

### 8.4 Storage and security

- **Encryption at rest.** Every document is stored as an AES-256-GCM encrypted blob inside the rentals database, and so are the few sensitive text fields. Nothing is readable by opening the file.
  - *Alternative considered:* whole-database encryption with SQLCipher. It is stronger but needs an OpenSSL build on this machine's MinGW toolchain, which is uncertain; treat it as a build-risk spike and fall back to the blob-level approach.
- **Keys.** A random 256-bit data key is wrapped by a key derived from the owner's passphrase (Argon2id). A printed **recovery code** is generated once. Optional "remember on this PC" stores the key in Windows Credential Manager, trading convenience for exposure to anyone logged in as that Windows user.
- **Loss.** If the passphrase and recovery code are both lost, encrypted documents are **permanently unreadable**, including from backups. The setup screen says this plainly.
- **Viewing.** Images are decoded in memory and shown inside the app. PDFs and Word files need a short-lived decrypted copy in a dedicated temp folder; it is deleted when the app locks, closes, or after a few minutes, and the folder is emptied on every start (the existing app already does this).
- **Upload checks.** The existing 10 MB limit, extension list and real-contents check are reused (JPG, PNG, PDF, DOC, DOCX).
- **Deletion.** Deleting a document removes the encrypted blob; the database runs with secure delete on and compacts regularly so the bytes do not linger.
- **Backups.** Separate from the company backup, always. Default: an encrypted local backup file the owner saves to a folder or USB drive of their choosing. A cloud copy is optional, only to the owner's **personal** account, behind an explicit warning, and the documents inside stay encrypted. The company's Google account is never used.
- **The PC.** Recommend BitLocker or Windows device encryption and a separate Windows login if anyone else uses the machine.

### 8.5 Access control

- A single owner. "Permissions" here means what the lock allows.
- **Lock screen** on launch and after an idle period (default 5 minutes). Failed attempts slow down. The passphrase is never stored.
- **Step-up** for Sensitive documents: viewing, downloading or deleting asks for the passphrase again if it has not been entered in the last 10 minutes.
- An **audit log** records unlock, view, upload, delete, export, backup and restore (what and when, never the content).
- No network sharing, no remote access, no multi-user accounts in the MVP.

| Action | Locked | Unlocked | Needs passphrase again |
|---|---|---|---|
| See the dashboard, properties, tenants, rent | No | Yes | No |
| Record or edit a payment | No | Yes | No |
| View a Standard document | No | Yes | No |
| View, download or delete a Sensitive document | No | No | **Yes** |
| Export CSV or create a backup | No | Yes | No (confirm dialog) |
| Restore a backup, change the passphrase | No | No | **Yes** (and the recovery code to restore on a new PC) |

### 8.6 Tenant rights and retention

- A one-page **privacy notice** (what is collected, why, how long, who sees it, how to ask for correction or deletion) that the owner can print and give at move-in. The date it was given is recorded.
- Deletion and correction requests are handled from the tenant screen and logged.
- **Proposed retention defaults (confirm):** ID and photo copies: delete 90 days after the police acknowledgement is recorded, or at move-out plus 90 days, whichever is first, with a reminder; agreements and rent records: tenancy plus at least 3 years (the usual limitation period for money claims) or longer if the CA advises for tax records. The owner can delete earlier at any time.
- **If the PC is lost or stolen:** documents are encrypted, so the risk is low; the note in the app says to change passphrases and restore from the encrypted backup on a new PC.

## 9. Reminders and WhatsApp

### 9.1 Telling the owner (rent due or overdue)

| Mechanism | Works when | MVP |
|---|---|---|
| Dashboard panel and a sidebar badge: Due soon, Due today, Overdue | The app is open | Yes |
| "Since you last opened" summary | The app was closed for days | Yes |
| Windows notification (pop-up) | The app is running (optionally set to start with Windows and sit in the tray) | Phase 2 |
| Phone calendar export (.ics file of due dates) | Always, on the phone; needs re-import after changes | Phase 2 |

Honest limit: a desktop app that is not running cannot alert anyone. The summary on open and the optional start-with-Windows are the mitigations. Default schedule: 3 days before the due date, on the due date, then 1, 7, 15 and 30 days overdue, all adjustable. Each alert can be snoozed or marked "tenant promised to pay on <date>".

### 9.2 WhatsApp to the tenant: assisted, always confirmed by the owner

**How it works.**
1. The Reminders screen lists charges that need a message.
2. The owner clicks **Prepare**; the app fills a template (editable) with the tenant's name, property, month, amount, due date and the owner's payment details (UPI ID or bank, set once in Settings).
3. **Open in WhatsApp** opens `https://wa.me/<number>?text=<message>`. WhatsApp opens the chat with the text in the box.
4. **The owner reviews it and presses Send in WhatsApp.** The app cannot press Send, and cannot know whether it was sent.
5. The app asks "Did you send it?" and records the answer in the reminder log.

**Technical requirements.**
- The link uses the number as digits only with the country code (91 + ten digits for India) and the message encoded as UTF-8 percent-encoding, so Tamil text and line breaks work. The vendor documentation reviewed gives this format; WhatsApp's own help page for click-to-chat could not be loaded here, so **test the exact behaviour on the client's PC and phone**. Keep messages short (a few hundred characters); no length limit could be confirmed from a primary source.
- The app opens the link through the system opener (the Tauri opener plugin the app already uses). Only links starting `https://wa.me/` are allowed.
- The PC needs WhatsApp Desktop installed and signed in, or WhatsApp Web with a QR login. Windows may ask once for permission to open WhatsApp.
- Fallbacks when WhatsApp is not set up: **Copy message** and **Copy number** buttons.
- If the number is not on WhatsApp, WhatsApp shows an error; the app cannot detect this beforehand. Keep an alternate number field.

**User confirmation is required, by design and by platform.** This is not a missing feature: a click-to-chat link can only prefill a message.

**Several tenants at once.** "Remind all overdue" opens a queue, **one chat at a time**, each needing the owner's Send. It never loops by itself.

**Message rules.** Factual and polite; no threats; no ID details; no other tenants' information; honour the **Do not message** flag. Tone variants (friendly, formal, final notice) in English and Tamil.

**Consent.** A person-to-person message from the owner's own WhatsApp needs no platform opt-in, but record the tenant's agreement to receive reminders on WhatsApp at move-in as good practice and for data-protection notice purposes.

**Which WhatsApp account.** WhatsApp's terms bar "bulk messaging, auto-messaging, auto-dialing" and "any non-personal use of our Services unless otherwise authorized". Collecting rent from many tenants is closer to business use, so the sanctioned route is the **free WhatsApp Business app** on the owner's phone (a personal account is likely to work but is less defensible). Question 10 asks which the client uses.

### 9.3 Automatic WhatsApp: what it would take (not for the MVP)

| Requirement | Detail |
|---|---|
| Meta account | A Meta business account and WhatsApp Business Account, usually business-verified to raise sending limits |
| A number | A phone number dedicated to the API. It cannot also be used on ordinary WhatsApp. "Coexistence" lets a number already on the Business app run the app and the API together, but its availability in India was reported inconsistently, so verify |
| Opt-in | The Business Messaging Policy requires each recipient's opt-in before the business messages them |
| Templates | Business-initiated messages must use pre-approved templates. A rent-due reminder is a "payment reminder", which Meta lists as a **utility** example, but Meta decides the category and can re-categorise to marketing (approved as marketing since April 2025 if it judges so). Free-form replies are possible only inside the 24-hour window after the tenant last wrote |
| Cost | Per-message pricing since 1 July 2025. India utility is quoted around ₹0.115 and marketing around ₹0.86 per message in 2026 by vendors (check Meta's rate card), plus GST and often a provider fee. From 1 October 2026 Meta also charges for service and in-window utility messages. For 20 tenants this is a few rupees a month; **cost is not the obstacle** |
| Receiving status and replies | Delivery status and tenant replies arrive by webhook to a **public HTTPS address**. An offline desktop app has none, so this needs a small cloud service or a provider's dashboard. That service would hold tenants' phone numbers, adding a privacy surface and ongoing running cost |
| Sender identity | Messages show the business name/number, not the owner's personal number; tenants' replies land in the API inbox, not the owner's phone app, unless coexistence or a provider inbox is used |
| Security | A long-lived access token must be stored safely (Credential Manager) |

Conclusion: automation is possible but changes the product from "an offline desktop notebook" into "a desktop app plus a cloud service plus a Meta account". Revisit only if the client insists on hands-off reminders after living with the assisted version.

**Do not** use unofficial libraries that drive a personal WhatsApp account (the "WhatsApp Web automation" family). They break the terms, WhatsApp says it pursues bulk and automated senders, and the account the client uses for everything could be banned. SMS in India needs TRAI DLT registration of sender and templates, which is too heavy for one landlord; email is possible later if tenants use it.

## 10. Screens and user flows

**Screens**
1. **Lock** — passphrase; first-run setup (passphrase, recovery code, backup folder).
2. **Rentals dashboard** — totals (expected, collected, outstanding), lists for Due soon, Overdue, Vacant properties and Agreements ending soon; "Since you last opened".
3. **Properties** — list with status, detail, form; archive.
4. **Tenants** — list, detail (tenancies, payment history, documents, consent), form; archive.
5. **Tenancies** — list; a **new tenancy** wizard (property, tenant, dates, rent terms, deposit, agreement upload); detail with ledger and terms; revise rent; end tenancy and settle deposit.
6. **Rent ledger and Mark collected** — per tenancy, plus a portfolio-wide "Collect" view.
7. **Reminders** — queue, message templates editor, log.
8. **Documents** — within a tenant, tenancy or property (no global browser); retention due list.
9. **Reports** (Phase 2) — income by month, year and property; CSV.
10. **Settings** — owner name and payment details, templates, reminder days, lock timing, backup, retention, privacy notice.

**Key flows**
- *First use:* set passphrase → record recovery code → add property → add tenant → create tenancy (charges appear) → record a first payment.
- *Monthly:* open → read the dashboard → **Mark collected** for what came in → **Prepare** reminders for the rest → send each in WhatsApp → confirm.
- *Move-in:* tenancy wizard → give the privacy notice (tick) → record ID reference → optional document → police verification status.
- *Move-out:* set notice → on the day, **End tenancy** → settle the deposit (deductions, refund) → property turns Vacant → retention reminder for any ID copies.
- *Lost PC:* install the app → restore the encrypted backup → enter the recovery code.

## 11. Errors and edge cases

| Situation | Behaviour |
|---|---|
| Invalid or short mobile number | Inline error; Indian numbers must be ten digits starting 6 to 9; other country codes accepted |
| Same mobile on two tenants | Warning, allowed (family members) |
| WhatsApp not installed or not signed in | Link opens WhatsApp Web or an error; the message stays on screen with Copy buttons |
| Number not on WhatsApp | Cannot be detected; the log stays "not confirmed" until the owner says it was sent |
| Non-English text | UTF-8 encoding; Tamil tested; very long text is trimmed with a warning |
| Overlapping tenancy on a property | Refused unless it is the same tenancy with co-tenants |
| Due day on the 31st | Not offered; "last day of month" is |
| Rent changed mid-tenancy | Applies only from the effective date to unpaid future charges; paid charges untouched |
| Move-out mid-period | Last charge amount editable; remaining unpaid future charges are removed |
| Payment entered against the wrong tenancy | Edit or delete with an audit trail; moves allocations, never silently |
| Same payment entered twice (double click) | Button locks while saving; a payment with the same tenancy, date, amount and reference triggers a "possible duplicate" confirm |
| Overpayment | Held as credit and applied to the next charges |
| Future-dated payment | Allowed with a clear note; not counted as received until its date |
| App closed for weeks | Missed charges are generated on open and the summary lists what became overdue |
| PC date wrong | The dashboard shows the date used and a warning if it is more than a few days from the last recorded activity |
| Wrong passphrase | Increasing delay; no hints stored |
| Passphrase and recovery code lost | Documents unrecoverable; stated at setup. The rent records remain readable |
| Restore from a newer or foreign file | Refused with a plain message |
| Corrupt or disguised upload | Rejected by the real-contents check |
| Disk full or backup folder missing | Backup fails visibly; never reported as done |
| Deleting a tenant or property with history | Blocked; archive instead |
| 12-digit number typed into a note | Warning that this looks like an Aadhaar number |

## 12. Data model sketch

| Table | Key columns |
|---|---|
| `properties` | label, building, type, address, city, state, pin, area, furnishing, ownership_note, tax_no, electricity_no, water_no, expected_rent, notes, archived_at |
| `tenants` | name, kind, business_name, gstin, mobile_e164, alt_mobile, email, address, emergency_name, emergency_mobile, id_type, id_last4, id_seen_on, police_status, police_ref, police_date, whatsapp_consent, whatsapp_consent_on, do_not_message, privacy_notice_on, archived_at |
| `tenancies` | property_id, primary_tenant_id, start/end, status, agreement_kind, lock_in, notice_days, rent, maintenance, frequency_months, due_day, in_advance, grace_days, deposit fields, move_in/out |
| `tenancy_tenants` | tenancy_id, tenant_id, role |
| `rent_revisions` | tenancy_id, effective_from, rent, maintenance |
| `rent_charges` | tenancy_id, period_start/end, due_date, label, amount, kind |
| `rent_payments`, `rent_allocations` | payment: tenancy_id, paid_on, amount, mode, reference; allocation: payment_id, charge_id, amount |
| `reminder_log` | charge_id, kind, channel, prepared_at, confirmed_sent |
| `documents` | owner_kind, owner_id, category, sensitivity, file_name, mime, size, nonce, ciphertext, retain_until |
| `audit_log` | at, action, subject |
| `crypto_meta` | salt, KDF parameters, wrapped data key, check value, version |
| `settings` | owner details, payment instructions, templates, reminder days, timeouts |

Money is stored as rupees with paise and rounded the same way as elsewhere in the company app; dates as `YYYY-MM-DD`.

## 13. Phased plan

**Phase 0 — decisions (before any code).** Answers to section 16 and a short check with the client's CA or lawyer on documents, GST on commercial rent, and retention.

**Phase 1 — MVP (about 25 to 30 plan tasks).**
- App shell for the separate app (or the Rentals area), passphrase lock, idle lock, recovery code.
- Properties, tenants (minimal fields, no ID copies), tenancies with rent terms and deposit.
- Charge generation, **Mark collected** (partial, advance, multi-month), history, outstanding and overdue, dashboard.
- In-app reminders and the "since you last opened" summary.
- **Assisted WhatsApp** reminders with editable English and Tamil templates, reminder log.
- Agreement and property documents (Standard), encrypted.
- Encrypted local backup and restore; CSV export of the ledger.
- Tests through the existing Rust harness; UI checked by type-check and build.

**Phase 2.**
- Sensitive-document vault with step-up access and retention reminders; printable privacy notice; consent records.
- Windows notifications, start with Windows and tray; phone calendar export.
- Rent receipts (printed or as a WhatsApp message), automatic yearly increase suggestions, late-fee calculation, deposit settlement screen, renewal alerts.
- Reports by month, year and property; import from a CSV of existing tenants.

**Phase 3 (only if wanted).**
- WhatsApp Business Platform or coexistence, with a small relay service; SMS or email.
- Expense tracking (repairs, property tax) and net income; GST and TDS helpers for commercial tenants.
- Read-only phone view; several users.

## 14. Key technical dependencies

- Windows 10/11 with WebView2 (as today); the Tauri 2 / Rust / SQLite / React stack.
- New Rust libraries for encryption: `aes-gcm`, `argon2`, `zeroize`; optional `tauri-plugin-notification`, `tauri-plugin-autostart` and the tray feature (Phase 2); SQLCipher only if the build spike succeeds.
- Existing pieces to reuse: `attachments.rs`, the migration framework, the backup snapshot code, Windows Credential Manager (`keyring`), the UI kit, the test harness.
- For WhatsApp assisted mode: WhatsApp Desktop or Web signed in on the PC, an internet connection, and the system opener.
- For a separate app: a second identifier and installer, and a way to share code (a Cargo workspace, or copying the few shared modules at first).

## 15. Risks

| Risk | Likelihood / impact | Mitigation |
|---|---|---|
| Tenant ID data exposed (staff, accountant, a copied folder, a lost PC) | Medium / high | Separate app, lock, encryption, minimal collection, retention, no cloud by default |
| Rental data leaks through the company's Drive backup | High if shared / high | Separate data folder and backup; never reuse the company's Google account |
| Aadhaar or data-protection non-compliance | Medium / high | Hold no ID copy by default, masked Aadhaar only, notice and consent records, deletion; legal check before Phase 2 |
| Owner expects fully automatic WhatsApp | High / medium | State clearly in the demo that Send is the owner's click; offer Phase 3 only with costs shown |
| Reminders missed because the PC was off | High / medium | Summary on open, start with Windows, calendar export |
| Lost passphrase and recovery code | Low / high (documents) | Recovery code at setup, repeated reminders, rent records stay readable |
| Wrong overdue amounts from a wrong PC date | Low / medium | Show the date used; warn on odd dates |
| WhatsApp changes its link behaviour or terms | Low / medium | Copy buttons as a fallback; links built in one place |
| Scope creep into accounting, GST and TDS | Medium / medium | Out of scope until the CA answers section 16 |
| A second app means double maintenance | Medium / low | Share code through a workspace; keep the rentals app small |
| SQLCipher build trouble on this toolchain | Medium / low | Blob-level encryption needs no extra toolchain |
| Single PC is a single point of failure | Medium / medium | Encrypted backups to a second location, tested restore |

## 16. Questions to answer before implementation

**Who and where**
1. Does anyone besides the owner (staff, accountant, family) use the PC? Is a separate Windows login practical?
2. Is the preference a separate app (recommended) or an area inside the company app?
3. How many properties and tenants now and in two years? Residential, commercial, or both? Any building with many units?
4. Which state and city? (Decides police verification and local rules.)

**Tenancy terms**
5. Is rent always monthly? Which due days are used? Is rent paid in advance or in arrears?
6. Are yearly increases applied by agreement (what percentage, from when)? Is a late fee ever charged?
7. Are security deposits taken, and how are refunds and deductions usually handled?

**Documents and privacy**
8. Is the client required to submit tenant IDs to the police? Which IDs do tenants usually provide? Will the client accept recording only ID type and last four digits, with copies held briefly?
9. How long should ID copies be kept after the police acknowledgement or move-out? Is the client willing to give tenants a printed privacy notice?

**WhatsApp and reminders**
10. Does the client use personal WhatsApp or the WhatsApp Business app? Is WhatsApp Desktop or Web signed in on the PC?
11. Is "owner presses Send" acceptable? If the client wants full automation, do they accept a Meta business account, a dedicated number, tenant opt-in, per-message fees and a small cloud service?
12. How many days before the due date should a reminder appear? Which languages should the messages use?
13. Does the PC stay on and logged in, or is it switched off at night and on weekends?

**Money and tax**
14. Is any rent from commercial property? Is it received under the same PAN or GST registration as the welding business? (Commercial rent can attract GST once the GST threshold is crossed **(confirm with the CA)**.)
15. Do any tenants deduct TDS on rent? Does the client need rent receipts for tenants (for example for HRA)?

**Backup and ownership**
16. Where should the backup go (USB drive, a personal Google account, another PC)? Who keeps the recovery code?
17. Should this be sold and priced as an add-on to the company app, or as a separate product?

## 17. Sources

Retrieved on 2026-10-14. Several are secondary or unofficial; treat them as pointers and confirm against the official page where noted.

- WhatsApp Terms of Service (acceptable use, non-personal use): https://www.whatsapp.com/legal/terms-of-service
- WhatsApp Business Messaging Policy (opt-in, templates, 24-hour window): https://whatsappbusiness.com/policy/
- Meta pricing (per-message since 1 July 2025; template categories): https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing
- Meta: service and utility message pricing changes from 1 October 2026: https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages
- Meta: template categorisation (payment reminder as a utility example; re-categorisation): https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization
- India rates (vendor summary, verify against Meta's rate card): https://myoperator.com/blog/whatsapp-business-api-pricing-india-2026
- Click-to-chat format (vendor documentation; WhatsApp's own page could not be loaded here): https://bird.com/explained/whatsapp/what-is-a-whatsapp-click-to-chat-link and https://faq.whatsapp.com/5913398998672934
- Coexistence of the Business app and the API (provider documentation, India availability disputed): https://docs.360dialog.com/docs/waba-management/embedded-signup/whatsapp-coexistence
- Aadhaar Act, 2016 as amended (sections 29, 37, 40): https://uidai.gov.in/images/Aadhaar_Act_2016_as_amended.pdf
- UIDAI 2022 advisory on photocopies and masked Aadhaar, withdrawn the same day (press coverage): https://www.livelaw.in/amp/news-updates/dont-share-photocopies-of-aadhaar-unlicensed-entities-like-hotels-cant-keep-aadhaar-cards-uidai-200366
- DPDP Rules, 2025 notified (government release; 18-month phase-in; security-safeguard penalties): https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc20251117695301.pdf
- DPDP Act section 3 text and commentary (unofficial site): https://dpdpa.com/dpdpa2023/chapter-1/section3.html
- Puducherry tenant verification (third-party guide; compulsory status not confirmed): https://wikiprocedure.com/index.php/Puducherry_-_Apply_to_get_Tenant_Verification
