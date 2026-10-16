//! Load, stress and abuse tests for the data layer. Ignored by default because they take a while:
//!
//!     tools\test-harness\test.bat --release --test load -- --ignored --nocapture --test-threads=1
//!
//! `LOAD_SCALE` (default 1) multiplies the seeded data. Scale 1 is about ten years of a busy shop:
//! 20,000 invoices, 16,000 payments, 6,000 supplier bills. Only sample data is used.

use harness::customers::models::CustomerCreateInput;
use harness::customers::repository::CustomerRepository;
use harness::db::DatabaseManager;
use harness::invoices::models::{InvoiceCreateInput, InvoiceFilterInput, InvoiceItemInput};
use harness::invoices::repository::InvoiceRepository;
use harness::payments::models::{PaymentAllocationInput, PaymentFilterInput, PaymentInput};
use harness::payments::repository::PaymentRepository;
use harness::purchase_orders::models::{PurchaseOrderFilter, PurchaseOrderInput};
use harness::purchase_orders::repository::PurchaseOrderRepository;
use harness::quotations::models::{QuotationFilter, QuotationInput};
use harness::quotations::repository::QuotationRepository;
use harness::reminders::repository::ReminderRepository;
use harness::supplier_bills::models::{SupplierBillFilter, SupplierBillInput};
use harness::supplier_bills::repository::SupplierBillRepository;
use harness::supplier_payments::models::{SupplierAllocationInput, SupplierPaymentFilter, SupplierPaymentInput};
use harness::supplier_payments::repository::SupplierPaymentRepository;
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

fn scale() -> usize {
    std::env::var("LOAD_SCALE").ok().and_then(|s| s.parse().ok()).unwrap_or(1).max(1)
}

fn company(conn: &Connection, name: &str, party: &str) -> i64 {
    CustomerRepository::create(
        conn,
        CustomerCreateInput {
            name: name.to_string(),
            gstin: None,
            phone: Some("9876543210".to_string()),
            email: None,
            address_line1: Some("12 Sample Street".to_string()),
            address_line2: None,
            city: Some("Puducherry".to_string()),
            state: Some("Puducherry".to_string()),
            postal_code: Some("605001".to_string()),
            is_favorite: None,
            whatsapp_number: None,
            party_type: Some(party.to_string()),
        },
    )
    .unwrap()
    .id
}

fn date(n: usize) -> String {
    // Spread over ten years, 2016-04 to 2026-03.
    let day = n % 3650;
    let d = chrono::NaiveDate::from_ymd_opt(2016, 4, 1).unwrap() + chrono::Duration::days(day as i64);
    d.format("%Y-%m-%d").to_string()
}

fn invoice_input(customer_id: i64, number: &str, when: &str, items: usize, rate: f64, qty: f64) -> InvoiceCreateInput {
    InvoiceCreateInput {
        invoice_number: number.to_string(),
        invoice_date: when.to_string(),
        due_date: None,
        payment_terms_days: None,
        invoice_state: None,
        customer_id: Some(customer_id),
        customer_name: "Sample Customer".to_string(),
        customer_address: Some("12 Sample Street".to_string()),
        customer_phone: None,
        customer_gstin: None,
        customer_state: Some("Puducherry".to_string()),
        customer_state_code: Some("34".to_string()),
        po_number_and_date: Some(format!("PO-{}", number)),
        vehicle_number: None,
        date_of_supply: None,
        place_of_supply: None,
        our_dc_number_and_date: None,
        your_dc_number_and_date: None,
        delivery_note: None,
        supplier_ref: None,
        buyer_ref: None,
        dispatch_doc_no: None,
        delivery_note_date: None,
        dispatch_through: None,
        destination: None,
        terms_of_delivery: None,
        tax_type: "CGST_SGST".to_string(),
        discount: None,
        cgst_rate: Some(9.0),
        sgst_rate: Some(9.0),
        igst_rate: None,
        bank_name: None,
        bank_branch: None,
        bank_account_no: None,
        bank_ifsc: None,
        terms_and_conditions: None,
        status: None,
        notes: None,
        purchase_order_id: None,
        items: (0..items)
            .map(|i| InvoiceItemInput {
                sl_no: None,
                description: format!("<b>Fabrication</b> work item {}", i + 1),
                hsn_sac: None,
                qum: None,
                quantity: qty,
                rate,
            })
            .collect(),
    }
}

fn payment_input(customer_id: i64, when: &str, invoice_id: i64, amount: f64) -> PaymentInput {
    PaymentInput {
        payment_number: None,
        customer_id,
        payment_date: when.to_string(),
        payment_method: None,
        reference_number: Some("UTR123".to_string()),
        bank_name: Some("SBI".to_string()),
        amount_received: amount,
        tds_amount: 0.0,
        tds_recognized: true,
        credit_to_apply: 0.0,
        is_verified: true,
        remarks: None,
        allocations: vec![PaymentAllocationInput { invoice_id, allocated_amount: amount }],
        excess_action: None,
        writeoff_amount: 0.0,
    }
}

struct Seeded {
    path: PathBuf,
    customers: Vec<i64>,
}

