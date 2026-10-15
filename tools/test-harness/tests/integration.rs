//! Integration tests: records made through one module and read, guarded or changed by another,
//! on a real migrated database. The unit tests next to each repository check that module alone.

use chrono::NaiveDate;
use harness::backup::repository::BackupRepository;
use harness::backup::snapshot;
use harness::customers::models::{CustomerCreateInput, CustomerUpdateInput};
use harness::customers::repository::CustomerRepository;
use harness::db::DatabaseManager;
use harness::invoices::models::{InvoiceCreateInput, InvoiceFilterInput, InvoiceItemInput};
use harness::invoices::repository::InvoiceRepository;
use harness::payments::models::{PaymentAllocationInput, PaymentInput};
use harness::payments::repository::PaymentRepository;
use harness::payroll::models::{EmployeeInput, EmployeePaymentInput};
use harness::payroll::repository::PayrollRepository;
use harness::purchase_orders::models::PurchaseOrderInput;
use harness::purchase_orders::repository::PurchaseOrderRepository;
use harness::quotations::models::QuotationInput;
use harness::quotations::repository::QuotationRepository;
use harness::reminders::models::ReminderInput;
use harness::reminders::repository::ReminderRepository;
use harness::rentals::models::{MarkPaidInput, PlaceInput, TenantInput};
use harness::rentals::repository::RentalRepository;
use harness::settings::repository::SettingsRepository;
use harness::supplier_bills::models::SupplierBillInput;
use harness::supplier_bills::repository::SupplierBillRepository;
use harness::supplier_payments::models::{SupplierAllocationInput, SupplierPaymentInput};
use harness::supplier_payments::repository::SupplierPaymentRepository;
use rusqlite::Connection;

fn setup() -> (tempfile::TempDir, Connection) {
    let dir = tempfile::tempdir().unwrap();
    let conn = DatabaseManager::new(dir.path().join("integration.db")).unwrap().get_connection().unwrap();
    (dir, conn)
}

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

fn company(conn: &Connection, name: &str, party: &str) -> i64 {
    CustomerRepository::create(
        conn,
        CustomerCreateInput {
            name: name.to_string(),
            gstin: None,
            phone: None,
            email: None,
            address_line1: None,
            address_line2: None,
            city: None,
            state: Some("Puducherry".to_string()),
            postal_code: None,
            is_favorite: None,
            whatsapp_number: None,
            party_type: Some(party.to_string()),
        },
    )
    .unwrap()
    .id
}

fn set_party(conn: &Connection, id: i64, party: &str) -> Result<(), String> {
    let c = CustomerRepository::find_by_id(conn, id).unwrap().unwrap();
    CustomerRepository::update(
        conn,
        id,
        CustomerUpdateInput {
            name: c.name,
            gstin: c.gstin,
            phone: c.phone,
            email: c.email,
            address_line1: c.address_line1,
            address_line2: c.address_line2,
            city: c.city,
            state: c.state,
            postal_code: c.postal_code,
            is_favorite: None,
            whatsapp_number: c.whatsapp_number,
            party_type: Some(party.to_string()),
        },
    )
    .map(|_| ())
}

/// An issued Puducherry invoice: `amount` before tax, CGST and SGST at 9% each.
fn invoice_input(customer_id: i64, number: &str, amount: f64) -> InvoiceCreateInput {
    InvoiceCreateInput {
        invoice_number: number.to_string(),
        invoice_date: "2026-04-10".to_string(),
        due_date: None,
        payment_terms_days: None,
        invoice_state: None,
        customer_id: Some(customer_id),
        customer_name: "Customer".to_string(),
        customer_address: None,
        customer_phone: None,
        customer_gstin: None,
        customer_state: Some("Puducherry".to_string()),
        customer_state_code: Some("34".to_string()),
        po_number_and_date: None,
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
        items: vec![InvoiceItemInput {
            sl_no: None,
            description: "Gate welding".to_string(),
            hsn_sac: Some("9987".to_string()),
            qum: Some("Nos".to_string()),
            quantity: 1.0,
            rate: amount,
        }],
    }
}

fn invoice(conn: &Connection, customer_id: i64, number: &str, amount: f64) -> i64 {
    InvoiceRepository::create(conn, invoice_input(customer_id, number, amount)).unwrap().invoice.id
}

fn payment(customer_id: i64, received: f64, allocs: &[(i64, f64)], credit: f64, action: &str) -> PaymentInput {
    PaymentInput {
        payment_number: None,
        customer_id,
        payment_date: "2026-05-01".to_string(),
        payment_method: None,
        reference_number: None,
        bank_name: Some("SBI".to_string()),
        amount_received: received,
        tds_amount: 0.0,
        tds_recognized: true,
        credit_to_apply: credit,
        is_verified: true,
        remarks: None,
        allocations: allocs.iter().map(|(id, a)| PaymentAllocationInput { invoice_id: *id, allocated_amount: *a }).collect(),
        excess_action: Some(action.to_string()),
        writeoff_amount: 0.0,
    }
}

