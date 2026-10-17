//! The pay slip: one A4 page per employee's month, as HTML for the PDF printer. No SQL here.

use super::models::{EmployeePayment, PayMonthDetail, PayRow};
use crate::invoices::repository::InvoiceRepository;
use crate::rentals::reminder::month_label;
use crate::settings::models::BusinessSettings;
use crate::util::{display_date, indian_number, rupees};

/// Text shown as it is when put into HTML.
fn esc(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&#39;")
}

/// 26 or 25.5: days and hours without empty decimals.
fn quantity(value: f64) -> String {
    let text = format!("{:.2}", value);
    text.trim_end_matches('0').trim_end_matches('.').to_string()
}

/// "PS-2026-10-003": the month and the employee, so the same slip always has the same number.
pub fn slip_number(employee_id: i64, month: &str) -> String {
    format!("PS-{}-{:03}", month, employee_id)
}

/// The app's mark: an "M" weld bead on an orange tile.
const LOGO: &str = r##"<svg viewBox="0 0 36 36" aria-hidden="true"><rect width="36" height="36" rx="8" fill="#e8731a"/><path d="M9 26V11l9 10 9-10v15" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M29.5 7.5l1.7-2.1M32 11.5h2.2M26 4.8l.5-2.3" fill="none" stroke="#fff" stroke-opacity="0.85" stroke-width="1.6" stroke-linecap="round"/></svg>"##;

/// One line in a column of the main table: what it is, a smaller second line, and the amount.
struct Item {
    what: String,
    detail: Option<String>,
    amount: f64,
}

fn earnings(row: &PayRow, d: &PayMonthDetail) -> Vec<Item> {
    let f = &d.figures;
    let mut out = vec![Item {
        what: "Wages".into(),
        detail: Some(format!("{} days × {}", quantity(row.days_worked), rupees(row.daily_wage))),
        amount: f.wages,
    }];
    if row.ot_hours > 0.0 || f.ot_amount > 0.0 {
        out.push(Item { what: "Overtime".into(), detail: Some(format!("{} h × {}", quantity(row.ot_hours), rupees(row.ot_rate))), amount: f.ot_amount });
    }
    if f.bonus > 0.0 {
        out.push(Item { what: "Bonus".into(), detail: row.bonus_note.clone(), amount: f.bonus });
    }
    for i in &row.incentives {
        out.push(Item { what: "Incentive".into(), detail: Some(i.reason.clone()), amount: i.amount });
    }
    out
}

/// Money handed over for the month: advances, salary, and an advance carried in, by date.
fn payments(d: &PayMonthDetail) -> Vec<Item> {
    let mut given: Vec<&EmployeePayment> = d.carried_in.iter().chain(d.entries.iter().filter(|p| p.kind == "ADVANCE" || p.kind == "SALARY")).collect();
    given.sort_by(|a, b| a.entry_date.cmp(&b.entry_date).then(a.id.cmp(&b.id)));
    given
        .into_iter()
        .map(|p| {
            let what = match p.kind.as_str() {
                "CARRIED" => format!("Advance from {}", month_label(&p.month).unwrap_or_else(|_| p.month.clone())),
                "SALARY" => "Salary".to_string(),
                _ => "Advance".to_string(),
            };
            let detail = match &p.payment_method {
                Some(m) => format!("{} · {}", display_date(&p.entry_date), m),
                None => display_date(&p.entry_date),
            };
            Item { what, detail: Some(detail), amount: p.amount }
        })
        .collect()
}

/// A description cell and its amount cell; empty cells when this side has run out of lines.
fn item_cells(item: Option<&Item>) -> String {
    match item {
        Some(i) => format!(
            "<td class=\"desc\">{}{}</td><td class=\"amt\">{}</td>",
            esc(&i.what),
            i.detail.as_deref().map(|t| format!("<span class=\"sub\">{}</span>", esc(t))).unwrap_or_default(),
            indian_number(i.amount)
        ),
        None => "<td class=\"desc\"></td><td class=\"amt\"></td>".to_string(),
    }
}

