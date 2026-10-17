//! The printed ledger account, as HTML for the PDF printer. No SQL here.

use super::models::Ledger;
use crate::customers::models::Customer;
use crate::settings::models::BusinessSettings;
use crate::util::{display_date, rupees};

fn esc(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&#39;")
}

/// "₹1,08,560.00 Dr", "₹4,000.00 Cr" or "Nil".
pub fn balance_text(balance: f64) -> String {
    if balance > 0.0 {
        format!("{} Dr", rupees(balance))
    } else if balance < 0.0 {
        format!("{} Cr", rupees(-balance))
    } else {
        "Nil".to_string()
    }
}

/// "01-04-2026 to 17-10-2026", "Up to 17-10-2026", "From 01-04-2026" or "All records".
pub fn period_text(from: Option<&str>, to: Option<&str>) -> String {
    match (from, to) {
        (Some(f), Some(t)) => format!("{} to {}", display_date(f), display_date(t)),
        (Some(f), None) => format!("From {}", display_date(f)),
        (None, Some(t)) => format!("Up to {}", display_date(t)),
        (None, None) => "All records".to_string(),
    }
}

/// A file name that is safe on Windows: "Sri Krishna - Ledger 01-04-2026 to 17-10-2026.pdf".
pub fn ledger_file_name(name: &str, from: Option<&str>, to: Option<&str>) -> String {
    let clean: String = name.chars().map(|c| if "\\/:*?\"<>|".contains(c) || c.is_control() { '_' } else { c }).collect();
    let clean = clean.trim().trim_end_matches('.').to_string();
    format!("{} - Ledger {}.pdf", if clean.is_empty() { "Company" } else { &clean }, period_text(from, to))
}

const LOGO: &str = r##"<svg viewBox="0 0 36 36" aria-hidden="true"><rect width="36" height="36" rx="8" fill="#e8731a"/><path d="M9 26V11l9 10 9-10v15" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M29.5 7.5l1.7-2.1M32 11.5h2.2M26 4.8l.5-2.3" fill="none" stroke="#fff" stroke-opacity="0.85" stroke-width="1.6" stroke-linecap="round"/></svg>"##;

fn money_or_blank(value: f64) -> String {
    if value > 0.0 {
        rupees(value)
    } else {
        String::new()
    }
}