fn status_of(conn: &Connection, invoice_id: i64) -> (String, f64) {
    let row = InvoiceRepository::find_all(conn, InvoiceFilterInput::default())
        .unwrap()
        .into_iter()
        .find(|i| i.id == invoice_id)
        .unwrap();
    (row.payment_status, row.outstanding_amount)
}

fn order_input(customer_id: i64, number: &str, invoices: Vec<i64>, quotation: Option<i64>) -> PurchaseOrderInput {
    PurchaseOrderInput {
        customer_id,
        po_number: number.to_string(),
        po_date: Some("2026-04-01".to_string()),
        status: "NOT_STARTED".to_string(),
        notes: None,
        invoice_ids: invoices,
        quotation_id: quotation,
    }
}

fn quotation(conn: &Connection, customer_id: i64, number: &str) -> i64 {
    QuotationRepository::create(
        conn,
        QuotationInput {
            customer_id,
            quotation_number: number.to_string(),
            quotation_date: "2026-03-20".to_string(),
            notes: None,
            purchase_order_ids: vec![],
        },
    )
    .unwrap()
    .quotation
    .id
}

fn bill(conn: &Connection, supplier: i64, number: &str, total: f64) -> i64 {
    SupplierBillRepository::create(
        conn,
        SupplierBillInput {
            supplier_id: supplier,
            bill_number: number.to_string(),
            bill_date: "2026-04-10".to_string(),
            total_amount: total,
            notes: None,
        },
    )
    .unwrap()
    .bill
    .id
}

fn supplier_pay(supplier: i64, paid: f64, allocs: &[(i64, f64)], writeoff: f64) -> SupplierPaymentInput {
    SupplierPaymentInput {
        payment_number: None,
        supplier_id: supplier,
        payment_date: "2026-05-01".to_string(),
        payment_method: None,
        reference_number: None,
        bank_name: None,
        amount_paid: paid,
        remarks: None,
        allocations: allocs.iter().map(|(id, a)| SupplierAllocationInput { bill_id: *id, allocated_amount: *a }).collect(),
        writeoff_amount: writeoff,
    }
}

fn reminder(kind: Option<&str>, id: Option<i64>) -> ReminderInput {
    ReminderInput {
        title: "Follow up".to_string(),
        note: None,
        due_date: "2026-06-01".to_string(),
        remind_days: 3,
        repeat: "NONE".to_string(),
        month_end: false,
        link_kind: kind.map(str::to_string),
        link_id: id,
    }
}

fn today() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 5, 30).unwrap()
}

// ---------------------------------------------------------------- customers, invoices, payments

#[test]
fn an_invoice_is_paid_off_through_payments_and_advances() {
    let (_dir, conn) = setup();
    let c = company(&conn, "Sri Ram Industries", "CUSTOMER");
    let inv = invoice(&conn, c, "MWW/26-27/001", 10_000.0);
    let total = InvoiceRepository::find_by_id(&conn, inv).unwrap().unwrap().invoice.total_amount;
    assert_eq!(total, 11_800.0, "Puducherry: CGST 9% + SGST 9%");
    assert_eq!(status_of(&conn, inv), ("UNPAID".to_string(), 11_800.0));

    // Part payment: the invoice, its payment summary, the unpaid list and the totals all agree.
    let p1 = PaymentRepository::create_payment(&conn, payment(c, 5_000.0, &[(inv, 5_000.0)], 0.0, "CREDIT")).unwrap();
    assert_eq!(status_of(&conn, inv), ("PARTIALLY PAID".to_string(), 6_800.0));
    let summary = PaymentRepository::get_invoice_payment_summary(&conn, inv).unwrap();
    assert_eq!((summary.total_settled, summary.outstanding_amount), (5_000.0, 6_800.0));
    assert_eq!(summary.payments.len(), 1);
    let unpaid = PaymentRepository::get_unpaid_invoices_for_customer(&conn, c, None).unwrap();
    assert_eq!(unpaid.len(), 1);
    assert_eq!(unpaid[0].outstanding_amount, 6_800.0);
    assert_eq!(PaymentRepository::get_payments_kpi_summary(&conn).unwrap().total_outstanding, 6_800.0);

    // An invoice with payments can't be deleted or cancelled, and neither can its customer.
    assert!(InvoiceRepository::delete(&conn, inv).is_err());
    assert!(InvoiceRepository::set_cancelled(&conn, inv, true).is_err());
    assert!(CustomerRepository::delete(&conn, c).is_err());

    // Paying 8,000 against 6,800 leaves a 1,200 advance.
    let p2 = PaymentRepository::create_payment(&conn, payment(c, 8_000.0, &[(inv, 6_800.0)], 0.0, "CREDIT")).unwrap();
    assert_eq!(status_of(&conn, inv), ("PAID".to_string(), 0.0));
    let credits = PaymentRepository::get_customer_credits(&conn, c, None).unwrap();
    assert_eq!(credits.iter().map(|k| k.remaining_amount).sum::<f64>(), 1_200.0);
    assert_eq!(PaymentRepository::get_payments_kpi_summary(&conn).unwrap().advances_held, 1_200.0);

    // The advance pays most of the next invoice.
    let inv2 = invoice(&conn, c, "MWW/26-27/002", 1_000.0); // 1,180
    let p3 = PaymentRepository::create_payment(&conn, payment(c, 0.0, &[(inv2, 1_180.0)], 1_200.0, "CREDIT")).unwrap();
    assert_eq!(status_of(&conn, inv2), ("PAID".to_string(), 0.0));
    let left: f64 = PaymentRepository::get_customer_credits(&conn, c, None).unwrap().iter().map(|k| k.remaining_amount).sum();
    assert_eq!(left, 20.0);

    // The payment whose advance was used can't go first; undoing in reverse order works.
    assert!(PaymentRepository::delete_payment(&conn, p2.payment.id).is_err());
    PaymentRepository::delete_payment(&conn, p3.payment.id).unwrap();
    assert_eq!(status_of(&conn, inv2), ("UNPAID".to_string(), 1_180.0));
    PaymentRepository::delete_payment(&conn, p2.payment.id).unwrap();
    assert_eq!(status_of(&conn, inv), ("PARTIALLY PAID".to_string(), 6_800.0));
    assert!(PaymentRepository::get_customer_credits(&conn, c, None).unwrap().iter().all(|k| k.remaining_amount == 0.0));
    PaymentRepository::delete_payment(&conn, p1.payment.id).unwrap();

    // With every payment gone the invoices and then the customer can be removed.
    InvoiceRepository::delete(&conn, inv).unwrap();
    InvoiceRepository::delete(&conn, inv2).unwrap();
    CustomerRepository::delete(&conn, c).unwrap();
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM payment_allocations"), 0);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM customer_credits WHERE remaining_amount > 0"), 0);
}