/// Earnings and payments side by side in one table, so every line and both totals sit level.
fn main_table(row: &PayRow, d: &PayMonthDetail) -> String {
    let left = earnings(row, d);
    let right = payments(d);
    let lines = left.len().max(right.len()).max(1);
    let mut body = String::new();
    for n in 0..lines {
        let paid = if right.is_empty() && n == 0 {
            "<td class=\"desc none\">Nothing paid yet</td><td class=\"amt\"></td>".to_string()
        } else {
            item_cells(right.get(n))
        };
        body.push_str(&format!("<tr>{}{}</tr>", item_cells(left.get(n)), paid));
    }
    format!(
        r#"<table class="main">
    <colgroup><col class="c-desc"><col class="c-amt"><col class="c-desc"><col class="c-amt"></colgroup>
    <thead><tr><th>Earnings</th><th class="amt">Amount (₹)</th><th>Payments made</th><th class="amt">Amount (₹)</th></tr></thead>
    <tbody>{body}</tbody>
    <tfoot><tr><td>Total earned</td><td class="amt">{earned}</td><td>Total paid</td><td class="amt">{given}</td></tr></tfoot>
  </table>"#,
        body = body,
        earned = indian_number(d.figures.earned),
        given = indian_number(d.figures.given),
    )
}

/// The settlement: earned, less what was paid, any adjustments, and what is left. It adds up.
fn settlement(d: &PayMonthDetail) -> String {
    let f = &d.figures;
    let sum = |kind: &str| d.entries.iter().filter(|p| p.kind == kind).map(|p| p.amount).sum::<f64>();
    let mut rows = vec![
        ("Total earned".to_string(), indian_number(f.earned)),
        ("Less: paid".to_string(), format!("\u{2212} {}", indian_number(f.given))),
    ];
    for (kind, label) in [("RETURNED", "Add: cash returned"), ("CARRIED", "Add: extra, to next month"), ("WRITE_OFF", "Add: extra, written off")] {
        let amount = sum(kind);
        if amount > 0.0 {
            rows.push((label.to_string(), format!("+ {}", indian_number(amount))));
        }
    }
    if f.rounded_off > 0.0 {
        rows.push(("Less: rounded off".to_string(), format!("\u{2212} {}", indian_number(f.rounded_off))));
    } else if f.rounded_off < 0.0 {
        rows.push(("Add: extra, rounded off".to_string(), format!("+ {}", indian_number(-f.rounded_off))));
    }
    let (label, value) = match d.status.as_str() {
        "TO_PAY" => ("Balance to pay", rupees(f.balance)),
        "OVERPAID" => ("Paid extra", rupees(-f.balance)),
        _ => ("Balance", "Fully paid".to_string()),
    };
    let lines: String = rows.iter().map(|(l, v)| format!("<tr><td>{}</td><td class=\"amt\">{}</td></tr>", l, v)).collect();
    format!(
        r#"<table class="settle">{lines}<tr class="due"><td>{label}</td><td class="amt">{value}</td></tr></table>"#,
        lines = lines,
        label = label,
        value = value,
    )
}

fn one_slip(d: &PayMonthDetail, row: &PayRow, seller: &BusinessSettings, generated_on: &str) -> Result<String, String> {
    let e = &d.employee;
    let label = month_label(&d.month)?;
    let days_in_month = super::calc::days_in_month(&d.month)?;
    let mut contact = vec![esc(seller.address.trim())];
    if !seller.phone.trim().is_empty() {
        contact.push(format!("<span class=\"nw\">Cell: {}</span>", esc(seller.phone.trim())));
    }
    let contact = contact.into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join(" · ");
    let gstin = if seller.gstin.trim().is_empty() { String::new() } else { format!("<div>GSTIN {}</div>", esc(seller.gstin.trim())) };
    let note = row
        .note
        .as_deref()
        .filter(|n| !n.trim().is_empty())
        .map(|n| format!("<p class=\"note\"><b>Note:</b> {}</p>", esc(n)))
        .unwrap_or_default();
    let dash = || "\u{2014}".to_string();
    Ok(format!(
        r#"<section class="slip">
  <header class="head">
    <div class="brand">{logo}<div><h1>{business}</h1>{subtitle}<div class="contact">{contact}</div>{gstin}</div></div>
    <div class="title"><h2>Pay Slip</h2><div class="month">{label}</div><div class="ref">Slip no. {number}</div></div>
  </header>
  <table class="who">
    <colgroup><col class="c-k"><col class="c-v"><col class="c-k"><col class="c-v"></colgroup>
    <tr><th>Employee</th><td class="name">{name}</td><th>Pay month</th><td>{label}</td></tr>
    <tr><th>Designation</th><td>{role}</td><th>Days worked</th><td>{days} of {days_in_month}</td></tr>
    <tr><th>Phone</th><td>{phone}</td><th>Daily wage</th><td>{wage}</td></tr>
    <tr><th>Joined on</th><td>{joined}</td><th>OT rate</th><td>{rate} per hour</td></tr>
  </table>
  {main}
  <div class="close">
    <div class="words"><div class="k">Earned in words</div><div>{words}</div></div>
    {settle}
  </div>
  {note}
  <div class="sign"><div>Employee's signature</div><div>For {business}<br>Authorised signatory</div></div>
  <footer class="foot"><span>This is a computer-generated pay slip.</span><span>Generated on {generated_on}</span></footer>
</section>"#,
        logo = LOGO,
        business = esc(&seller.business_name),
        subtitle = if seller.business_subtitle.trim().is_empty() { String::new() } else { format!("<div class=\"tag\">{}</div>", esc(&seller.business_subtitle)) },
        contact = contact,
        gstin = gstin,
        label = label,
        number = slip_number(e.id, &d.month),
        name = esc(&e.name),
        role = e.role.as_deref().map(esc).unwrap_or_else(dash),
        phone = e.phone.as_deref().map(esc).unwrap_or_else(dash),
        joined = display_date(&e.joined_on),
        days = quantity(row.days_worked),
        days_in_month = days_in_month,
        wage = rupees(row.daily_wage),
        rate = rupees(row.ot_rate),
        main = main_table(row, d),
        words = InvoiceRepository::money_in_words(d.figures.earned),
        settle = settlement(d),
        note = note,
        generated_on = esc(generated_on),
    ))
}

