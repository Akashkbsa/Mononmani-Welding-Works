# Screen-by-screen checklist

Use this during Phase 2 (audit). For every screen, answer each question with evidence (a screenshot or a file:line). Cross out what does not apply. Contents:

1. [Every screen](#every-screen)
2. [App shell and sidebar](#app-shell-and-sidebar)
3. [Dashboard](#dashboard)
4. [Invoices list](#invoices-list)
5. [Invoice form](#invoice-form)
6. [Invoice details and printing](#invoice-details-and-printing)
7. [Payments list](#payments-list)
8. [Payment form](#payment-form)
9. [Customers](#customers)
10. [Settings and backup](#settings-and-backup)
11. [Shared pieces](#shared-pieces)

## Every screen

- **Hierarchy:** one clear primary action; secondary actions visibly quieter; destructive actions separated and red.
- **Numbers:** money right-aligned, `tabular` digits, same decimals everywhere (`formatMoney`), the rupee sign consistent, negative and zero handled.
- **Dates:** always `DD-MM-YYYY` on screen; no raw `YYYY-MM-DD` leaks.
- **Alignment and rhythm:** a 4px grid; consistent gaps between label, field, hint, error; no stray one-off paddings.
- **Contrast:** body text and placeholders at least 4.5:1; muted text still readable; status colours distinguishable without relying on colour alone.
- **Focus:** every interactive element shows a visible focus ring; Tab order follows reading order; no focus traps except modals (which must trap and restore).
- **Hit targets:** at least 32px tall for desktop controls; icon-only buttons have an accessible name and a title.
- **States:** hover, active (pressed), focus, disabled (with a reason when it is not obvious), loading, empty (says what to do next), error (says what happened and how to fix it), success (confirms the exact action in the same words as the button).
- **Long and ugly data:** long names truncate with a tooltip or wrap cleanly; no layout jumps; huge counts and amounts fit.
- **Window sizes:** works at about 1000x700 and 1280x800; no horizontal scroll; modals never taller than the window; footers stay reachable.
- **Windows scaling:** 125 and 150 percent do not clip text or break rows.
- **Copy:** sentence case, plain verbs, one name per action across the whole flow, no jargon (say "unpaid", not "outstanding", unless the accountant needs it).

## App shell and sidebar

- Active page is obvious; the backup-due dot has a tooltip and is not the only signal.
- Page changes feel instant (no animation; this is used constantly).
- Financial-year label is understandable.
- Window title and the logo block match the business name exactly.
- Settings is reachable by keyboard.

## Dashboard

- The three figures answer "how much am I owed, billed, received?" at a glance; each is clickable and looks clickable.
- "Waiting for payment" rows: oldest first, age readable, amber after 30 days is explained somewhere (title or hint).
- Empty states say what to do ("Record payment when a customer pays").
- `Ctrl+N` works only when no dialog is open and focus is not in a field; discoverable via the button title.
- First-load is the one place for a gentle reveal (see the motion spec); reloads after saving must not replay it.

## Invoices list

- Month filter defaults to this month; "All months" is one click away; the selected month survives edits.
- Download button wording matches what it does; its helper text is accurate (cancelled included, drafts left out).
- Tabs show counts that respect the month; a zero count is calm, not alarming.
- `/` focuses search; the hint in the placeholder does not truncate.
- Status column: Paid is quiet, Unpaid and Part paid draw the eye, Cancelled is muted; every state is legible in grey-scale.
- Row click opens details; the chevron and hover tint signal that; keyboard users can open a row (rows are not focusable today: check and fix with `tabIndex`, Enter).
- Footer totals add up with what is on screen (month plus tab).
- Sticky header stays readable while scrolling; long customer names truncate.

## Invoice form

- **Bill to:** the picker opens on focus, filters as you type, Escape closes only the list, a new customer can be added without losing the form. The read-only details card is clear that edits happen on the customer record.
- **Invoice number / date / status:** duplicate-number error is inline and appears on blur; status "Draft" explains itself.
- **Line items:** description first; HSN/SAC starts empty with a placeholder; unit is a list (NOS, KGS, MTR, SQFT, SET, HRS, LTRS, JOB); quantity and rate are right-aligned, no scroll-wheel changes; add/remove line is obvious; removing the last line is blocked gracefully; tabbing from the last cell of a row does not skip the next row's description; Enter in rate adds nothing surprising.
- **Totals:** subtotal, discount, taxes, total update live and match the backend exactly (paise, no round-off).
- **Tax:** type follows the customer's GSTIN state; a mismatch warning is calm and specific.
- **Delivery details:** PO and DC fields are one connected number-and-date control; vehicle number formats on blur and errors only after touch; the collapsed section is keyboard operable.
- **Footer:** Save and "Save and print" are distinguishable; busy state disables both; failure keeps the form and shows the reason.
- **Dirty-state:** closing with unsaved changes should not silently discard (consider a confirm; ask first if it changes behaviour).

## Invoice details and printing

- Print menu: the one-file options (All 3 copies, Original + Duplicate) sit above the single copies and look identical in style; it closes on outside click and on Escape; focus returns to the Print button.
- Footer: Delete and Cancel invoice are visually distinct from Edit and Record payment; destructive confirms say what will remain.
- Cancelled invoices explain themselves and offer Restore.
- Payments list inside the dialog is readable and each row links to what it is.
- The PDF is not redesigned here; changes to `src-tauri/templates/*` need the owner's approval.

## Payments list

- Filters (search, method, not cleared) and "Clear filters" appear together and clear together.
- TDS, round-off and write-off notes under the amount are readable but quiet.
- Not-cleared payments are visibly different without being alarming.

## Payment form

- **Customer picker** is the same component as on invoices.
- **Amount, date, method, reference:** the reference label changes with the method; the date control shows `DD-MM-YYYY`.
- **TDS:** the percent/amount switch, rate list, "taken on" choice and the computed amount read as one small panel; the "set amount received" suggestion appears only when it helps.
- **Apply to invoices:** each row shows invoice, date, balance and the applied amount; checkboxes have labels; "Fill oldest first" is discoverable; over-allocation is shown on the row, not only in a top error.
- **Summary box:** Received, TDS, Advance used, Written off, Applied; the Short and Left-over blocks give exactly one clear next step each; no red error that also has a calm fix next to it.
- **Round-off / write-off:** wording explains the consequence in a sentence; large amounts are warned, not blocked.
- **Verified checkbox** wording is understandable to a non-accountant.

## Customers

- Search covers name, phone, GSTIN; favourite star is keyboard operable and announces its state.
- Details dialog: balance due and advance are prominent; the invoice list inside reuses the status styling.
- Form: GSTIN validation message appears at the right time; state follows the GSTIN but a mismatch is explained; the duplicate-name check is gentle.
- Deleting a customer with records explains why it is blocked and what to do.

## Settings and backup

- Business details: the preview of what prints is obvious; saving shows a clear confirmation.
- Backup card: connected, last backup, pending changes, restore and its safety copy are each understandable; long-running work shows progress and cannot be double-started; errors are specific.
- Paths are selectable and copyable; "Open data folder" is the only action on that card.

## Shared pieces

- **Modal:** width options sensible; header, scrolling body and footer stay in place; Escape closes only the top dialog; focus is trapped and restored; backdrop click behaviour is intentional.
- **ConfirmDialog:** the confirm button repeats the action's verb; the back-out button says what it keeps when that helps.
- **Toast:** short, specific, matches the button wording; errors stay long enough to read; announced to screen readers (`role="status"` / `aria-live`).
- **SearchSelect:** arrow keys, Enter, Escape; empty-result text; long lists scroll the active row into view; works inside a scrolling modal without clipping.
- **Badge / StatusBadge:** one style per meaning; no decorative dots.
- **Loading / EmptyState / Alert:** every list has all three.
- **ErrorBoundary:** the fallback tells the user what to do, not a stack trace.