/// Times one call: median and worst of `runs` runs, in milliseconds.
fn time<T>(label: &str, runs: usize, mut f: impl FnMut() -> T) -> (f64, usize)
where
    T: Sized,
{
    let mut samples = Vec::with_capacity(runs);
    let mut size = 0;
    for _ in 0..runs {
        let start = Instant::now();
        let out = f();
        samples.push(start.elapsed());
        size = std::mem::size_of_val(&out);
        drop(out);
    }
    samples.sort();
    let median = samples[samples.len() / 2].as_secs_f64() * 1000.0;
    let worst = samples.last().copied().unwrap_or(Duration::ZERO).as_secs_f64() * 1000.0;
    println!("  {:<46} median {:>8.2} ms   worst {:>8.2} ms", label, median, worst);
    (median, size)
}

fn seed(dir: &Path) -> Seeded {
    let s = scale();
    let path = dir.join("load.db");
    let manager = DatabaseManager::new(&path).unwrap();
    let conn = manager.get_connection().unwrap();
    // Seeding speed is not what is measured below, so skip the disk flush while seeding.
    conn.execute_batch("PRAGMA synchronous = OFF;").unwrap();

    let n_customers = 300 * s;
    let n_suppliers = 100 * s;
    let n_invoices = 20_000 * s;
    let n_payments = 16_000 * s;
    let n_bills = 6_000 * s;
    let n_supplier_payments = 5_000 * s;
    let n_orders = 3_000 * s;
    let n_quotes = 1_500 * s;

    println!("Seeding (scale {}):", s);
    let start = Instant::now();
    let customers: Vec<i64> = (0..n_customers).map(|i| company(&conn, &format!("Customer {:05}", i), "CUSTOMER")).collect();
    let suppliers: Vec<i64> = (0..n_suppliers).map(|i| company(&conn, &format!("Supplier {:05}", i), "SUPPLIER")).collect();
    println!("  {} companies in {:.1}s", n_customers + n_suppliers, start.elapsed().as_secs_f64());

    let start = Instant::now();
    let mut invoices = Vec::with_capacity(n_invoices);
    for i in 0..n_invoices {
        let cid = customers[i % customers.len()];
        let saved = InvoiceRepository::create(&conn, invoice_input(cid, &format!("MWW/{:06}", i), &date(i), 1 + i % 5, 1000.0 + (i % 97) as f64, 1.0 + (i % 3) as f64))
            .unwrap();
        invoices.push((saved.invoice.id, cid, saved.invoice.total_amount));
    }
    let secs = start.elapsed().as_secs_f64();
    println!("  {} invoices in {:.1}s ({:.2} ms each)", n_invoices, secs, secs * 1000.0 / n_invoices as f64);

    let start = Instant::now();
    for i in 0..n_payments.min(invoices.len()) {
        let (iid, cid, total) = invoices[i];
        // Most paid in full, every fourth paid in part.
        let amount = if i % 4 == 0 { (total / 2.0 * 100.0).round() / 100.0 } else { total };
        PaymentRepository::create_payment(&conn, payment_input(cid, &date(i + 20), iid, amount)).unwrap();
    }
    let secs = start.elapsed().as_secs_f64();
    println!("  {} payments in {:.1}s ({:.2} ms each)", n_payments, secs, secs * 1000.0 / n_payments as f64);

    let start = Instant::now();
    let mut bills = Vec::with_capacity(n_bills);
    for i in 0..n_bills {
        let sid = suppliers[i % suppliers.len()];
        let b = SupplierBillRepository::create(
            &conn,
            SupplierBillInput {
                supplier_id: sid,
                bill_number: format!("SB-{:06}", i),
                bill_date: date(i),
                total_amount: 5000.0 + (i % 50) as f64,
                notes: None,
            },
        )
        .unwrap();
        bills.push((b.bill.id, sid, 5000.0 + (i % 50) as f64));
    }
    for i in 0..n_supplier_payments.min(bills.len()) {
        let (bid, sid, total) = bills[i];
        SupplierPaymentRepository::create(
            &conn,
            SupplierPaymentInput {
                payment_number: None,
                supplier_id: sid,
                payment_date: date(i + 10),
                payment_method: None,
                reference_number: None,
                bank_name: None,
                amount_paid: total,
                remarks: None,
                allocations: vec![SupplierAllocationInput { bill_id: bid, allocated_amount: total }],
                writeoff_amount: 0.0,
            },
        )
        .unwrap();
    }
    for i in 0..n_orders {
        PurchaseOrderRepository::create(
            &conn,
            PurchaseOrderInput {
                customer_id: customers[i % customers.len()],
                po_number: format!("PO/{:06}", i),
                po_date: Some(date(i)),
                status: "NOT_STARTED".to_string(),
                notes: None,
                invoice_ids: vec![],
                quotation_id: None,
            },
        )
        .unwrap();
    }
    for i in 0..n_quotes {
        QuotationRepository::create(
            &conn,
            QuotationInput {
                customer_id: customers[i % customers.len()],
                quotation_number: format!("Q/{:06}", i),
                quotation_date: date(i),
                notes: None,
                purchase_order_ids: vec![],
            },
        )
        .unwrap();
    }
    println!("  bills, supplier payments, orders, quotations in {:.1}s", start.elapsed().as_secs_f64());
    conn.execute_batch("PRAGMA synchronous = FULL; PRAGMA wal_checkpoint(TRUNCATE);").unwrap();
    let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    println!("  database size {:.1} MB", size as f64 / 1024.0 / 1024.0);
    Seeded { path, customers }
}

