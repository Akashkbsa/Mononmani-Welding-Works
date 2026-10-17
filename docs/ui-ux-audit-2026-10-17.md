# UI/UX audit: Mononmani Welding Works (whole app), 17-10-2026

Made with the `ui-ux-improviser` skill (ux-ui-agent-skills gates + UI UX Pro Max guidelines).
All 13 screens and 5 key dialogs were rendered in Chrome at 1280 px and 640 px through a stand-in
backend with invented sample data (the real database was not used).

## Summary

The app is in good shape: one shared component kit, clear primary actions, confirmations on every
delete, helpful empty states, visible focus rings, reduced-motion support, and number fields the
mouse wheel cannot change by accident. The problems cluster in two places: **half-screen (640 px)
use**, where important columns and buttons go off-screen (Employees' *Enter days*, *Balance due*,
the invoice form's Tax box; the pay sheet's Status column is cut off even at full width), and
**accessibility basics**: 44 of 107 form fields are not connected to their labels, and every
page subtitle is slightly too faint (4.32:1, needs 4.5:1).

| Area | Score /10 | Main reason |
|---|---|---|
| Visual hierarchy | 8 | Clear headers, primary buttons and KPI cards; the reminder banner competes on every screen |
| Consistency | 7.5 | Shared kit used almost everywhere; a few one-off patterns |
| Accessibility | 6 | Unlabelled fields, faint subtitles and paise, tab bars without arrow keys |
| Usability | 7.5 | Good flows and messages; some views open on an empty month |
| Responsiveness | 5.5 | Half-screen is a stated goal, but key columns and actions go off-screen |
| Performance | 8 | Skeletons, reduced motion; speed itself not measured |
| **Overall (weighted)** | **7.1** | |

_Scores are judgement; the findings carry the evidence._

## Problems found

| # | Severity | Area | Where | Problem | Evidence | Fix |
|---|---|---|---|---|---|---|
| 1 | Major | Responsive | Employees, `PaySheetTab.tsx` toolbar | At half-screen the **Enter days** button is pushed off the right edge | Observed: 640 px screenshot | Let the toolbar wrap |
| 2 | Major | Responsive | Employees pay sheet | Even at 1280 px with the sidebar open the Status column and footer total are cut off | Observed: 1280 px · Pro Max *Horizontal Scroll* (High) | Show Bonus / Incentives only when used; fit the table |
| 3 | Major | Accessibility | `ui.tsx` `Field`; 44 fields | Labels not connected to inputs: screen readers can't name them, clicking a label doesn't focus the box | Measured: axe `label` / `select-name` · WCAG 1.3.1, 4.1.2 (A) | `Field` gives its control an id (`useId`) |
| 4 | Major | Responsive | New invoice form at 640 px | Tax dropdown shrinks to "CC" | Observed: 640 px screenshot | Stack Tax full-width when narrow |
| 5 | Major | Responsive | Customers, Invoices, Supplier bills at 640 px | Balance due / Amount off-screen | Observed: 640 px · Pro Max *Horizontal Scroll* | Hide secondary columns below 44rem |
| 6 | Major | Accessibility | Every page subtitle, small notes on the grey page | `slate-500` on `#f2f4f7` | Measured: axe 4.32:1 (needs 4.5) on 13/13 screens | `text-slate-600` |
| 7 | Minor | Accessibility | Dashboard paise, invoice line numbers | `slate-400` | Measured: axe 2.63:1 | `slate-500`, paise ≥ 0.7em |
| 8 | Minor | Accessibility | 8 tab bars | `role="tab"` but arrow keys do nothing | Measured: `verify_keyboard` · WCAG 2.1.1 | Arrow-key handling |
| 9 | Minor | Accessibility | Payments / Supplier payments method filter | Dropdown has no name | Measured: axe `select-name` | `aria-label` |
| 10 | Minor | Accessibility | Employee month window incentive lines | Button inside a description list | Measured: axe `definition-list` | Button inside the `<dd>` |
| 11 | Minor | Usability | Reminder banner | ~130 px at 1280, ~210 px at 640, repeated on the Reminders page | Observed · Nielsen #8 | Compact one-line banner; hidden on Reminders |
| 12 | Minor | Usability | Payments / Supplier payments on an empty month | Empty screen without a next step | Observed · Pro Max *Empty States* | "Show all dates" |
| 13 | Minor | Consistency | Rentals → This month | Different month switcher | Observed · Nielsen #4 | Shared `MonthFilter` |
| 14 | Minor | Visual | Customers list | Phone wraps; "Puducherry, Puducherry" | Observed | No-wrap phone; state only when different |
| 15 | Minor | Visual | Reminders, Linked to | Invoice number breaks mid-number | Observed | No-wrap |
| 16 | Minor | Visual | Employee month window | "-₹5,000.00" uses a hyphen | Observed | True minus "−" |
| 17 | Minor | Recognition | Sidebar Document Vault icon | Reads as "close" | Observed · Nielsen #6 | A folder-lock icon |
| 18 | Minor | Print | Pay slip / Ledger headings | Small orange text | Measured: axe 3.04:1 | Darker orange |
| 19 | Enhancement | Copy | Settings "Database version" | Developer wording | Observed | Plain wording |
| 20 | Enhancement | Consistency | 12 native dropdowns | OS-styled list | Measured: `lint_native_select` | Keep; noted |