#[test]
fn a_cancelled_invoice_counts_nowhere() {
    let (_dir, conn) = setup();
    let c = company(&conn, "Kumar Steels", "CUSTOMER");
    let inv = invoice(&conn, c, "MWW/26-27/010", 1_000.0);
    InvoiceRepository::set_cancelled(&conn, inv, true).unwrap();
    assert!(PaymentRepository::get_unpaid_invoices_for_customer(&conn, c, None).unwrap().is_empty());
    assert_eq!(PaymentRepository::get_payments_kpi_summary(&conn).unwrap().total_outstanding, 0.0);
    assert!(PaymentRepository::create_payment(&conn, payment(c, 1_180.0, &[(inv, 1_180.0)], 0.0, "CREDIT")).is_err());
    InvoiceRepository::set_cancelled(&conn, inv, false).unwrap();
    assert_eq!(status_of(&conn, inv), ("UNPAID".to_string(), 1_180.0));
}

#[test]
fn a_payment_only_covers_the_payers_own_invoices() {
    let (_dir, conn) = setup();
    let a = company(&conn, "A Works", "CUSTOMER");
    let b = company(&conn, "B Works", "CUSTOMER");
    let inv_b = invoice(&conn, b, "MWW/26-27/020", 1_000.0);
    assert!(PaymentRepository::create_payment(&conn, payment(a, 1_180.0, &[(inv_b, 1_180.0)], 0.0, "CREDIT")).is_err());
    assert_eq!(status_of(&conn, inv_b), ("UNPAID".to_string(), 1_180.0));
}

// ---------------------------------------------------------------- party types across modules

#[test]
fn each_module_accepts_only_the_right_kind_of_company() {
    let (_dir, conn) = setup();
    let cust = company(&conn, "Only Customer", "CUSTOMER");
    let supp = company(&conn, "Only Supplier", "SUPPLIER");
    let both = company(&conn, "Both Ways", "BOTH");

    // Customer side refuses a supplier-only company.
    assert!(InvoiceRepository::create(&conn, invoice_input(supp, "X/1", 100.0)).is_err());
    assert!(PurchaseOrderRepository::create(&conn, order_input(supp, "PO-S", vec![], None)).is_err());
    assert!(QuotationRepository::create(
        &conn,
        QuotationInput { customer_id: supp, quotation_number: "Q-S".into(), quotation_date: "2026-04-01".into(), notes: None, purchase_order_ids: vec![] }
    )
    .is_err());
    assert!(PaymentRepository::create_payment(&conn, payment(supp, 100.0, &[], 0.0, "CREDIT")).is_err());

    // Supplier side refuses a customer-only company.
    assert!(SupplierBillRepository::create(
        &conn,
        SupplierBillInput { supplier_id: cust, bill_number: "B-C".into(), bill_date: "2026-04-01".into(), total_amount: 100.0, notes: None }
    )
    .is_err());

    // "Both" works on both sides.
    let inv = invoice(&conn, both, "X/2", 100.0);
    let b = bill(&conn, both, "B-1", 500.0);
    SupplierPaymentRepository::create(&conn, supplier_pay(both, 500.0, &[(b, 500.0)], 0.0)).unwrap();

    // A side with records can't be dropped from the company's type.
    assert!(set_party(&conn, both, "SUPPLIER").is_err(), "it has an invoice");
    assert!(set_party(&conn, both, "CUSTOMER").is_err(), "it has a bill");
    InvoiceRepository::delete(&conn, inv).unwrap();
    set_party(&conn, both, "SUPPLIER").unwrap();
    assert!(InvoiceRepository::create(&conn, invoice_input(both, "X/3", 100.0)).is_err());

    // Customer-only company with no supplier records can become Both, then take a bill.
    set_party(&conn, cust, "BOTH").unwrap();
    bill(&conn, cust, "B-2", 50.0);
}