#[test]
#[ignore]
fn load_read_paths_at_ten_years_of_data() {
    let dir = tempfile::tempdir().unwrap();
    let seeded = seed(dir.path());
    let manager = DatabaseManager::new(&seeded.path).unwrap();
    let conn = manager.get_connection().unwrap();
    let today = chrono::NaiveDate::from_ymd_opt(2026, 10, 15).unwrap();
    let cid = seeded.customers[7];

    println!("\nConnection:");
    time("open connection + pragmas", 200, || manager.get_connection().unwrap());

    println!("\nScreens (each is one command):");
    time("list_invoices (all)", 15, || InvoiceRepository::find_all(&conn, InvoiceFilterInput::default()).unwrap().len());
    time("list_invoices (one month)", 15, || {
        InvoiceRepository::find_all(
            &conn,
            InvoiceFilterInput { date_from: Some("2025-06-01".into()), date_to: Some("2025-06-30".into()), ..Default::default() },
        )
        .unwrap()
        .len()
    });
    time("list_invoices (search 'MWW/0123')", 15, || {
        InvoiceRepository::find_all(&conn, InvoiceFilterInput { query: Some("MWW/0123".into()), ..Default::default() }).unwrap().len()
    });
    time("list_invoices (one customer)", 15, || {
        InvoiceRepository::find_all(&conn, InvoiceFilterInput { customer_id: Some(cid), ..Default::default() }).unwrap().len()
    });
    time("get_invoice", 50, || InvoiceRepository::find_by_id(&conn, 12_345).unwrap());
    time("get_next_invoice_number", 50, || InvoiceRepository::get_next_invoice_number(&conn).unwrap());
    time("list_payments (all)", 15, || PaymentRepository::list_payments(&conn, PaymentFilterInput::default()).unwrap().len());
    time("list_payments (search 'MWW/0123')", 15, || {
        PaymentRepository::list_payments(&conn, PaymentFilterInput { query: Some("MWW/0123".into()), ..Default::default() }).unwrap().len()
    });
    time("get_payments_kpi_summary", 15, || PaymentRepository::get_payments_kpi_summary(&conn).unwrap());
    time("get_next_payment_number", 50, || PaymentRepository::get_next_payment_number(&conn).unwrap());
    time("get_unpaid_invoices_for_customer", 30, || PaymentRepository::get_unpaid_invoices_for_customer(&conn, cid, None).unwrap().len());
    time("get_invoice_payment_summary", 50, || PaymentRepository::get_invoice_payment_summary(&conn, 12_345).unwrap());
    time("list_customers", 30, || CustomerRepository::list_by_party(&conn, None).unwrap().len());
    time("search_customers ('cust')", 30, || CustomerRepository::search_by_party(&conn, "cust", None).unwrap().len());
    time("list_supplier_bills", 15, || SupplierBillRepository::list(&conn, SupplierBillFilter::default()).unwrap().len());
    time("get_supplier_bills_summary", 15, || SupplierBillRepository::summary(&conn).unwrap());
    time("list_supplier_payments", 15, || SupplierPaymentRepository::list(&conn, SupplierPaymentFilter::default()).unwrap().len());
    time("get_supplier_payments_summary", 15, || SupplierPaymentRepository::summary(&conn).unwrap());
    time("list_purchase_orders", 15, || PurchaseOrderRepository::list(&conn, PurchaseOrderFilter::default()).unwrap().len());
    time("list_quotations", 15, || QuotationRepository::list(&conn, QuotationFilter::default()).unwrap().len());
    time("reminder banner", 30, || ReminderRepository::banner(&conn, today).unwrap().len());

    println!("\nDashboard (the nine calls it makes, one after another):");
    time("dashboard total", 5, || {
        PaymentRepository::get_payments_kpi_summary(&conn).unwrap();
        InvoiceRepository::find_all(&conn, InvoiceFilterInput::default()).unwrap();
        PaymentRepository::list_payments(&conn, PaymentFilterInput::default()).unwrap();
        SupplierBillRepository::list(&conn, SupplierBillFilter::default()).unwrap();
        SupplierBillRepository::summary(&conn).unwrap();
        SupplierPaymentRepository::list(&conn, SupplierPaymentFilter::default()).unwrap();
        QuotationRepository::list(&conn, QuotationFilter::default()).unwrap();
    });

    time("dashboard as the screen now asks (6 months of payments)", 5, || {
        let six = || Some("2025-10-01".to_string());
        PaymentRepository::get_payments_kpi_summary(&conn).unwrap();
        InvoiceRepository::find_all(&conn, InvoiceFilterInput::default()).unwrap();
        PaymentRepository::list_payments(&conn, PaymentFilterInput { date_from: six(), ..Default::default() }).unwrap();
        SupplierBillRepository::list(&conn, SupplierBillFilter::default()).unwrap();
        SupplierBillRepository::summary(&conn).unwrap();
        SupplierPaymentRepository::list(&conn, SupplierPaymentFilter { date_from: six(), ..Default::default() }).unwrap();
        QuotationRepository::list(&conn, QuotationFilter::default()).unwrap();
    });

    println!("\nJSON sent to the screen:");
    let all = InvoiceRepository::find_all(&conn, InvoiceFilterInput::default()).unwrap();
    let json = serde_json::to_string(&all).unwrap();
    println!("  list_invoices (all) = {} rows, {:.1} MB of JSON", all.len(), json.len() as f64 / 1024.0 / 1024.0);
    let pays = PaymentRepository::list_payments(&conn, PaymentFilterInput::default()).unwrap();
    println!("  list_payments (all) = {} rows, {:.1} MB of JSON", pays.len(), serde_json::to_string(&pays).unwrap().len() as f64 / 1024.0 / 1024.0);

    println!("\nWrites (normal disk flush):");
    let mut n = 0;
    time("create invoice (3 lines)", 30, || {
        n += 1;
        InvoiceRepository::create(&conn, invoice_input(cid, &format!("LOAD/{}", n), "2026-10-15", 3, 1500.0, 2.0)).unwrap()
    });
    let target = InvoiceRepository::create(&conn, invoice_input(cid, "LOAD/PAY", "2026-10-15", 1, 100_000.0, 1.0)).unwrap();
    time("create payment (1 allocation)", 30, || {
        PaymentRepository::create_payment(&conn, payment_input(cid, "2026-10-15", target.invoice.id, 10.0)).unwrap()
    });

    println!("\nBackup snapshot (VACUUM INTO + gzip + hashes):");
    let backups = dir.path().join("Backups");
    time("create_snapshot", 2, || harness::backup::snapshot::create_snapshot(&conn, &backups, "load.db.gz").unwrap().size_bytes);

    println!("\nQuery plans that scan a whole table:");
    for (label, sql) in [
        ("invoices by status", "SELECT 1 FROM invoices WHERE status = 'ISSUED'"),
        ("invoices by customer+status", "SELECT 1 FROM invoices WHERE customer_id = 1 AND status = 'ISSUED' ORDER BY invoice_date"),
        ("invoice list order", "SELECT 1 FROM invoices i ORDER BY i.invoice_date DESC, i.id DESC"),
        ("payment list order", "SELECT 1 FROM payments p ORDER BY p.payment_date DESC, p.id DESC"),
        ("supplier bills order", "SELECT 1 FROM supplier_bills ORDER BY bill_date DESC, id DESC"),
        ("invoice list one month", "SELECT 1 FROM invoices i WHERE i.invoice_date >= '2025-06-01' AND i.invoice_date <= '2025-06-30' ORDER BY i.invoice_date DESC, i.id DESC"),
        ("change_log since", "SELECT COUNT(*) FROM change_log WHERE seq > 5"),
    ] {
        let plan: Vec<String> = conn
            .prepare(&format!("EXPLAIN QUERY PLAN {}", sql))
            .and_then(|mut s| s.query_map([], |r| r.get::<_, String>(3)).and_then(|rows| rows.collect()))
            .unwrap_or_else(|e| vec![format!("(not checked: {})", e)]);
        println!("  {:<28} {}", label, plan.join(" | "));
    }
}