Checked and not counted: Tailwind palette classes (deliberate), "—" empty-cell dashes,
the backup time format (a sample-data artefact), Supplier bills' quiet "Fully paid" (deliberate).

## What was checked

- Measured: 13 screens + 5 dialogs at 1280 and 640 px: axe (WCAG 2.2 AA), target size, keyboard,
  reduced motion, overflow, `contrast.py`; static lint and a form-label scan.
- Not measured: `measure_render` / `verify_states` misread Tailwind v4 `oklch` colours, so contrast
  came from axe and `contrast.py`; no dark theme; other dialogs reviewed in code only; real speed.

## Fixes made (17-10-2026)

All findings were fixed in the suggested order, then re-measured on all 13 screens and 5 dialogs.

| # | What changed |
|---|---|
| 3 | `Field` (`ui.tsx`) gives its native input/textarea/select an id (`useId`) and points it at the hint or error (`aria-describedby`): every field's label now names it and clicking the label focuses it |
| 6 | Page subtitles and notes on the grey page: `text-slate-600` |
| 7 | Dashboard paise `slate-500` at 0.7em; invoice line numbers `slate-500` |
| 1 | Pay sheet toolbar wraps, so *Enter days* is always reachable |
| 2 | Pay sheet: Bonus + Incentives became one *Extras* column (only in months that have any, breakdown on hover), slimmer Days / OT hrs, short status badges ("To pay ₹16,500", "Not entered", full text on hover): fits at 1280 px with the sidebar open |
| 5 | Narrow mode: a `Card` keeps its 46rem table minimum only on wide areas; tables name the columns they can do without in `data-hide-narrow` (`index.css`), and long names shorten sooner, so money and status stay in view at half-screen. Customers shows the city under the name (one column less) |
| 4 | Invoice form: Tax and totals stack below 40rem; item columns shrink (`#` hides, Qty/Rate drop the spinner) so Qty, Rate and Amount stay in view |
| 8 | `onTabListKeyDown` (`ui.tsx`) on all 8 tab bars: Left/Right/Home/End |
| 9 | Payment-method filters named |
| 10 | Incentive lines: a real *Edit* button in the amount cell (valid description list) |
| 11 | Reminder banner shows the most urgent reminder, with "Show N more" (up to 3, then a link to the Reminders page); not shown on the Reminders page |
| 12 | Empty month on Payments / Supplier payments: "Show all dates" |
| 13 | Rentals uses the shared `MonthFilter` (up to a year ahead) |
| 14 | Phone on one line; state shown only when it differs from the city |
| 15 | Linked record numbers stay on one line |
| 16 | True minus sign in the month working ("−₹5,000.00") |
| 17 | Document Vault icon: `FolderLock` |
| 18 | Pay slip / ledger small headings: `--arc-text: #b45309` (5.02:1) |
| 19 | "App data version" |
| 20 | Native dropdowns kept (no change needed) |

**Re-measured:** axe 0 violations on 18 of 18 captures (it was 13 screens with contrast and 20+ label failures); click targets OK 18/18;
overflow OK on all 13 screens at 640 and 1280 px (the 5 dialog captures report the page behind the dialog as
"overlap", the same as before the fixes: a limit of the gate, not a regression); pay slip and ledger PDFs 0 violations.
The tab arrow keys are covered by a unit test (static captures carry no scripts). 733 UI tests and 341 Rust tests pass.