// ---------------------------------------------------------------- quotations, purchase orders, invoices

#[test]
fn quotation_order_and_invoice_link_up_for_one_customer() {
    let (_dir, conn) = setup();
    let a = company(&conn, "Anbu Engineering", "CUSTOMER");
    let b = company(&conn, "Other Co", "CUSTOMER");
    let q = quotation(&conn, a, "Q-101");
    let inv = invoice(&conn, a, "MWW/26-27/030", 2_000.0);

    let po = PurchaseOrderRepository::create(&conn, order_input(a, "PO-55", vec![inv], Some(q))).unwrap();
    let po_id = po.order.id;
    assert_eq!(po.invoices.iter().map(|i| i.id).collect::<Vec<_>>(), vec![inv]);
    let text = InvoiceRepository::find_by_id(&conn, inv).unwrap().unwrap().invoice;
    assert_eq!(text.purchase_order_id, Some(po_id));
    assert_eq!(text.po_number_and_date.as_deref(), Some(PurchaseOrderRepository::po_reference_text("PO-55", Some("2026-04-01")).as_str()));
    let qd = QuotationRepository::get(&conn, q).unwrap().unwrap();
    assert_eq!(qd.orders.iter().map(|o| o.id).collect::<Vec<_>>(), vec![po_id]);

    // Nothing links across customers.
    let inv_b = invoice(&conn, b, "MWW/26-27/031", 500.0);
    assert!(PurchaseOrderRepository::set_invoice_link(&conn, inv_b, Some(po_id)).is_err());
    let po_b = PurchaseOrderRepository::create(&conn, order_input(b, "PO-B", vec![], None)).unwrap().order.id;
    assert!(QuotationRepository::set_purchase_order_link(&conn, po_b, Some(q)).is_err());
    assert!(PurchaseOrderRepository::create(&conn, order_input(b, "PO-B2", vec![inv], None)).is_err());

    // An invoice made with the order already chosen is linked and gets the text too.
    let mut input = invoice_input(a, "MWW/26-27/032", 300.0);
    input.purchase_order_id = Some(po_id);
    let inv2 = InvoiceRepository::create(&conn, input).unwrap().invoice;
    assert_eq!(inv2.purchase_order_id, Some(po_id));
    assert_eq!(inv2.po_number_and_date, text.po_number_and_date);
    let mut wrong = invoice_input(b, "MWW/26-27/033", 300.0);
    wrong.purchase_order_id = Some(po_id);
    assert!(InvoiceRepository::create(&conn, wrong).is_err(), "an invoice can't name another customer's order");

    // Linked records hold each other: unlink, then delete from the bottom up.
    assert!(QuotationRepository::delete(&conn, q).is_err());
    assert!(PurchaseOrderRepository::delete(&conn, po_id).is_err());
    assert!(CustomerRepository::delete(&conn, a).is_err());
    PurchaseOrderRepository::set_invoice_link(&conn, inv, None).unwrap();
    InvoiceRepository::delete(&conn, inv2.id).unwrap();
    assert_eq!(
        InvoiceRepository::find_by_id(&conn, inv).unwrap().unwrap().invoice.po_number_and_date,
        text.po_number_and_date,
        "unlinking leaves an issued invoice's text alone"
    );
    PurchaseOrderRepository::delete(&conn, po_id).unwrap();
    QuotationRepository::delete(&conn, q).unwrap();
    InvoiceRepository::delete(&conn, inv).unwrap();
    CustomerRepository::delete(&conn, a).unwrap();
}