/// Several threads writing at once on their own connections, the way commands would run if they
/// were moved off the UI thread without any coordination.
#[test]
#[ignore]
fn stress_concurrent_writers() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("stress.db");
    let manager = DatabaseManager::new(&path).unwrap();
    let conn = manager.get_connection().unwrap();
    let customers: Vec<i64> = (0..8).map(|i| company(&conn, &format!("Stress {}", i), "CUSTOMER")).collect();
    drop(conn);

    let threads = 8;
    let per_thread = 60;
    let start = Instant::now();
    let handles: Vec<_> = (0..threads)
        .map(|t| {
            let path = path.clone();
            let cid = customers[t];
            std::thread::spawn(move || {
                let manager = DatabaseManager::new(&path).unwrap();
                let mut errors = Vec::new();
                for i in 0..per_thread {
                    let conn = manager.get_connection().unwrap();
                    let number = format!("T{}/{}", t, i);
                    match InvoiceRepository::create(&conn, invoice_input(cid, &number, "2026-10-01", 2, 1000.0, 1.0)) {
                        Ok(inv) => {
                            if let Err(e) = PaymentRepository::create_payment(&conn, payment_input(cid, "2026-10-02", inv.invoice.id, 500.0)) {
                                errors.push(e);
                            }
                        }
                        Err(e) => errors.push(e),
                    }
                    let _ = InvoiceRepository::find_all(&conn, InvoiceFilterInput::default());
                }
                errors
            })
        })
        .collect();
    let errors: Vec<String> = handles.into_iter().flat_map(|h| h.join().unwrap()).collect();
    let elapsed = start.elapsed().as_secs_f64();
    let attempts = threads * per_thread * 2;
    println!(
        "{} threads x {} rounds: {} of {} writes failed in {:.1}s",
        threads, per_thread, errors.len(), attempts, elapsed
    );
    let mut kinds: Vec<&String> = errors.iter().collect();
    kinds.sort();
    kinds.dedup();
    for k in kinds.iter().take(5) {
        println!("  error: {}", k);
    }

    // Whatever happened, the books must still add up: every payment row has its allocation.
    let conn = manager.get_connection().unwrap();
    let orphans: i64 = conn
        .query_row("SELECT COUNT(*) FROM payments p WHERE NOT EXISTS (SELECT 1 FROM payment_allocations a WHERE a.payment_id = p.id)", [], |r| r.get(0))
        .unwrap();
    assert_eq!(orphans, 0, "a payment was saved without its allocation");
    let integrity: String = conn.query_row("PRAGMA integrity_check", [], |r| r.get(0)).unwrap();
    assert_eq!(integrity, "ok");
    assert!(errors.is_empty(), "{} concurrent writes failed", errors.len());
}

