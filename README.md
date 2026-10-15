# Mononmani Welding Works

Windows desktop app for Mononmani Welding Works: GST tax invoices, quotations, purchase orders, payments received, supplier bills and payments, rentals and reminders. It runs offline on one computer and can back up to Google Drive.

Built with Tauri 2 (Rust + SQLite) and React + TypeScript + Tailwind CSS.

## Running

- `app.bat dev` runs the app in development mode.
- `app.bat build` builds the release app, and `app.bat open` starts it.
- `tools\test-harness\test.bat` runs the Rust tests.

Screens, business rules and code layout are described in [docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md).