#[test]
fn attachments_are_removed_with_their_record() {
    let (_dir, conn) = setup();
    let a = company(&conn, "Files Co", "BOTH");
    let q = quotation(&conn, a, "Q-F");
    let po = PurchaseOrderRepository::create(&conn, order_input(a, "PO-F", vec![], None)).unwrap().order.id;
    let b = bill(&conn, a, "B-F", 10.0);
    QuotationRepository::add_file(&conn, q, "quote.pdf", b"%PDF-1.4 q").unwrap();
    PurchaseOrderRepository::add_file(&conn, po, "order.pdf", b"%PDF-1.4 p").unwrap();
    SupplierBillRepository::add_file(&conn, b, "bill.pdf", b"%PDF-1.4 b").unwrap();
    QuotationRepository::delete(&conn, q).unwrap();
    PurchaseOrderRepository::delete(&conn, po).unwrap();
    SupplierBillRepository::delete(&conn, b).unwrap();
    for table in ["quotation_files", "purchase_order_files", "supplier_bill_files"] {
        assert_eq!(count(&conn, &format!("SELECT COUNT(*) FROM {}", table)), 0, "{} left behind", table);
    }
}

// ---------------------------------------------------------------- suppliers

#[test]
fn a_supplier_bill_is_settled_and_unsettled_through_payments() {
    let (_dir, conn) = setup();
    let s = company(&conn, "Steel Traders", "SUPPLIER");
    let b1 = bill(&conn, s, "ST-1", 11_550.0);
    let b2 = bill(&conn, s, "ST-2", 2_000.0);

    // One payment settles the first bill with a 50 write-off and part-pays the second
    // (the allocation includes the part written off).
    let p = SupplierPaymentRepository::create(&conn, supplier_pay(s, 12_500.0, &[(b1, 11_550.0), (b2, 1_000.0)], 50.0)).unwrap();
    let d1 = SupplierBillRepository::get(&conn, b1).unwrap().unwrap();
    let d2 = SupplierBillRepository::get(&conn, b2).unwrap().unwrap();
    assert_eq!((d1.status.as_str(), d1.outstanding_amount), ("PAID", 0.0));
    assert_eq!((d2.status.as_str(), d2.outstanding_amount), ("PARTIAL", 1_000.0));
    let open = SupplierPaymentRepository::unpaid_bills_for_supplier(&conn, s, None).unwrap();
    assert_eq!(open.iter().map(|u| u.bill_id).collect::<Vec<_>>(), vec![b2]);
    assert_eq!(SupplierBillRepository::summary(&conn).unwrap().total_outstanding, 1_000.0);

    // A bill with payments, and its supplier, stay put.
    assert!(SupplierBillRepository::delete(&conn, b1).is_err());
    assert!(CustomerRepository::delete(&conn, s).is_err());

    // Deleting the payment reopens both bills; then everything can go.
    SupplierPaymentRepository::delete(&conn, p.payment.id).unwrap();
    assert_eq!(SupplierBillRepository::get(&conn, b1).unwrap().unwrap().status, "NOT_PAID");
    assert_eq!(SupplierBillRepository::get(&conn, b2).unwrap().unwrap().outstanding_amount, 2_000.0);
    SupplierBillRepository::delete(&conn, b1).unwrap();
    SupplierBillRepository::delete(&conn, b2).unwrap();
    CustomerRepository::delete(&conn, s).unwrap();
}

// ---------------------------------------------------------------- reminders linked to records

#[test]
fn reminders_link_to_records_of_every_module() {
    let (_dir, conn) = setup();
    let c = company(&conn, "Reminder Co", "BOTH");
    let inv = invoice(&conn, c, "MWW/26-27/040", 100.0);
    let q = quotation(&conn, c, "Q-R");
    let po = PurchaseOrderRepository::create(&conn, order_input(c, "PO-R", vec![], None)).unwrap().order.id;
    let pay = PaymentRepository::create_payment(&conn, payment(c, 50.0, &[(inv, 50.0)], 0.0, "CREDIT")).unwrap().payment.id;
    let b = bill(&conn, c, "B-R", 100.0);
    let sp = SupplierPaymentRepository::create(&conn, supplier_pay(c, 100.0, &[(b, 100.0)], 0.0)).unwrap().payment.id;
    let place = RentalRepository::create_place(&conn, PlaceInput { name: "Shop 1".into(), address: None, monthly_rent: 5_000.0, notes: None }).unwrap().place.id;
    let tenant = RentalRepository::create_tenant(
        &conn,
        TenantInput { place_id: place, name: "Ravi".into(), whatsapp_number: "9876543210".into(), monthly_rent: 5_000.0, move_in_date: Some("2026-04-01".into()), notes: None },
    )
    .unwrap()
    .tenant
    .id;

    let links = [
        ("INVOICE", inv, "MWW/26-27/040"),
        ("QUOTATION", q, "Q-R"),
        ("PURCHASE_ORDER", po, "PO-R"),
        ("PAYMENT", pay, ""),
        ("SUPPLIER_BILL", b, "B-R"),
        ("SUPPLIER_PAYMENT", sp, ""),
        ("COMPANY", c, "Reminder Co"),
        ("TENANT", tenant, "Ravi"),
        ("PLACE", place, "Shop 1"),
    ];
    for (kind, id, label) in links {
        let r = ReminderRepository::create(&conn, reminder(Some(kind), Some(id))).unwrap_or_else(|e| panic!("{}: {}", kind, e));
        let shown = ReminderRepository::get(&conn, r.id, today()).unwrap().unwrap();
        assert!(shown.link_label.is_some(), "{} link has a label", kind);
        if !label.is_empty() {
            assert_eq!(shown.link_label.as_deref(), Some(label), "{}", kind);
        }
        let on_record = ReminderRepository::for_record(&conn, kind, id, today()).unwrap();
        assert_eq!(on_record.len(), 1, "{} shows its reminder", kind);
        // A link to a record that doesn't exist is refused.
        assert!(ReminderRepository::create(&conn, reminder(Some(kind), Some(id + 1000))).is_err(), "{} missing record", kind);
    }

    // When the record goes, the reminder stays and simply loses its label.
    let r = ReminderRepository::for_record(&conn, "QUOTATION", q, today()).unwrap()[0].id;
    QuotationRepository::delete(&conn, q).unwrap();
    assert!(ReminderRepository::get(&conn, r, today()).unwrap().unwrap().link_label.is_none());
    assert_eq!(ReminderRepository::list(&conn, "DUE", today()).unwrap().len() + ReminderRepository::list(&conn, "UPCOMING", today()).unwrap().len(), links.len());
}