/// Hostile and extreme input: nothing may panic, corrupt the books or break the lists.
#[test]
#[ignore]
fn abuse_inputs_are_refused_or_handled() {
    let dir = tempfile::tempdir().unwrap();
    let manager = DatabaseManager::new(dir.path().join("abuse.db")).unwrap();
    let conn = manager.get_connection().unwrap();
    let cid = company(&conn, "Abuse Test", "CUSTOMER");

    let report = |label: &str, outcome: Result<String, String>| match outcome {
        Ok(v) => println!("  {:<44} accepted: {}", label, v),
        Err(e) => println!("  {:<44} refused:  {}", label, e),
    };

    println!("Search text with SQL and LIKE characters:");
    for q in ["' OR 1=1 --", "\"; DROP TABLE invoices; --", "%", "_", "\\", "😀", &"x".repeat(100_000)] {
        let label = format!("invoice search {:?}", q.chars().take(24).collect::<String>());
        report(&label, InvoiceRepository::find_all(&conn, InvoiceFilterInput { query: Some(q.to_string()), ..Default::default() }).map(|r| format!("{} rows", r.len())));
        report("customer search", CustomerRepository::search_by_party(&conn, q, None).map(|r| format!("{} rows", r.len())));
    }
    let tables: i64 = conn.query_row("SELECT COUNT(*) FROM sqlite_master WHERE name = 'invoices'", [], |r| r.get(0)).unwrap();
    assert_eq!(tables, 1, "invoices table must survive the search text");

    println!("\nExtreme amounts:");
    let mut n = 0;
    let mut try_invoice = |label: &str, rate: f64, qty: f64, items: usize| {
        n += 1;
        let out = InvoiceRepository::create(&conn, invoice_input(cid, &format!("AB/{}", n), "2026-10-01", items, rate, qty))
            .map(|i| format!("total {}", i.invoice.total_amount));
        report(label, out);
    };
    try_invoice("rate 1e300 x qty 1e300 (overflows)", 1e300, 1e300, 1);
    try_invoice("rate 1e15 (a thousand lakh crore)", 1e15, 1.0, 1);
    try_invoice("rate 0.001 (below a paisa)", 0.001, 1.0, 1);
    try_invoice("qty 1e-9", 1000.0, 1e-9, 1);
    try_invoice("1,000 line items", 10.0, 1.0, 1000);

    let list = InvoiceRepository::find_all(&conn, InvoiceFilterInput::default()).unwrap();
    let non_finite = list.iter().filter(|i| !i.total_amount.is_finite()).count();
    println!("  invoices saved with a total that is not a number: {}", non_finite);
    let json = serde_json::to_string(&list).unwrap();
    println!("  'null' amounts in the list JSON: {}", json.matches(":null").count());

    println!("\nLong text:");
    report(
        "customer name of 100,000 characters",
        CustomerRepository::create(
            &conn,
            CustomerCreateInput {
                name: "N".repeat(100_000),
                gstin: None,
                phone: None,
                email: None,
                address_line1: None,
                address_line2: None,
                city: None,
                state: None,
                postal_code: None,
                is_favorite: None,
                whatsapp_number: None,
                party_type: None,
            },
        )
        .map(|c| format!("{} chars", c.name.len())),
    );
    let mut long = invoice_input(cid, "AB/LONG", "2026-10-01", 1, 10.0, 1.0);
    long.items[0].description = "D".repeat(1_000_000);
    report("line description of 1,000,000 characters", InvoiceRepository::create(&conn, long).map(|i| format!("{} chars", i.items[0].description.len())));

    println!("\nHTML in fields printed on the PDF:");
    let mut html = invoice_input(cid, "AB/HTML", "2026-10-01", 1, 10.0, 1.0);
    html.items[0].hsn_sac = Some("<img src=x onerror=alert(1)>".to_string());
    html.items[0].qum = Some("<script>alert(1)</script>".to_string());
    html.items[0].description = "<script>alert(1)</script><b>ok</b>".to_string();
    report(
        "HSN / QUM / description with tags",
        InvoiceRepository::create(&conn, html).map(|i| format!("hsn {:?} qum {:?} desc {:?}", i.items[0].hsn_sac, i.items[0].qum, i.items[0].description)),
    );

    let integrity: String = conn.query_row("PRAGMA integrity_check", [], |r| r.get(0)).unwrap();
    assert_eq!(integrity, "ok");
    assert_eq!(non_finite, 0, "an invoice total overflowed to infinity");
}

