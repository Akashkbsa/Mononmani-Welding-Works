# Mononmani Welding Works — agent instructions

This folder is a **Tauri 2 desktop app** (Rust + SQLite backend, React 19 + TypeScript + Tailwind v4 frontend) for GST invoicing, customers and payments. It is **not** the Figma Make / Vite project described in `../AGENTS.md`; ignore that file here.

## Commands

- Type-check UI: `npx tsc --noEmit -p .`
- Build UI: `npm run build`
- Check Rust: `cargo check --manifest-path src-tauri/Cargo.toml` (needs the WinLibs MinGW `bin` folder first on PATH; see `app.bat`)
- Run app in dev: `app.bat dev` (Vite on port 1420 + Tauri)
- `cargo test` builds but the test exe can't start on this machine (MinGW manifest issue); see `docs/PROJECT_STRUCTURE.md`.

## Layout

- `src/` React UI: `App.tsx` (sidebar), `pages/`, `components/` (`ui.tsx` is the shared kit), `services/api.ts` (all Tauri commands), `lib/format.ts`, `lib/gst.ts`, `template/` (invoice PDF HTML/CSS).
- `src-tauri/src/` Rust: `customers/`, `invoices/`, `payments/` (models, repository with business rules, commands), `db/migrations.rs`, `pdf/renderer.rs`, `util.rs`.
- Full description and business rules: `docs/PROJECT_STRUCTURE.md`.

## Rules that must hold

- Dates are stored `YYYY-MM-DD`, shown `DD-MM-YYYY`. Money is rounded to paise. Invoice totals are exact to the paisa (no round-off to the rupee); migration 11 brought unpaid older invoices to their exact total; fully paid ones keep the total they were settled at.
- Business rules live in the Rust repositories, not only the UI: allocation limits, advances (credit/refund), round-off and write-off, invoice edit/delete guards, customer delete guard.
- Puducherry (state code 34) → CGST + SGST; other states → IGST.
- Business name is **Mononmani Welding Works**. Keep the Tauri identifier `com.manonmani.app` (it locates the user's data folder).
- Schema changes go in a new numbered migration in `db/migrations.rs`; never edit an applied one.

## Data and privacy

- The real database lives in `%APPDATA%\com.manonmani.app\Database\manonmani.db` and holds customer details. Don't read it or paste its rows into prompts; use sample data.
- Never commit or print secrets.