// ---------------------------------------------------------------- employees

#[test]
fn an_employee_with_any_pay_record_cannot_be_deleted() {
    let (_dir, conn) = setup();
    let e = PayrollRepository::create_employee(
        &conn,
        EmployeeInput {
            name: "Murugan".into(),
            role: Some("Welder".into()),
            phone: None,
            address: None,
            joined_on: "2026-04-01".into(),
            daily_wage: 800.0,
            ot_rate: 100.0,
            notes: None,
        },
    )
    .unwrap()
    .employee
    .id;
    // Only an advance handed over, no days entered yet.
    PayrollRepository::create_payment(
        &conn,
        EmployeePaymentInput {
            employee_id: e,
            month: "2026-05".into(),
            kind: "ADVANCE".into(),
            entry_date: "2026-05-05".into(),
            amount: 1_000.0,
            finish: false,
            payment_method: Some("CASH".into()),
            note: None,
        },
        "2026-05-30",
    )
    .unwrap();
    let err = PayrollRepository::delete_employee(&conn, e).unwrap_err();
    assert!(!err.contains("FOREIGN KEY"), "plain message, got: {}", err);
}

// ---------------------------------------------------------------- backup sees every module

/// Tables that hold app bookkeeping, not the owner's records.
const NOT_RECORDS: &[&str] = &["change_log", "backup_runs", "_migrations", "app_metadata", "sqlite_sequence"];

#[test]
fn every_record_table_is_watched_by_the_backup_change_log() {
    let (_dir, conn) = setup();
    let mut stmt = conn.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").unwrap();
    let tables: Vec<String> = stmt.query_map([], |r| r.get(0)).unwrap().map(Result::unwrap).collect();
    let mut missing = vec![];
    for t in tables.iter().filter(|t| !NOT_RECORDS.contains(&t.as_str())) {
        for op in ["INSERT", "UPDATE", "DELETE"] {
            let n = count(
                &conn,
                &format!(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND tbl_name = '{}'
                     AND upper(sql) LIKE '%AFTER {}%' AND sql LIKE '%change_log%'",
                    t, op
                ),
            );
            if n == 0 {
                missing.push(format!("{} {}", t, op));
            }
        }
    }
    assert!(missing.is_empty(), "no change_log trigger for: {:?}", missing);
}

#[test]
fn records_from_every_module_count_as_changes_to_back_up() {
    let (_dir, conn) = setup();
    let start = BackupRepository::max_seq(&conn).unwrap();
    assert!(!BackupRepository::pending_changes(&conn, start).unwrap().any);

    let c = company(&conn, "Backup Co", "BOTH");
    let inv = invoice(&conn, c, "MWW/26-27/050", 100.0);
    PaymentRepository::create_payment(&conn, payment(c, 118.0, &[(inv, 118.0)], 0.0, "CREDIT")).unwrap();
    let b = bill(&conn, c, "B-K", 100.0);
    SupplierPaymentRepository::create(&conn, supplier_pay(c, 100.0, &[(b, 100.0)], 0.0)).unwrap();
    quotation(&conn, c, "Q-K");
    PurchaseOrderRepository::create(&conn, order_input(c, "PO-K", vec![], None)).unwrap();
    let place = RentalRepository::create_place(&conn, PlaceInput { name: "Shed".into(), address: None, monthly_rent: 1_000.0, notes: None }).unwrap().place.id;
    let tenant = RentalRepository::create_tenant(
        &conn,
        TenantInput { place_id: place, name: "T".into(), whatsapp_number: "9876543210".into(), monthly_rent: 1_000.0, move_in_date: Some("2026-04-01".into()), notes: None },
    )
    .unwrap()
    .tenant
    .id;
    RentalRepository::mark_paid(&conn, MarkPaidInput { tenant_id: tenant, month: "2026-05".into(), paid_on: "2026-05-03".into(), amount: None, note: None }).unwrap();
    ReminderRepository::create(&conn, reminder(None, None)).unwrap();
    PayrollRepository::create_employee(
        &conn,
        EmployeeInput { name: "E".into(), role: None, phone: None, address: None, joined_on: "2026-04-01".into(), daily_wage: 500.0, ot_rate: 50.0, notes: None },
    )
    .unwrap();
    let mut settings = SettingsRepository::get(&conn).unwrap();
    settings.phone = "9443000000".into();
    SettingsRepository::save(&conn, settings).unwrap();

    let pending = BackupRepository::pending_changes(&conn, start).unwrap();
    assert!(pending.any);
    let tables: std::collections::HashSet<String> = {
        let mut stmt = conn.prepare("SELECT DISTINCT table_name FROM change_log WHERE seq > ?1").unwrap();
        stmt.query_map([start], |r| r.get(0)).unwrap().map(Result::unwrap).collect()
    };
    for t in [
        "customers", "invoices", "payments", "supplier_bills", "supplier_payments", "quotations", "purchase_orders",
        "rental_places", "rental_tenants", "rent_months", "reminders", "employees", "app_settings",
    ] {
        assert!(tables.contains(t), "{} changes are not logged for backup (logged: {:?})", t, tables);
    }
    assert!(pending.total > 0, "the summary counts the changes: {:?}", pending.lines);
}