/// Runs with the normal tests: a mistyped huge amount gets a clear message, never a crash.
#[test]
fn huge_amounts_are_refused_without_crashing() {
    let dir = tempfile::tempdir().unwrap();
    let manager = DatabaseManager::new(dir.path().join("huge.db")).unwrap();
    let conn = manager.get_connection().unwrap();
    let cid = company(&conn, "Huge", "CUSTOMER");
    for (rate, qty) in [(1e15, 1.0), (1e300, 1e300), (1e12, 2.0)] {
        let err = InvoiceRepository::create(&conn, invoice_input(cid, "H/1", "2026-10-01", 1, rate, qty)).unwrap_err();
        assert!(err.contains("too large"), "{}", err);
    }
    // The largest accepted amounts still have words, and amounts in words never panic.
    let ok = InvoiceRepository::create(&conn, invoice_input(cid, "H/2", "2026-10-01", 1, 5e11, 1.0)).unwrap();
    assert!(ok.invoice.amount_in_words.starts_with("FIFTY-NINE THOUSAND CRORE"), "{}", ok.invoice.amount_in_words);
    for n in [i64::MAX, i64::MIN, 1_000_00_00_000, 99_999_99_99_999] {
        assert!(InvoiceRepository::number_to_words(n).ends_with("RUPEES"));
    }
    assert_eq!(InvoiceRepository::number_to_words(1_00_000_00_00_000), "ONE LAKH CRORE RUPEES");
    // A tax rate over 100% is a mistake.
    let mut bad = invoice_input(cid, "H/3", "2026-10-01", 1, 100.0, 1.0);
    bad.cgst_rate = Some(900.0);
    assert!(InvoiceRepository::create(&conn, bad).unwrap_err().contains("tax rate"));
}

/// The original round2 (every value through a 15-digit text round trip). The fast version must
/// give exactly the same result for every amount.
fn round2_reference(value: f64) -> f64 {
    if !value.is_finite() {
        return value;
    }
    let paise: f64 = format!("{:.14e}", value * 100.0).parse().unwrap_or(value * 100.0);
    let rounded = paise.round() / 100.0;
    if rounded == 0.0 { 0.0 } else { rounded }
}

#[test]
fn fast_round2_matches_the_reference_exactly() {
    use harness::util::round2;
    let mut seed: u64 = 0x9E37_79B9_7F4A_7C15;
    let mut next = || {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        seed
    };
    let mut values: Vec<f64> = vec![1.005, 1000.005, 2.675, 0.145 * 7.0, 0.1 + 0.2, -0.004, -0.005, -2.675, 0.0, 1e12, 9.995, 1.115];
    for _ in 0..1_000_000 {
        let r = next();
        let paise = (r % 10_000_000_000) as f64;
        // Half-paisa values, typed amounts, quantity x rate products, GST shares and sums.
        values.push((paise + 0.5) / 100.0);
        values.push(paise / 1000.0);
        values.push(((r >> 20) % 1000) as f64 * 0.001 * ((r >> 40) % 100_000) as f64);
        values.push(paise / 100.0 * 0.09);
        values.push(-(paise + 0.5) / 100.0);
    }
    for v in values {
        assert_eq!(round2(v).to_bits(), round2_reference(v).to_bits(), "round2({:?})", v);
    }
}

// ---------------------------------------------------------------- document vault

use harness::documents::files::MAX_DOCUMENT_BYTES;
use harness::documents::models::{DocumentFilter, DocumentInput};
use harness::documents::repository::DocumentRepository;
use harness::documents::sync::{restore_missing, upload_waiting, FolderStore};

fn vault_input(n: usize, title: &str) -> DocumentInput {
    DocumentInput {
        category: if n % 3 == 0 { "FUTURE" } else { "IMPORTANT" }.to_string(),
        title: title.to_string(),
        note: (n % 4 == 0).then(|| format!("Kept in the steel cupboard, file {}", n)),
    }
}

/// Sample file contents, unique per `n`, between 2 KB and about 200 KB.
fn sample_file(n: usize) -> Vec<u8> {
    let size = 2_048 + (n * 7_919) % 200_000;
    let mut bytes = format!("%PDF-1.4 sample document {}\n", n).into_bytes();
    bytes.resize(size, b'.');
    bytes
}