/// Pay slips for the given months, one page each, in one HTML document. Months without days
/// entered have no slip.
pub fn pay_slips_html(months: &[PayMonthDetail], seller: &BusinessSettings, generated_on: &str) -> Result<String, String> {
    let mut pages = Vec::new();
    for d in months {
        let row = d.row.as_ref().ok_or_else(|| format!("Enter the days for {} first.", month_label(&d.month).unwrap_or_default()))?;
        pages.push(one_slip(d, row, seller, generated_on)?);
    }
    if pages.is_empty() {
        return Err("No one has days entered for this month yet.".to_string());
    }
    let title = match months {
        [one] => format!("Pay slip {} - {}", one.month, esc(&one.employee.name)),
        _ => "Pay slips".to_string(),
    };
    Ok(format!(
        "<!DOCTYPE html>\n<html lang=\"en\"><head><meta charset=\"UTF-8\"><title>{}</title><style>\n{}\n</style></head><body>\n{}\n</body></html>",
        title,
        include_str!("../../templates/pay_slip.css"),
        pages.join("\n")
    ))
}

/// A file name for the slip that is safe on Windows: "Murugan - Pay slip October 2026.pdf".
pub fn slip_file_name(name: &str, month: &str) -> String {
    let clean: String = name
        .chars()
        .map(|c| if "\\/:*?\"<>|".contains(c) || c.is_control() { '_' } else { c })
        .collect();
    let clean = clean.trim().trim_end_matches('.').to_string();
    let label = month_label(month).unwrap_or_else(|_| month.to_string());
    format!("{} - Pay slip {}.pdf", if clean.is_empty() { "Employee".to_string() } else { clean }, label)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::payroll::models::*;

    fn seller() -> BusinessSettings {
        BusinessSettings {
            business_name: "MONONMANI WELDING WORKS".into(),
            business_subtitle: "(FABRICATIONS)".into(),
            phone: "94432 94052".into(),
            address: "# 468, Vazhudavur Road, Pondicherry".into(),
            ..Default::default()
        }
    }

    fn pay(id: i64, kind: &str, date: &str, amount: f64, round_off: f64) -> EmployeePayment {
        EmployeePayment {
            id,
            employee_id: 3,
            month: "2026-10".into(),
            kind: kind.into(),
            entry_date: date.into(),
            amount,
            round_off,
            carried_to: None,
            payment_method: Some("Cash".into()),
            note: None,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    fn detail(status: &str, balance: f64, entries: Vec<EmployeePayment>) -> PayMonthDetail {
        PayMonthDetail {
            employee: Employee {
                id: 3,
                name: "Murugan <M>".into(),
                role: Some("Welder".into()),
                phone: Some("98765 43210".into()),
                address: None,
                joined_on: "2025-04-01".into(),
                left_on: None,
                daily_wage: 800.0,
                ot_rate: 100.0,
                notes: None,
                created_at: String::new(),
                updated_at: String::new(),
            },
            month: "2026-10".into(),
            row: Some(PayRow {
                id: 1,
                employee_id: 3,
                month: "2026-10".into(),
                days_worked: 25.5,
                daily_wage: 800.0,
                ot_hours: 4.0,
                ot_rate: 100.0,
                bonus_amount: 500.0,
                bonus_note: Some("Diwali".into()),
                note: Some("Good work".into()),
                incentives: vec![Incentive { id: 1, reason: "Night work".into(), amount: 300.0 }],
            }),
            figures: MonthFigures { wages: 20400.0, ot_amount: 400.0, bonus: 500.0, incentives: 300.0, earned: 21600.0, given: 15000.0, balance, ..Default::default() },
            status: status.into(),
            editable: true,
            entries,
            carried_in: vec![],
        }
    }

    #[test]
    fn a_slip_shows_the_whole_month() {
        let d = detail("TO_PAY", 6600.0, vec![pay(1, "ADVANCE", "2026-10-05", 5000.0, 0.0), pay(2, "SALARY", "2026-10-31", 10000.0, 0.0)]);
        let html = pay_slips_html(&[d], &seller(), "17-10-2026").unwrap();
        for part in [
            "Pay Slip",
            "October 2026",
            "PS-2026-10-003",
            "Murugan &lt;M&gt;",
            "25.5 days × ₹800.00",
            "4 h × ₹100.00",
            "Diwali",
            "Night work",
            "Total earned",
            "21,600.00",
            "05-10-2026",
            "Total paid",
            "− 15,000.00",
            "15,000.00",
            "Balance to pay",
            "₹6,600.00",
            "TWENTY-ONE THOUSAND SIX HUNDRED RUPEES ONLY",
            "Good work",
            "25.5 of 31",
            "(FABRICATIONS)",
            "Cell: 94432 94052",
            "Generated on 17-10-2026",
        ] {
            assert!(html.contains(part), "missing {:?}", part);
        }
        assert!(!html.contains("Murugan <M>"), "names are escaped");
    }

    #[test]
    fn a_settled_month_says_fully_paid_and_how() {
        let mut d = detail("PAID", 0.0, vec![pay(1, "SALARY", "2026-10-31", 25000.0, 0.0), pay(2, "WRITE_OFF", "2026-10-31", 3400.0, 0.0)]);
        d.figures.given = 25000.0;
        let html = pay_slips_html(&[d], &seller(), "17-10-2026").unwrap();
        assert!(html.contains("Fully paid"));
        assert!(html.contains("Add: extra, written off"));
    }

    #[test]
    fn several_slips_make_one_document_and_months_without_days_are_refused() {
        let a = detail("TO_PAY", 1.0, vec![]);
        let mut b = detail("TO_PAY", 1.0, vec![]);
        b.employee.name = "Bala".into();
        let html = pay_slips_html(&[a.clone(), b], &seller(), "x").unwrap();
        assert_eq!(html.matches("<section class=\"slip\">").count(), 2);
        assert!(html.contains("Nothing paid yet"));
        let mut none = a;
        none.row = None;
        assert_eq!(pay_slips_html(&[none], &seller(), "x").unwrap_err(), "Enter the days for October 2026 first.");
        assert_eq!(pay_slips_html(&[], &seller(), "x").unwrap_err(), "No one has days entered for this month yet.");
    }

    /// Writes a sample slip as HTML (and as PDF when Edge or Chrome is installed) to the folder in
    /// MWW_SAMPLE_DIR, for looking at the design: `--ignored sample_pay_slip`.
    #[test]
    #[ignore]
    fn sample_pay_slip() {
        let dir = std::path::PathBuf::from(std::env::var("MWW_SAMPLE_DIR").expect("set MWW_SAMPLE_DIR"));
        let mut d = detail("TO_PAY", 6600.0, vec![pay(1, "ADVANCE", "2026-10-05", 5000.0, 0.0), pay(2, "SALARY", "2026-10-31", 10000.0, 0.0)]);
        d.employee.name = "Murugan".into();
        let html = pay_slips_html(&[d], &seller(), "17-10-2026").unwrap();
        std::fs::write(dir.join("pay_slip.html"), &html).unwrap();
        let _ = crate::pdf::renderer::PdfRenderer::print_document(html, &dir.join("pay_slip.pdf"));
    }

    #[test]
    fn file_names_are_safe() {
        assert_eq!(slip_file_name("Murugan", "2026-10"), "Murugan - Pay slip October 2026.pdf");
        assert_eq!(slip_file_name("A/B: \"C\"?", "2026-10"), "A_B_ _C__ - Pay slip October 2026.pdf");
        assert_eq!(slip_file_name("  ", "2026-10"), "Employee - Pay slip October 2026.pdf");
    }
}
