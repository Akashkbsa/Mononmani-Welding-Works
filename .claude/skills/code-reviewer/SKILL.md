---
name: code-reviewer
description: Review recent code changes in this repo (Mononmani Welding Works Tauri app) and summarize what changed. Use whenever the user asks to review code, check my changes, what changed recently, review the last commit, review before commit/push, "what did I modify", or wants a second look at a diff, even if they don't say "review".
---

# Code reviewer

Two jobs: (1) identify what changed recently, (2) review those changes for problems. Do job 1 first and always show it, because the user often just wants to know what changed.

## 1. Identify recent changes

Pick the scope from the request; default to uncommitted work, falling back to the last commit if the tree is clean.

```bash
git status --short                     # uncommitted: modified / untracked
git diff HEAD --stat                   # size of uncommitted changes
git diff HEAD                          # full uncommitted diff
git log --oneline -10                  # recent history
git show --stat <sha>                  # one commit's files
git diff <base>..HEAD                  # a range, e.g. main..HEAD
```

Untracked files are not in `git diff`; read them directly. Do not read the real database under `%APPDATA%` (see AGENTS.md privacy rules).

Report a short **Change summary**: files grouped by area (Rust `customers/ invoices/ payments/ db/ pdf/` and `src-tauri/templates/` (invoice PDF), UI `pages/ components/ services/ lib/`, docs/config), one line each on what changed and why it likely changed.

## 2. Review

Read the full diff plus enough surrounding code to judge it. Focus on correctness over style. Check these project rules, since breaking them corrupts invoices or money:

- **Business rules live in Rust repositories**, not just the UI: allocation limits, advances (credit/refund), round-off and write-off limits, invoice edit/delete guards, customer delete guard. Flag any rule enforced only in React.
- **Dates** stored `YYYY-MM-DD`, shown `DD-MM-YYYY`. **Money** rounded to paise; invoice totals are exact to the paisa (no rounding to the rupee). Numbers read `MWW/009/26-27` and `PAY/004/26-27` (running number, then financial year); the older `MWW/26-27/009` form must still be understood when working out the next number.
- **GST**: state code 34 (Puducherry) → CGST + SGST; other states → IGST.
- **Migrations**: schema changes only as a new numbered migration in `db/migrations.rs`; an already-applied one must never be edited.
- **Identity**: business name "Mononmani Welding Works"; Tauri identifier `com.manonmani.app` must not change.
- **Frontend/backend contract**: a changed Tauri command signature or struct must match `src/services/api.ts` and its callers.
- **Security/privacy**: no secrets, no customer data in code, logs or fixtures; SQL uses bound parameters.
- General: error handling (`unwrap`/`expect` on user-driven paths), off-by-one and rounding, missing transaction around multi-step writes, unused code left behind.

Verify rather than guess, when cheap:

```bash
npx tsc --noEmit -p .
cargo check --manifest-path src-tauri/Cargo.toml   # needs WinLibs MinGW bin first on PATH, see app.bat
```

`cargo test` cannot run its exe on this machine; don't report that as a failure.

## Output format

```
## Change summary
<grouped list>

## Findings (most severe first)
1. [High|Medium|Low] path/file.rs:123 — what is wrong
   Scenario: concrete input/state -> bad result
   Fix: suggestion

## Checks run
tsc: pass/fail · cargo check: pass/fail/not run

## Verdict
<one line: safe to commit, or what to fix first>
```

If nothing is wrong, say so plainly instead of inventing nitpicks. Only report issues you can point to in the diff. This skill is read-only: suggest fixes, but don't edit files unless asked.