#[test]
#[ignore]
fn load_document_vault_with_thousands_of_documents() {
    let dir = tempfile::tempdir().unwrap();
    let manager = DatabaseManager::new(dir.path().join("vault.db")).unwrap();
    let conn = manager.get_connection().unwrap();
    let vault = dir.path().join("Documents");
    let drive = FolderStore { dir: dir.path().join("Drive") };
    let count = 2_000 * scale();

    let start = Instant::now();
    let mut add_times = Vec::with_capacity(count);
    let mut total_bytes = 0usize;
    for n in 0..count {
        let bytes = sample_file(n);
        total_bytes += bytes.len();
        let t = Instant::now();
        DocumentRepository::add(&conn, &vault, &vault_input(n, &format!("Sample document {}", n)), &format!("doc-{}.pdf", n), &bytes)
            .unwrap();
        add_times.push(t.elapsed());
    }
    add_times.sort();
    println!(
        "  {} documents ({:.0} MB) added in {:.1}s (median {:.2} ms, worst {:.2} ms each)",
        count,
        total_bytes as f64 / 1_048_576.0,
        start.elapsed().as_secs_f64(),
        add_times[count / 2].as_secs_f64() * 1000.0,
        add_times[count - 1].as_secs_f64() * 1000.0
    );

    let (all, _) = time("list_documents (all)", 20, || DocumentRepository::list(&conn, &DocumentFilter::default()).unwrap());
    time("list_documents (Important tab)", 20, || {
        DocumentRepository::list(&conn, &DocumentFilter { category: Some("IMPORTANT".into()), query: None }).unwrap()
    });
    let (search, _) = time("list_documents (search 'cupboard 1999')", 20, || {
        DocumentRepository::list(&conn, &DocumentFilter { category: None, query: Some("cupboard 1999".into()) }).unwrap()
    });
    let (summary, _) = time("get_document_summary", 50, || DocumentRepository::summary(&conn).unwrap());
    let (missing, _) = time("missing_files (checks every file on disk)", 5, || DocumentRepository::missing_files(&conn, &vault).unwrap());
    assert!(all < 500.0, "listing every document took {:.0} ms", all);
    assert!(search < 500.0, "search took {:.0} ms", search);
    assert!(summary < 100.0, "the counts took {:.0} ms", summary);
    assert!(missing < 2_000.0, "checking the files took {:.0} ms", missing);

    println!("Big files (25 MB each, the largest allowed):");
    for n in 0..3 {
        let mut big = vec![b'x'; MAX_DOCUMENT_BYTES];
        big[..8].copy_from_slice(&(n as u64).to_le_bytes());
        let t = Instant::now();
        DocumentRepository::add(&conn, &vault, &vault_input(n, &format!("Big scan {}", n)), "scan.pdf", &big).unwrap();
        println!("  add 25 MB file                                 {:>8.0} ms", t.elapsed().as_secs_f64() * 1000.0);
    }
    let big_id = DocumentRepository::list(&conn, &DocumentFilter { category: None, query: Some("Big scan 0".into()) }).unwrap()[0].id;
    time("read a 25 MB file back (checks its SHA-256)", 5, || DocumentRepository::read(&conn, &vault, big_id).unwrap());

    println!("First backup of the whole vault to the Drive stand-in:");
    let t = Instant::now();
    let copied = upload_waiting(&conn, &vault, &drive, &mut |_, _, _| {}).unwrap();
    println!("  {} documents copied in {:.1}s", copied, t.elapsed().as_secs_f64());
    assert_eq!(copied, count + 3);
    let t = Instant::now();
    assert_eq!(upload_waiting(&conn, &vault, &drive, &mut |_, _, _| {}).unwrap(), 0);
    println!("  next backup with nothing new: {:.1} ms", t.elapsed().as_secs_f64() * 1000.0);

    println!("Restore on a new computer (empty Documents folder):");
    let new_vault = dir.path().join("NewDocuments");
    let t = Instant::now();
    let report = restore_missing(&conn, &new_vault, &drive).unwrap();
    println!("  {} documents brought back in {:.1}s", report.restored, t.elapsed().as_secs_f64());
    assert_eq!(report.restored as usize, count + 3);
    assert!(report.failed.is_empty() && report.not_on_drive.is_empty());
}