#[test]
fn only_the_owners_setting_changes_call_for_a_backup() {
    let (_dir, conn) = setup();
    let start = BackupRepository::max_seq(&conn).unwrap();

    // The backup's own note of Drive space is not a change to back up.
    BackupRepository::save_drive_space(&conn, "LOW", Some(100)).unwrap();
    BackupRepository::save_drive_space(&conn, "OK", Some(900)).unwrap();
    assert_eq!(BackupRepository::max_seq(&conn).unwrap(), start);

    // Saving the settings once logs them; saving them again unchanged does not.
    let mut s = SettingsRepository::get(&conn).unwrap();
    s.bank_account_no = "1234567890".into();
    SettingsRepository::save(&conn, s.clone()).unwrap();
    let after_save = BackupRepository::max_seq(&conn).unwrap();
    assert!(after_save > start, "a settings change must trigger the daily backup");
    SettingsRepository::save(&conn, s).unwrap();
    assert_eq!(BackupRepository::max_seq(&conn).unwrap(), after_save);

    // Snooze choices are the owner's settings too.
    ReminderRepository::save_snooze_choices(&conn, vec![1, 2]).unwrap();
    assert!(BackupRepository::max_seq(&conn).unwrap() > after_save);
}

#[test]
fn a_snapshot_restores_every_module_intact() {
    let (dir, conn) = setup();
    let c = company(&conn, "Snapshot Co", "BOTH");
    let inv = invoice(&conn, c, "MWW/26-27/060", 1_000.0);
    PaymentRepository::create_payment(&conn, payment(c, 1_500.0, &[(inv, 1_180.0)], 0.0, "CREDIT")).unwrap();
    let po = PurchaseOrderRepository::create(&conn, order_input(c, "PO-Z", vec![inv], None)).unwrap().order.id;
    PurchaseOrderRepository::add_file(&conn, po, "po.pdf", b"%PDF-1.4 zz").unwrap();
    let b = bill(&conn, c, "B-Z", 700.0);
    SupplierPaymentRepository::create(&conn, supplier_pay(c, 650.0, &[(b, 700.0)], 50.0)).unwrap();
    ReminderRepository::create(&conn, reminder(Some("INVOICE"), Some(inv))).unwrap();

    let snap = snapshot::create_snapshot(&conn, &dir.path().join("work"), "manonmani-2026-05-30_100000-seq1.db.gz").unwrap();
    let restored = dir.path().join("restored.db");
    snapshot::gunzip(&snap.gz_path, &restored).unwrap();
    snapshot::check_integrity(&restored).unwrap();
    assert_eq!(snapshot::schema_version(&restored).unwrap(), harness::db::latest_version());

    let back = DatabaseManager::new(&restored).unwrap().get_connection().unwrap();
    assert_eq!(status_of(&back, inv), ("PAID".to_string(), 0.0));
    let credits: f64 = PaymentRepository::get_customer_credits(&back, c, None).unwrap().iter().map(|k| k.remaining_amount).sum();
    assert_eq!(credits, 320.0);
    let order = PurchaseOrderRepository::get(&back, po).unwrap().unwrap();
    assert_eq!(order.invoices.len(), 1);
    assert_eq!(order.files.len(), 1);
    assert_eq!(SupplierBillRepository::get(&back, b).unwrap().unwrap().status, "PAID");
    assert_eq!(ReminderRepository::for_record(&back, "INVOICE", inv, today()).unwrap().len(), 1);
}

// ---------------------------------------------------------------- invoice PDF: database, settings, template

