---
name: mww-frontend
description: Senior UI/UX audit-and-fix pass for the Mononmani Welding Works desktop app (Tauri + React + Tailwind v4). Combines Emil Kowalski's design-engineering and motion rules, Impeccable's critique/audit/polish workflow, and the Taste skill's anti-slop discipline to review every screen, form, table, modal and state in fine detail, fix what is wrong, and add subtle, purposeful motion. Use whenever the user asks to improve, polish, review, redesign, audit, refine or "make the UI/UX better", wants smoother animations or transitions, asks what feels off about a screen, or mentions the frontend, design, spacing, colors, typography, accessibility or user experience of this app, even if they do not name this skill. Not for backend, Rust, database or business-rule work.
---

# MWW frontend: think like a senior UI/UX engineer

The only goal is a better experience for the people who use this app: a small welding workshop owner and their staff, entering invoices and payments on one Windows PC, many times a day, often in a hurry. Everything below serves that. Beauty is welcome when it makes the work faster, clearer or calmer, and cut when it does not.

## 0. Non-negotiables (read before touching anything)

These come from the project's `AGENTS.md` and from what the app is. Breaking one costs the owner real money or trust, so they outrank any design preference.

- **Business behaviour is not design.** Never change calculations, GST rules, allocation or advance logic, numbering (`MWW/009/26-27`, `PAY/004/26-27`), money/date formats (paise; `DD-MM-YYYY`), invoice or payment rules, or anything in `src-tauri/`. If a UI fix needs one, stop and ask.
- **Words the business owns stay.** Business name "Mononmani Welding Works", legal text, PDF template content, invoice field names and the Tauri identifier. UX copy (labels, hints, errors, empty states) may be improved; invoice content may not.
- **Offline desktop app.** No CDN, no Google Fonts, no remote images, no new network calls. The font is the system Segoe UI. Icons are `lucide-react` (already the one family; do not mix a second).
- **No new dependencies without asking.** Prefer CSS transitions, `@starting-style` and the Web Animations API. If a library would truly earn its place, name it and ask.
- **Privacy.** Never read the real database under `%APPDATA%`. Use sample data (`break-ui` worst-case data, or the fixtures in your own test harness).
- **Git.** Work on the branch the user names (normally `frontend-redesign`), never on `main` directly. One small commit per theme with the project's co-author trailer. Do not push unless asked.
- **Existing design system.** Tokens live in `src/index.css` (`brand-*` steel blue, `ink-*` navy sidebar, `arc` weld orange for the logo only, `canvas`). Shared pieces live in `src/components/ui.tsx` (Button, Field, Card, StatStrip, Badge/StatusBadge, SearchSelect, Modal, ConfirmDialog, Toast, tables helpers). Fix problems at the shared component first so every screen benefits, and keep one corner-radius scale, one accent and one shadow style.

## 1. How the three sources are used

Do not paste their text into replies. Load the relevant one when you reach the step that needs it, and apply it with this app's context.

