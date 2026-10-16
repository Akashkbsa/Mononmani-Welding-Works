# Mononmani Welding Works

A Windows desktop app that runs the office side of Mononmani Welding Works: GST tax invoices, quotations, purchase orders, payments received, supplier bills and payments, rentals, employees and payroll, and reminders. Everything works offline on one computer, and the data can be backed up to Google Drive.

Built with [Tauri 2](https://tauri.app) (Rust + SQLite) and React 19 + TypeScript + Tailwind CSS v4.

## Features

| Area | What it does |
|---|---|
| Dashboard | Money owed and owing by age, receipts, rent, a 6-month chart, the biggest customers and suppliers, what needs attention |
| Invoices | GST tax invoices (CGST + SGST in Puducherry, IGST elsewhere), Original / Duplicate / Triplicate PDFs, a month's invoices in one PDF |
| Quotations and purchase orders | Records with attached files, linked to each other and to invoices |
| Payments | Receipts across several invoices, TDS, advances, refunds, round-off and short settlement |
| Supplier bills and payments | Bills, payments across bills, write-off and round-off, a WhatsApp payment message |
| Rentals | Places, tenants, rent paid or not each month, WhatsApp rent reminders |
| Employees | Daily wage and hourly overtime, a monthly pay sheet, advances, salary with round-off |
| Reminders | Dated and repeating reminders with a banner, Done, Dismiss and Snooze |
| Document Vault | Important papers in two groups (Important, Keep for Future), any file type up to 25 MB, each copied once to Google Drive and never deleted there |
| Settings | Business, bank and tax details printed on invoices; Google Drive backup |

Every list has search (`/`), a new-record shortcut (`Ctrl+N`) and a date filter (month, financial year April to March, or a custom range).

## Requirements

- Windows 10 or 11
- [Node.js](https://nodejs.org) 22 or later (developed on 24)
- [Rust](https://rustup.rs) stable for the `x86_64-pc-windows-gnu` target, with the [WinLibs](https://winlibs.com) MinGW-w64 GCC toolchain. Its path is set in `app.bat`, `tools/test-harness/test.bat` and `src-tauri/.cargo/config.toml`; change it there if WinLibs lives somewhere else.
- Microsoft Edge (comes with Windows) or Google Chrome, used to print invoice PDFs

## Getting started

```bat
npm install
app.bat dev
```

`app.bat` with no argument shows a small menu.

## Commands

| Command | What it does |
|---|---|
| `app.bat dev` | Run the app in development mode (Vite on port 1420 + Tauri), with live reload |
| `app.bat build` | Build the release app and installers into `src-tauri\target\release` |
| `app.bat open` | Start the built release app |
| `npm run typecheck` | Type-check the UI |
| `npm run build` | Type-check and build the UI only |
| `npm run test:rust` | Run the Rust tests (business rules, database, migrations) |

Plain `cargo test` builds but can't start on this machine (a MinGW manifest issue), which is why the Rust tests run through `tools/test-harness`. See [docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md#tests).

## Project layout

```text
.
├── src/                    React UI
│   ├── App.tsx             sidebar and page switching
│   ├── pages/              one screen each (Dashboard, Invoices, Employees, ...)
│   ├── components/         shared kit (ui.tsx) and one folder per feature
│   ├── services/api.ts     every call into the Rust side
│   ├── types/              TypeScript shapes of the Rust data
│   ├── lib/                formatting, GST, dates and periods, pay and reminder helpers
│   └── assets/fonts/       IBM Plex Sans, bundled so the app works offline
├── src-tauri/              Rust backend (Tauri)
│   ├── src/                one folder per feature: models, repository (rules + SQL), commands
│   │   ├── db/             SQLite connection and numbered migrations
│   │   └── pdf/            invoice PDF printing
│   ├── templates/          invoice PDF HTML and CSS
│   ├── icons/              app icons
│   └── tauri.conf.json     app name, window, bundle settings
├── tools/test-harness/     runs the Rust data-layer tests without Tauri
├── docs/
│   ├── PROJECT_STRUCTURE.md  screens, business rules and code layout in detail
│   └── BRAND.md              colours, type and interface rules
├── .claude/                AI assistant settings and project skills
├── AGENTS.md               rules every change must keep (read before editing)
└── app.bat                 dev / build / open launcher
```

## Data and backups

All records live in `%APPDATA%\com.manonmani.app\`:

- `Database\manonmani.db`: the SQLite database, including attached files
- `Invoices\<financial year>\`: printed invoice PDFs
- `Backups\`: local copies kept before a restore

Settings → Google Drive backup uploads a full compressed copy whenever something changed. The folder name comes from the Tauri identifier `com.manonmani.app`; don't change it, or the app starts with an empty database.

## Documentation

- [docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md): every screen, business rule and file
- [docs/BRAND.md](docs/BRAND.md): the look of the app
- [AGENTS.md](AGENTS.md): the rules that must hold, for anyone (or any AI assistant) changing the code

Private software for Mononmani Welding Works.
