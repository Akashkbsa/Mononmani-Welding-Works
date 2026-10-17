//! The pay slip: one A4 page per employee's month, as HTML for the PDF printer. No SQL here.

use super::models::{EmployeePayment, PayMonthDetail, PayRow};
use crate::invoices::repository::InvoiceRepository;
use crate::rentals::reminder::month_label;
use crate::settings::models::BusinessSettings;
use crate::util::{display_date, rupees};

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

fn earnings_rows(row: &PayRow, d: &PayMonthDetail) -> String {
    let f = &d.figures;
    let mut out = format!(
        "<tr><td>Wages<span class=\"note\">{} days × {}</span></td><td class=\"num\">{}</td></tr>",
        quantity(row.days_worked),
        rupees(row.daily_wage),
        rupees(f.wages)
    );
    if row.ot_hours > 0.0 || f.ot_amount > 0.0 {
        out.push_str(&format!(
            "<tr><td>Overtime<span class=\"note\">{} h × {}</span></td><td class=\"num\">{}</td></tr>",
            quantity(row.ot_hours),
            rupees(row.ot_rate),
            rupees(f.ot_amount)
        ));
    }
    if f.bonus > 0.0 {
        let note = row.bonus_note.as_deref().map(|n| format!("<span class=\"note\">{}</span>", esc(n))).unwrap_or_default();
        out.push_str(&format!("<tr><td>Bonus{}</td><td class=\"num\">{}</td></tr>", note, rupees(f.bonus)));
    }
    for i in &row.incentives {
        out.push_str(&format!(
            "<tr><td>Incentive<span class=\"note\">{}</span></td><td class=\"num\">{}</td></tr>",
            esc(&i.reason),
            rupees(i.amount)
        ));
    }
    out.push_str(&format!("<tr class=\"total\"><td>Total earned</td><td class=\"num\">{}</td></tr>", rupees(f.earned)));
    out
}

fn payment_row(date: &str, what: &str, note: Option<String>, amount: String, class: &str) -> String {
    let note = note.map(|n| format!("<span class=\"note\">{}</span>", esc(&n))).unwrap_or_default();
    format!(
        "<tr class=\"{}\"><td>{}</td><td>{}{}</td><td class=\"num\">{}</td></tr>",
        class,
        display_date(date),
        esc(what),
        note,
        amount
    )
}

fn payments_rows(d: &PayMonthDetail) -> String {
    let f = &d.figures;
    let mut out = String::new();
    let mut given: Vec<&EmployeePayment> = d.carried_in.iter().chain(d.entries.iter().filter(|p| p.kind == "ADVANCE" || p.kind == "SALARY")).collect();
    given.sort_by(|a, b| a.entry_date.cmp(&b.entry_date).then(a.id.cmp(&b.id)));
    for p in &given {
        let what = match p.kind.as_str() {
            "CARRIED" => format!("Advance from {}", month_label(&p.month).unwrap_or_else(|_| p.month.clone())),
            "SALARY" => "Salary".to_string(),
            _ => "Advance".to_string(),
        };
        out.push_str(&payment_row(&p.entry_date, &what, p.payment_method.clone(), rupees(p.amount), ""));
    }
    if given.is_empty() {
        out.push_str("<tr><td class=\"empty\" colspan=\"3\">Nothing paid yet</td></tr>");
    }
    out.push_str(&format!("<tr class=\"total\"><td colspan=\"2\">Total paid</td><td class=\"num\">{}</td></tr>", rupees(f.given)));

    // How the month was settled beyond what was handed over.
    for p in d.entries.iter().filter(|p| matches!(p.kind.as_str(), "RETURNED" | "WRITE_OFF" | "CARRIED")) {
        let what = match p.kind.as_str() {
            "RETURNED" => "Cash returned",
            "WRITE_OFF" => "Extra, written off",
            _ => "Extra, to next month",
        };
        out.push_str(&payment_row(&p.entry_date, what, None, rupees(p.amount), "settle"));
    }
    for p in d.entries.iter().filter(|p| p.kind == "SALARY" && p.round_off != 0.0) {
        let what = if p.round_off > 0.0 { "Rounded off (paid less)" } else { "Extra, rounded off" };
        out.push_str(&payment_row(&p.entry_date, what, None, rupees(p.round_off.abs()), "settle"));
    }
    out
}