| Source | Load it for | What to take | What to ignore here |
|---|---|---|---|
| **Impeccable** (`impeccable:impeccable`) | the review method | Treat every screen as **Operate mode**: scanability, consistency and the real usage scene beat expression. Use its `critique`, `audit`, `polish`, `harden`, `clarify`, `layout`, `typeset`, `animate`, `quieter` playbooks, and its "verify in bounded passes" rule (one batched inspection, one fix batch, at most one confirmation round). | Landing-page and "go all out, be bold" energy. `live` mode (browser picking) does not apply to Tauri. Do not run `init`/`document` unless asked; they write PRODUCT.md/DESIGN.md into the repo. |
| **Emil Kowalski** (`emil-design-eng`, `animate`, `animation-performance`, `review-animations`, `find-animation-opportunities`, `break-ui`, `apple-design`) | taste in details and every motion decision | The **frequency rule** (decide motion by how often people see it), easing and duration tables, never animate from `scale(0)`, origin-aware popovers, interruptible CSS transitions, transform/opacity only, reduced-motion, the review **Before/After/Why table**, and `break-ui` for worst-case data. Invoke `emil-design-eng` with a concrete question, because with no question it answers with a one-line greeting only. | Gesture/drag/sheet material (`apple-design`), React Native and Swift skills (`animate-expo`, `write-swift`), phone-only tips (`mobile-native`), and the Sonner library (`ask-sonner`): the app has its own Toast. |
| **Taste** (`design-taste-frontend`) | the anti-slop discipline | Color, shape and theme **consistency locks**; button and form contrast checks; full state coverage (loading, empty, error); the copy self-audit; real states over fake ones; no filler words; reduced motion for anything animated. | It declares dashboards and dense product UI out of scope. Skip hero, imagery, marquee, bento, scroll-hijack, font swaps, "no em-dash" (the app uses a dash for empty values on purpose), dark-mode mandates, and any advice that needs the network. |

If two sources disagree, the order is: Section 0 of this file, then Operate-mode usability (Impeccable), then Emil's frequency rule, then Taste.

## 2. The workflow

Run the phases in order. Skip a phase only when the request is clearly narrower (for one screen, run it on that screen). State the scope you chose in one line before starting.