/// The page data embedded in the rendered HTML (the argument of `window.populateMany`).
fn pages_in(html: &str) -> Vec<serde_json::Value> {
    let start = html.find("window.populateMany(").unwrap() + "window.populateMany(".len();
    let end = html[start..].find(");</script>").unwrap() + start;
    serde_json::from_str(&html[start..end]).unwrap()
}

#[test]
fn an_invoice_from_the_database_fills_every_field_of_the_pdf_template() {
    use harness::pdf::renderer::{CopyType, PdfRenderer};
    let (_dir, conn) = setup();
    let mut s = SettingsRepository::get(&conn).unwrap();
    s.business_name = "Mononmani Welding Works".into();
    s.bank_account_no = "1234567890".into();
    SettingsRepository::save(&conn, s).unwrap();
    let seller = SettingsRepository::get(&conn).unwrap();

    let c = company(&conn, "Template Co", "CUSTOMER");
    let inv = invoice(&conn, c, "MWW/26-27/070", 10_000.0);
    PurchaseOrderRepository::create(&conn, order_input(c, "PO-T", vec![inv], None)).unwrap();
    let data = InvoiceRepository::find_by_id(&conn, inv).unwrap().unwrap();

    let html = PdfRenderer::render_html_from_invoice(&data, CopyType::Duplicate, &seller);
    let page = &pages_in(&html)[0];

    // Every data-bind in the template names a value the renderer sends.
    let template = include_str!("../../../src-tauri/templates/invoice_template.html");
    let mut missing = vec![];
    for part in template.split("data-bind=\"").skip(1) {
        let key = &part[..part.find('"').unwrap()];
        if key.split('.').try_fold(page, |v, k| v.get(k)).is_none() {
            missing.push(key.to_string());
        }
    }
    assert!(missing.is_empty(), "template binds keys the renderer never sends: {:?}", missing);

    // Values flow through from the database and the settings.
    assert_eq!(page["seller"]["name"], "Mononmani Welding Works");
    assert_eq!(page["bank"]["account_no"], "1234567890", "the invoice carries the bank details from Settings");
    assert_eq!(page["invoice"]["number"], "MWW/26-27/070");
    assert_eq!(page["invoice"]["date"], "10-04-2026", "dates are shown DD-MM-YYYY");
    assert_eq!(page["invoice"]["copy_type"], "DUPLICATE FOR TRANSPORTER");
    assert_eq!(page["delivery"]["po_number_and_date"].as_str(), data.invoice.po_number_and_date.as_deref());
    assert_eq!(page["totals"]["igst_amount"], "", "Puducherry invoices show no IGST");
    assert!(page["totals"]["total_amount"].as_str().unwrap().contains("11,800"));
    assert_eq!(page["items"].as_array().unwrap().len(), 1);
    assert!(!html.contains("invoice_styles.css\">"), "the stylesheet is inlined");
}

#[test]
fn an_invoice_saved_without_bank_terms_or_rates_takes_them_from_settings() {
    let (_dir, conn) = setup();
    let mut s = SettingsRepository::get(&conn).unwrap();
    s.bank_name = "State Bank of India".into();
    s.bank_branch = "Lawspet".into();
    s.bank_account_no = "30001234567".into();
    s.bank_ifsc = "SBIN0001234".into();
    s.terms_and_conditions = "Goods once sold will not be taken back.".into();
    s.cgst_rate = 6.0;
    s.sgst_rate = 6.0;
    s.igst_rate = 12.0;
    SettingsRepository::save(&conn, s).unwrap();

    let c = company(&conn, "Settings Co", "CUSTOMER");
    let mut input = invoice_input(c, "MWW/26-27/080", 1_000.0);
    input.cgst_rate = None;
    input.sgst_rate = None;
    let inv = InvoiceRepository::create(&conn, input).unwrap().invoice;
    assert_eq!(
        (inv.bank_name.as_str(), inv.bank_branch.as_str(), inv.bank_account_no.as_str(), inv.bank_ifsc.as_str()),
        ("State Bank of India", "Lawspet", "30001234567", "SBIN0001234")
    );
    assert_eq!(inv.terms_and_conditions.as_deref(), Some("Goods once sold will not be taken back."));
    assert_eq!((inv.cgst_rate, inv.sgst_rate, inv.total_amount), (6.0, 6.0, 1_120.0));

    let mut igst = invoice_input(c, "MWW/26-27/081", 1_000.0);
    igst.tax_type = "IGST".into();
    igst.cgst_rate = None;
    igst.sgst_rate = None;
    assert_eq!(InvoiceRepository::create(&conn, igst).unwrap().invoice.igst_rate, 12.0);

    // What the form sends still wins.
    let mut own = invoice_input(c, "MWW/26-27/082", 1_000.0);
    own.bank_name = Some("Indian Bank".into());
    assert_eq!(InvoiceRepository::create(&conn, own).unwrap().invoice.bank_name, "Indian Bank");
}