/// The highlighted cell: what is left to pay, or that the month is settled.
fn balance_cell(d: &PayMonthDetail) -> (String, String, &'static str) {
    let f = &d.figures;
    match d.status.as_str() {
        "TO_PAY" => ("Balance to pay".to_string(), rupees(f.balance), ""),
        "OVERPAID" => ("Paid extra".to_string(), rupees(-f.balance), ""),
        _ => ("Balance".to_string(), "Fully paid".to_string(), " paid"),
    }
}

fn one_slip(d: &PayMonthDetail, row: &PayRow, seller: &BusinessSettings, generated_on: &str) -> Result<String, String> {
    let e = &d.employee;
    let label = month_label(&d.month)?;
    let days_in_month = super::calc::days_in_month(&d.month)?;
    let f = &d.figures;
    let contact: Vec<String> = [seller.address.trim(), seller.phone.trim()]
        .iter()
        .filter(|s| !s.is_empty())
        .map(|s| esc(s))
        .collect();
    let contact = match seller.phone.trim() {
        "" => contact.join(" · "),
        _ => contact.join(" · Cell: "),
    };
    let (balance_label, balance_value, balance_class) = balance_cell(d);
    let remark = row.note.as_deref().filter(|n| !n.trim().is_empty()).map(|n| format!("<div class=\"remark\"><b>Note:</b> {}</div>", esc(n))).unwrap_or_default();
    Ok(format!(
        r#"<section class="slip">
  <header class="head">
    <div class="brand">{logo}<div><h1>{business}</h1>{subtitle}<div class="contact">{contact}</div></div></div>
    <div class="title"><div class="label">PAY SLIP</div><div class="month">{label}</div><div class="ref">{number}</div></div>
  </header>
  <div class="who">
    <div><div class="k">Employee</div><div class="v big">{name}</div></div>
    <div><div class="k">Designation</div><div class="v">{role}</div></div>
    <div><div class="k">Phone</div><div class="v">{phone}</div></div>
    <div><div class="k">Joined on</div><div class="v">{joined}</div></div>
    <div><div class="k">Days worked</div><div class="v">{days} of {days_in_month}</div></div>
    <div><div class="k">Daily wage · OT rate</div><div class="v">{wage} · {rate}/h</div></div>
  </div>
  <div class="cols">
    <table><caption>Earnings</caption><thead><tr><th>Description</th><th class="num">Amount</th></tr></thead><tbody>{earnings}</tbody></table>
    <table><caption>Payments</caption><thead><tr><th>Date</th><th>Type</th><th class="num">Amount</th></tr></thead><tbody>{payments}</tbody></table>
  </div>
  <div class="net">
    <div><div class="k">Earned</div><div class="v">{earned}</div></div>
    <div><div class="k">Paid</div><div class="v">{given}</div></div>
    <div class="main"><div class="k">{balance_label}</div><div class="v{balance_class}">{balance_value}</div></div>
  </div>
  <div class="words">Earned in words: <b>{words}</b></div>
  {remark}
  <div class="sign"><div><b>Employee's signature</b></div><div>For <b>{business}</b><br>Authorised signatory</div></div>
  <footer class="foot"><span>This is a computer-generated pay slip.</span><span>Generated on {generated_on}</span></footer>
</section>"#,
        logo = LOGO,
        business = esc(&seller.business_name),
        subtitle = if seller.business_subtitle.trim().is_empty() { String::new() } else { format!("<div class=\"sub\">{}</div>", esc(&seller.business_subtitle)) },
        contact = contact,
        label = label,
        number = slip_number(e.id, &d.month),
        name = esc(&e.name),
        role = e.role.as_deref().map(esc).unwrap_or_else(|| "—".to_string()),
        phone = e.phone.as_deref().map(esc).unwrap_or_else(|| "—".to_string()),
        joined = display_date(&e.joined_on),
        days = quantity(row.days_worked),
        days_in_month = days_in_month,
        wage = rupees(row.daily_wage),
        rate = rupees(row.ot_rate),
        earnings = earnings_rows(row, d),
        payments = payments_rows(d),
        earned = rupees(f.earned),
        given = rupees(f.given),
        balance_label = balance_label,
        balance_class = balance_class,
        balance_value = balance_value,
        words = InvoiceRepository::money_in_words(f.earned),
        remark = remark,
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
            "PAY SLIP",
            "October 2026",
            "PS-2026-10-003",
            "Murugan &lt;M&gt;",
            "25.5 days × ₹800.00",
            "4 h × ₹100.00",
            "Diwali",
            "Night work",
            "Total earned",
            "₹21,600.00",
            "05-10-2026",
            "Total paid",
            "₹15,000.00",
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
        assert!(html.contains("Extra, written off"));
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