pub fn ledger_html(l: &Ledger, company: &Customer, seller: &BusinessSettings, printed_on: &str) -> String {
    let business = esc(&seller.business_name);
    // Phone and GSTIN never break across lines.
    let mut contact = vec![esc(seller.address.trim())];
    if !seller.phone.trim().is_empty() {
        contact.push(format!("<span class=\"nw\">Cell: {}</span>", esc(seller.phone.trim())));
    }
    if !seller.gstin.trim().is_empty() {
        contact.push(format!("<span class=\"nw\">GSTIN {}</span>", esc(seller.gstin.trim())));
    }
    let contact = contact.into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join(" · ");

    let address: Vec<String> = [&company.address_line1, &company.address_line2, &company.city, &company.state, &company.postal_code]
        .iter()
        .filter_map(|p| p.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(esc))
        .collect();
    let mut party_lines = Vec::new();
    if !address.is_empty() {
        party_lines.push(address.join(", "));
    }
    let mut ids = Vec::new();
    if let Some(g) = company.gstin.as_deref().filter(|g| !g.trim().is_empty()) {
        ids.push(format!("GSTIN {}", esc(g)));
    }
    if let Some(p) = company.phone.as_deref().filter(|p| !p.trim().is_empty()) {
        ids.push(format!("Phone {}", esc(p)));
    }
    if !ids.is_empty() {
        party_lines.push(ids.join(" · "));
    }

    let mut rows = String::new();
    if l.from.is_some() {
        rows.push_str(&format!(
            "<tr class=\"carry\"><td class=\"date\">{}</td><td>Balance brought forward</td><td></td><td></td><td></td><td class=\"num\">{}</td></tr>",
            l.from.as_deref().map(display_date).unwrap_or_default(),
            balance_text(l.brought_forward)
        ));
    }
    for x in &l.lines {
        let detail = if x.detail.is_empty() { String::new() } else { format!("<span class=\"detail\">{}</span>", esc(&x.detail)) };
        rows.push_str(&format!(
            "<tr><td class=\"date\">{}</td><td>{}{}</td><td class=\"ref\">{}</td><td class=\"num\">{}</td><td class=\"num\">{}</td><td class=\"num\">{}</td></tr>",
            if x.date.is_empty() { String::new() } else { display_date(&x.date) },
            esc(&x.particulars),
            detail,
            esc(&x.number),
            money_or_blank(x.debit),
            money_or_blank(x.credit),
            balance_text(x.balance)
        ));
    }
    if l.lines.is_empty() {
        rows.push_str("<tr><td class=\"empty\" colspan=\"6\">No entries in this period</td></tr>");
    }

    let as_on = l.to.as_deref().map(display_date).unwrap_or_else(|| printed_on.to_string());
    let side = if l.closing > 0.0 {
        format!("Due to {}", business)
    } else if l.closing < 0.0 {
        format!("Due from {}", business)
    } else {
        "Account settled".to_string()
    };
    let opening_label = if l.from.is_some() { "Brought forward" } else { "Opening" };

    format!(
        r#"<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Ledger - {name}</title><style>
{css}
</style></head><body>
<header class="head">
  <div class="brand">{logo}<div><h1>{business}</h1>{subtitle}<div class="contact">{contact}</div></div></div>
  <div class="title"><div class="label">LEDGER ACCOUNT</div><div class="period">{period}</div><div class="ref">Printed on {printed_on}</div></div>
</header>
<section class="party">
  <div class="who"><div class="k">Account of</div><div class="name">{name}</div><div class="lines">{party_lines}</div></div>
  <div class="due"><div class="k">Balance as on {as_on}</div><div class="amount">{closing}</div><div class="side">{side}</div></div>
</section>
<section class="summary">
  <div><div class="k">{opening_label}</div><div class="v">{brought}</div></div>
  <div><div class="k">Total debit</div><div class="v">{debit}</div></div>
  <div><div class="k">Total credit</div><div class="v">{credit}</div></div>
  <div><div class="k">Closing</div><div class="v">{closing}</div></div>
</section>
<table>
  <thead><tr><th>Date</th><th>Particulars</th><th>Ref. no.</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Balance</th></tr></thead>
  <tbody>{rows}</tbody>
  <tfoot>
    <tr class="total"><td></td><td>Total</td><td></td><td class="num">{debit}</td><td class="num">{credit}</td><td></td></tr>
    <tr class="closing"><td></td><td>Closing balance</td><td></td><td></td><td></td><td class="num">{closing}</td></tr>
  </tfoot>
</table>
<p class="note">Dr: amount due to {business}. Cr: amount due from {business}. Please check this statement and confirm the balance.</p>
<div class="sign"><div>Balance confirmed by <b>{name}</b></div><div>For <b>{business}</b><br>Authorised signatory</div></div>
</body></html>"#,
        css = include_str!("../../templates/ledger.css"),
        logo = LOGO,
        business = business,
        subtitle = if seller.business_subtitle.trim().is_empty() { String::new() } else { format!("<div class=\"sub\">{}</div>", esc(&seller.business_subtitle)) },
        contact = contact,
        period = period_text(l.from.as_deref(), l.to.as_deref()),
        printed_on = esc(printed_on),
        name = esc(&company.name),
        party_lines = party_lines.join("<br>"),
        as_on = as_on,
        closing = balance_text(l.closing),
        side = side,
        opening_label = opening_label,
        brought = balance_text(if l.from.is_some() { l.brought_forward } else { l.opening_balance.amount }),
        debit = rupees(l.total_debit),
        credit = rupees(l.total_credit),
        rows = rows,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ledger::models::{LedgerLine, OpeningBalance};

    pub fn company() -> Customer {
        Customer {
            id: 1,
            name: "Sri Krishna <Engg>".into(),
            gstin: Some("34AAACS1234F1ZV".into()),
            phone: Some("94430 12345".into()),
            email: None,
            address_line1: Some("12, Industrial Estate".into()),
            address_line2: None,
            city: Some("Puducherry".into()),
            state: None,
            postal_code: Some("605009".into()),
            is_favorite: false,
            last_used_at: None,
            created_at: String::new(),
            updated_at: String::new(),
            party_type: "BOTH".into(),
            whatsapp_number: None,
        }
    }

    pub fn line(date: &str, particulars: &str, number: &str, debit: f64, credit: f64, balance: f64) -> LedgerLine {
        LedgerLine { date: date.into(), particulars: particulars.into(), number: number.into(), detail: String::new(), debit, credit, balance }
    }

    pub fn ledger() -> Ledger {
        Ledger {
            company_id: 1,
            company_name: "Sri Krishna".into(),
            party_type: "BOTH".into(),
            from: Some("2026-04-01".into()),
            to: Some("2026-10-17".into()),
            brought_forward: 18500.0,
            lines: vec![
                line("2026-04-10", "Sales invoice", "MWW/26-27/001", 11800.0, 0.0, 30300.0),
                LedgerLine { detail: "Bank Transfer · UTR9".into(), ..line("2026-05-02", "Payment received", "PAY/26-27/004", 0.0, 10000.0, 20300.0) },
                line("2026-05-10", "Purchase bill", "SKE-55", 0.0, 4000.0, 16300.0),
            ],
            total_debit: 11800.0,
            total_credit: 14000.0,
            closing: 16300.0,
            opening_balance: OpeningBalance::default(),
            dates: vec![],
        }
    }

    #[test]
    fn balances_and_periods_read_plainly() {
        assert_eq!(balance_text(1500.0), "₹1,500.00 Dr");
        assert_eq!(balance_text(-41475.0), "₹41,475.00 Cr");
        assert_eq!(balance_text(0.0), "Nil");
        assert_eq!(period_text(Some("2026-04-01"), Some("2026-10-17")), "01-04-2026 to 17-10-2026");
        assert_eq!(period_text(None, None), "All records");
        assert_eq!(ledger_file_name("A/B Works", Some("2026-04-01"), Some("2026-10-17")), "A_B Works - Ledger 01-04-2026 to 17-10-2026.pdf");
    }

    #[test]
    fn the_printed_ledger_has_every_part() {
        let html = ledger_html(&ledger(), &company(), &BusinessSettings::default(), "17-10-2026");
        for part in [
            "LEDGER ACCOUNT",
            "01-04-2026 to 17-10-2026",
            "Sri Krishna &lt;Engg&gt;",
            "GSTIN 34AAACS1234F1ZV",
            "12, Industrial Estate, Puducherry, 605009",
            "Balance brought forward",
            "₹18,500.00 Dr",
            "MWW/26-27/001",
            "Bank Transfer · UTR9",
            "SKE-55",
            "₹16,300.00 Dr",
            "Total credit",
            "₹14,000.00",
            "Closing balance",
            "Balance as on 17-10-2026",
            "Please check this statement and confirm the balance.",
        ] {
            assert!(html.contains(part), "missing {:?}", part);
        }
        assert!(!html.contains("Sri Krishna <Engg>"));
    }

    #[test]
    fn an_empty_period_says_so() {
        let mut l = ledger();
        l.lines.clear();
        l.closing = l.brought_forward;
        let html = ledger_html(&l, &company(), &BusinessSettings::default(), "17-10-2026");
        assert!(html.contains("No entries in this period"));
    }

    /// Writes a sample ledger (HTML, and PDF when Edge or Chrome is installed) to MWW_SAMPLE_DIR.
    #[test]
    #[ignore]
    fn sample_ledger() {
        let dir = std::path::PathBuf::from(std::env::var("MWW_SAMPLE_DIR").expect("set MWW_SAMPLE_DIR"));
        let mut c = company();
        c.name = "Sri Krishna Engineering Works".into();
        let mut l = ledger();
        let mut b = 18500.0;
        let mut lines = Vec::new();
        for i in 0..34 {
            let (p, n, d, cr) = if i % 3 == 2 {
                ("Payment received", format!("PAY/26-27/{:03}", i), 0.0, 9000.0 + i as f64 * 10.0)
            } else if i % 5 == 4 {
                ("Purchase bill", format!("SKE-{}", 100 + i), 0.0, 3200.0)
            } else {
                ("Sales invoice", format!("MWW/26-27/{:03}", i), 6000.0 + i as f64 * 125.5, 0.0)
            };
            b += d - cr;
            let day = format!("2026-{:02}-{:02}", 4 + i / 6, 1 + (i % 6) * 4);
            lines.push(LedgerLine { detail: if cr > 0.0 && p.starts_with("Payment") { "Bank Transfer · UTR 55120".into() } else { String::new() }, ..line(&day, p, &n, d, cr, (b * 100.0f64).round() / 100.0) });
        }
        l.total_debit = lines.iter().map(|x| x.debit).sum();
        l.total_credit = lines.iter().map(|x| x.credit).sum();
        l.closing = lines.last().unwrap().balance;
        l.lines = lines;
        let seller = BusinessSettings { business_name: "MONONMANI WELDING WORKS".into(), business_subtitle: "(FABRICATIONS)".into(), ..Default::default() };
        let html = ledger_html(&l, &c, &seller, "17-10-2026");
        std::fs::write(dir.join("ledger.html"), &html).unwrap();
        let _ = crate::pdf::renderer::PdfRenderer::print_document(html, &dir.join("ledger.pdf"));
    }
}