#[test]
#[ignore]
fn abuse_and_stress_the_document_vault() {
    let dir = tempfile::tempdir().unwrap();
    let manager = DatabaseManager::new(dir.path().join("vault-abuse.db")).unwrap();
    let conn = manager.get_connection().unwrap();
    let vault = dir.path().join("Documents");
    let input = |title: &str| DocumentInput { category: "IMPORTANT".into(), title: title.into(), note: None };
    let report = |label: &str, outcome: Result<String, String>| match outcome {
        Ok(v) => println!("  {:<46} accepted: {}", label, v),
        Err(e) => println!("  {:<46} refused:  {}", label, e),
    };

    println!("Sizes and kinds:");
    let mut n = 0u32;
    let mut add = |label: &str, title: &str, name: &str, bytes: &[u8]| {
        n += 1;
        let mut unique = bytes.to_vec();
        unique.extend_from_slice(&n.to_le_bytes());
        let out = DocumentRepository::add(&conn, &vault, &input(title), name, &unique);
        report(label, out.as_ref().map(|d| format!("\"{}\" as {}", d.title, d.file_name)).map_err(Clone::clone));
        out.is_ok()
    };
    assert!(!add("25 MB + 1 byte", "Too big", "big.pdf", &vec![b'x'; MAX_DOCUMENT_BYTES - 3]));
    assert!(add("exactly 25 MB", "Big", "big.pdf", &vec![b'y'; MAX_DOCUMENT_BYTES - 4]));
    assert!(!add("setup.exe", "Setup", "setup.exe", b"MZ program"));
    assert!(!add("program renamed to invoice.pdf", "Invoice", "invoice.pdf", b"MZ\x90\x00 program"));
    assert!(!add("script.ps1", "Script", "script.ps1", b"Remove-Item"));
    assert!(!add("shortcut.LNK", "Shortcut", "shortcut.LNK", b"L\x00\x00\x00"));
    assert!(add("photo.heic (any document type)", "Photo", "photo.heic", b"....ftypheic"));
    assert!(add("archive.zip", "Archive", "archive.zip", b"PK\x03\x04"));
    assert!(add("no extension", "Plain", "README", b"text"));

    println!("\nHostile names and text:");
    assert!(add("path climbing out of the folder", "Climb", "..\\..\\Windows\\System32\\x.pdf", b"%PDF climb"));
    assert!(add("reserved characters", "Chars", "a<b>c:d\"e|f?g*.pdf", b"%PDF chars"));
    assert!(add("300-character name", "Long name", &format!("{}.pdf", "n".repeat(300)), b"%PDF long"));
    assert!(add("emoji and Tamil", "\u{0ba4}\u{0bae}\u{0bbf}\u{0bb4}\u{0bcd} \u{1F600}", "\u{0baa}\u{0ba4}\u{0bcd}\u{0ba4}\u{0bbf}\u{0bb0}\u{0bae}\u{0bcd} \u{1F600}.pdf", b"%PDF tamil"));
    assert!(!add("100,000-character title", &"t".repeat(100_000), "a.pdf", b"%PDF title"));
    let long_note = DocumentInput { note: Some("n".repeat(100_000)), ..input("Note") };
    let out = DocumentRepository::add(&conn, &vault, &long_note, "note.pdf", b"%PDF note");
    report("100,000-character note", out.as_ref().map(|d| d.title.clone()).map_err(Clone::clone));
    assert!(out.is_err());
    let odd_group = DocumentInput { category: "IMPORTANT'); DROP TABLE documents; --".into(), ..input("Group") };
    assert!(DocumentRepository::add(&conn, &vault, &odd_group, "g.pdf", b"%PDF group").is_err());

    // Every stored file is one plain file directly inside the Documents folder.
    for entry in std::fs::read_dir(&vault).unwrap() {
        let entry = entry.unwrap();
        assert!(entry.file_type().unwrap().is_file());
        let name = entry.file_name().to_string_lossy().to_string();
        assert!(harness::documents::files::is_sha256(&name), "unexpected file in the vault: {}", name);
    }
    for doc in DocumentRepository::list(&conn, &DocumentFilter::default()).unwrap() {
        assert!(!doc.file_name.contains(['\\', '/', '<', '>', ':', '"', '|', '?', '*']), "{}", doc.file_name);
        assert!(doc.file_name.chars().count() <= 120);
    }

    println!("\nSearch text with SQL and LIKE characters:");
    let long = "x".repeat(100_000);
    for q in ["' OR 1=1 --", "\"; DROP TABLE documents; --", "%", "_", "\\", "\u{1F600}", long.as_str()] {
        let out = DocumentRepository::list(&conn, &DocumentFilter { category: None, query: Some(q.to_string()) });
        report(&format!("search {:?}", q.chars().take(24).collect::<String>()), out.map(|r| format!("{} rows", r.len())));
    }
    let category = DocumentFilter { category: Some("' OR 1=1 --".into()), query: None };
    assert_eq!(DocumentRepository::list(&conn, &category).unwrap().len(), 0);
    let tables: i64 = conn.query_row("SELECT COUNT(*) FROM sqlite_master WHERE name = 'documents'", [], |r| r.get(0)).unwrap();
    assert_eq!(tables, 1, "documents table must survive the search text");

    println!("\nEight people adding at once (shared database file, 25 files each, one file added by all):");
    let db_path = dir.path().join("vault-abuse.db");
    let started = Instant::now();
    let results: Vec<(usize, usize)> = std::thread::scope(|s| {
        let handles: Vec<_> = (0..8)
            .map(|t| {
                let db_path = db_path.clone();
                let vault = vault.clone();
                s.spawn(move || {
                    let conn = DatabaseManager::new(&db_path).unwrap().get_connection().unwrap();
                    let (mut ok, mut failed) = (0, 0);
                    for i in 0..25 {
                        // Every thread also tries the very same "shared" file once.
                        let bytes = if i == 0 { b"%PDF the same shared file".to_vec() } else { sample_file(10_000 + t * 100 + i) };
                        let input = DocumentInput { category: "FUTURE".into(), title: format!("T{} #{}", t, i), note: None };
                        match DocumentRepository::add(&conn, &vault, &input, "x.pdf", &bytes) {
                            Ok(_) => ok += 1,
                            Err(e) => {
                                assert!(e.contains("already in the vault"), "unexpected failure: {}", e);
                                failed += 1;
                            }
                        }
                    }
                    (ok, failed)
                })
            })
            .collect();
        handles.into_iter().map(|h| h.join().unwrap()).collect()
    });
    let ok: usize = results.iter().map(|r| r.0).sum();
    let dup: usize = results.iter().map(|r| r.1).sum();
    println!("  {} saved, {} refused as duplicates, in {:.1}s", ok, dup, started.elapsed().as_secs_f64());
    assert_eq!(ok, 8 * 24 + 1, "every unique file saved and the shared one exactly once");
    assert_eq!(dup, 7);
    assert!(DocumentRepository::missing_files(&conn, &vault).unwrap().is_empty(), "no saved document lost its file");
}