### Phase 1: Read the room (cheap, no edits)
1. `git status`, current branch, `git log --oneline -10`. Confirm you are not on `main`.
2. Read `AGENTS.md`, `docs/PROJECT_STRUCTURE.md`, `src/index.css`, `src/components/ui.tsx`, `src/App.tsx`.
3. Find the real surface: `src/pages/*`, `src/components/*`, `src/components/{invoices,payments,customers}/*`, `src/template/*` (the PDF; design changes there need the owner's approval because customers receive it).
4. Write the one-line **Design read**: "Operate-mode business desktop app for a small workshop; steel-blue and navy; Segoe UI; dense but calm." Set intent for motion: **low**, because most actions repeat all day.

### Phase 2: Audit (read-only, very detailed)
Go screen by screen using `references/screens-checklist.md`. For each screen look at it through all four lenses:
- **Task flow (Impeccable critique):** can the user finish the job in the fewest steps? Is the primary action obvious? Does the keyboard path work (Tab order, Enter to submit, Esc to close, `/` and Ctrl+N shortcuts)? What happens on the second visit, with 500 invoices, with zero?
- **Visual craft (Emil + Taste):** alignment, rhythm, hierarchy by weight and color not size, tabular numbers, radius/shadow/accent consistency, contrast, focus visibility, hit-target size, hover/active/disabled/loading/empty/error states.
- **Robustness (`break-ui`, Impeccable harden):** long customer names, 50-character GSTIN-less names, one-letter names, missing fields, huge amounts (₹1,23,45,678.90), zero items, 200 line items, narrow window, Windows display scaling 125 to 150 percent.
- **Words (Impeccable clarify + Taste copy audit):** plain verbs, sentence case, one name per action across the flow ("Record payment" then "Payment recorded"), errors say what happened and what to do, no filler.

Capture evidence rather than opinions: screenshots (Phase 5 tooling) and file:line references. Log each finding with severity (**blocker** breaks a task or accessibility, **major** slows or confuses, **minor** polish) and whether it is **auto-fixable** (Section 3).

### Phase 3: Plan
Group findings into themes (for example: "forms", "tables", "feedback and states", "motion", "copy"). Order by user impact per risk. Present the plan as a short list with the count of auto-fixes and the list of items that need the owner's decision. Do not start a theme that depends on an unanswered decision.

### Phase 4: Fix
Work theme by theme. For each theme: fix at the shared component first, then the screens; keep diffs small and reviewable; run `npx tsc --noEmit -p .` and `npm run build` before committing; commit with a message that says what the user will notice. Never mix a design change and a behaviour change in one commit.

### Phase 5: Motion
Add motion only where `references/motion-spec.md` allows it. The short version: nothing for things done hundreds of times a day (page switching, typing, row hover beyond a colour change, keyboard actions); quick, quiet, origin-aware motion for occasional things (dialogs, menus, toasts, the pick list); one gentle orchestrated moment for rare things (first dashboard load). Always honour `prefers-reduced-motion`. Verify each animation by watching it at slow speed and by confirming it can be interrupted without a jump.

### Phase 6: Verify and report
1. `npx tsc --noEmit -p .` and `npm run build` must pass. If Rust was untouched, say so.
2. Capture before/after screenshots with `scripts/screenshot.py` (see below) for every changed screen at the window sizes the app really runs at (about 1280x800 and a narrow 1000x700).
3. Run a worst-case pass on every changed list, form and card.
4. Keyboard-only walk through each changed flow.
5. Reduced-motion check: all motion collapses to instant.
6. Report using the format in Section 4. State plainly what you did not verify (for example "not clicked through in the running app").

## 3. What may be fixed automatically, and what must ask

**Fix without asking** (low risk, reversible, no meaning change): contrast and focus-ring fixes; missing labels, `aria-*`, `aria-label` on icon buttons, `type="button"`; alignment, spacing and radius consistency; right-aligned tabular money; truncation with a title for long names; hit-target size; hover/active/disabled/loading/empty/error states; consistent status colours; UX copy that is vague or inconsistent (not invoice or legal text); keyboard and focus order; motion within the motion spec; removing dead UI.

**Ask first** (changes meaning, data or what customers see): anything in `src-tauri/` or business logic; the invoice PDF template and its CSS; renaming navigation labels or moving screens; removing a feature or field; changing defaults that affect money (tax type, TDS base, round-off behaviour); adding a dependency; adding dark mode or a new theme; changing number or date formats.

When unsure which side something is on, treat it as "ask first" and put it in the decisions list.

## 4. Report format

Lead with the outcome in two sentences. Then:

```
## What changed (user-visible)
<grouped by screen, one line each, plain language>

## Before / After / Why
| Before | After | Why |
| --- | --- | --- |
(one row per meaningful fix, Emil's table format)

## Motion added
<each animation: where, what, duration, easing, why it earns its place>

## Needs your decision
<numbered, each with a recommendation>

## Verified / not verified
tsc, build, screenshots, worst-case, keyboard, reduced motion: pass/fail/not run
```

Keep it honest: if you did not see it running, say so. Do not call a screen "done" on the strength of a type-check.

## 5. Screenshot tooling

The app needs Tauri to run, so a plain browser cannot show real screens. Use a **static harness**: build the UI (`npm run build`), copy `dist/assets/*.css` next to a small HTML file that reproduces the markup of the component under review with sample data, and capture it:

```bash
python .claude/skills/mww-frontend/scripts/screenshot.py <file.html> <out.png> [--width 1100] [--height 700] [--scale 2]
```

It finds Microsoft Edge (or Chrome), renders headlessly and writes a PNG. Read the PNG to inspect it. Keep harness files and PNGs in the scratchpad directory, never in the repo.

For the real running app the user can run `app.bat dev`; ask them for a screenshot when a judgement depends on real data or Windows scaling.

## 6. Principles to keep in your head

- **Frequency decides everything.** The more often people do something, the less the interface should perform and the more it should simply be fast and predictable.
- **Fix the system, not the instance.** One wrong radius in a component is fifty wrong screens.
- **Show state, always.** Empty, loading, error, success, disabled, and "nothing matches your search" are screens too.
- **Respect attention.** One accent, one scale, quiet defaults. Colour carries meaning (status, risk), not decoration.
- **Money screens earn trust through calm.** Aligned digits, unambiguous labels, clear totals, reversible actions, plain errors.
- **Small, verified, reversible.** Many tiny commits beat one heroic one.
