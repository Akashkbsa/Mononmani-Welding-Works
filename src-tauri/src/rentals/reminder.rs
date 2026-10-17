//! The fixed rent reminder and the WhatsApp link that opens a chat with it already typed.
//! Nothing here sends anything: the owner presses Send in WhatsApp.

use crate::util::rupees;

const MONTH_NAMES: [&str; 12] = [
    "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December",
];

const BAD_NUMBER: &str = "Enter a 10-digit mobile number, or include the country code, like +971 50 123 4567.";

/// A WhatsApp number as `+` and digits. Ten digits starting 6 to 9 are Indian (+91); a number
/// typed with its own country code keeps it.
pub fn normalize_whatsapp_number(raw: &str) -> Result<String, String> {
    let text = raw.trim();
    let allowed = text
        .chars()
        .enumerate()
        .all(|(i, c)| c.is_ascii_digit() || " -()./".contains(c) || (i == 0 && c == '+'));
    let digits: String = text.chars().filter(|c| c.is_ascii_digit()).collect();
    if !allowed || digits.is_empty() {
        return Err(BAD_NUMBER.to_string());
    }
    let international = |d: &str| -> Result<String, String> {
        if (8..=15).contains(&d.len()) && !d.starts_with('0') {
            Ok(format!("+{}", d))
        } else {
            Err(BAD_NUMBER.to_string())
        }
    };
    let indian_mobile = |d: &str| d.len() == 10 && matches!(d.as_bytes()[0], b'6'..=b'9');

    if text.starts_with('+') {
        return international(&digits);
    }
    if let Some(rest) = digits.strip_prefix("00") {
        return international(rest);
    }
    match digits.len() {
        10 if indian_mobile(&digits) => Ok(format!("+91{}", digits)),
        11 if digits.starts_with('0') && indian_mobile(&digits[1..]) => Ok(format!("+91{}", &digits[1..])),
        12 if digits.starts_with("91") && indian_mobile(&digits[2..]) => Ok(format!("+{}", digits)),
        _ => Err(BAD_NUMBER.to_string()),
    }
}

/// "2026-11" -> "November 2026".
pub fn month_label(month: &str) -> Result<String, String> {
    let bad = || "Month must look like 2026-11.".to_string();
    let b = month.as_bytes();
    if b.len() != 7 || b[4] != b'-' || !month[..4].bytes().all(|c| c.is_ascii_digit()) || !month[5..].bytes().all(|c| c.is_ascii_digit()) {
        return Err(bad());
    }
    let number: usize = month[5..].parse().map_err(|_| bad())?;
    if !(1..=12).contains(&number) {
        return Err(bad());
    }
    Ok(format!("{} {}", MONTH_NAMES[number - 1], &month[..4]))
}

/// Rupees with the empty paise dropped: ₹12,000 but ₹12,000.50.
pub fn rent_amount_text(amount: f64) -> String {
    let text = rupees(amount);
    text.strip_suffix(".00").map(str::to_string).unwrap_or(text)
}

/// The owner's rent reminder template filled for one tenant.
pub fn rent_reminder_from(template: &str, name: &str, month_label: &str, amount: f64, place: &str, business_name: &str) -> String {
    crate::messages::templates::fill(
        template,
        &[
            ("tenant_name", name.to_string()),
            ("month", month_label.to_string()),
            ("rent", rent_amount_text(amount)),
            ("place", place.to_string()),
            ("business_name", business_name.to_string()),
        ],
    )
}

/// The default reminder, as sent before templates could be changed.
#[cfg(test)]
pub fn rent_reminder_text(name: &str, month_label: &str, amount: f64, place: &str) -> String {
    let template = crate::messages::templates::default_template(crate::messages::templates::RENT_REMINDER);
    rent_reminder_from(template, name, month_label, amount, place, "")
}

/// `https://wa.me/<digits>?text=<message>` with the message percent-encoded as UTF-8, so Tamil
/// text, the rupee sign and line breaks all arrive intact.
pub fn whatsapp_link(number: &str, message: &str) -> String {
    let digits: String = number.chars().filter(|c| c.is_ascii_digit()).collect();
    let mut encoded = String::with_capacity(message.len() * 3);
    for byte in message.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.~".contains(&byte) {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{:02X}", byte));
        }
    }
    format!("https://wa.me/{}?text={}", digits, encoded)
}

#[cfg(test)]
mod tests {
    use super::*;

    const BAD_NUMBER: &str = "Enter a 10-digit mobile number, or include the country code, like +971 50 123 4567.";

    fn percent_decode(text: &str) -> String {
        let bytes = text.as_bytes();
        let mut out = Vec::new();
        let mut i = 0;
        while i < bytes.len() {
            if bytes[i] == b'%' {
                out.push(u8::from_str_radix(&text[i + 1..i + 3], 16).unwrap());
                i += 3;
            } else {
                out.push(bytes[i]);
                i += 1;
            }
        }
        String::from_utf8(out).unwrap()
    }

    #[test]
    fn numbers_are_normalised() {
        for ok in ["98765 43210", "098765-43210", "+91 98765 43210", "919876543210", "(98765) 43210", " 9876543210 ", "0091 98765 43210"] {
            assert_eq!(normalize_whatsapp_number(ok).unwrap(), "+919876543210", "{}", ok);
        }
        assert_eq!(normalize_whatsapp_number("+971 50 123 4567").unwrap(), "+971501234567");
        for bad in ["12345", "5876543210", "+0123456789", "", "abcdefghij", "9876543210123456", "+12", "98765 4321x"] {
            assert_eq!(normalize_whatsapp_number(bad).unwrap_err(), BAD_NUMBER, "{:?}", bad);
        }
    }

    #[test]
    fn month_labels() {
        assert_eq!(month_label("2026-11").unwrap(), "November 2026");
        assert_eq!(month_label("2027-01").unwrap(), "January 2027");
        for bad in ["2026-13", "2026-00", "26-11", "2026-1", "November", "2026/11", ""] {
            assert_eq!(month_label(bad).unwrap_err(), "Month must look like 2026-11.", "{:?}", bad);
        }
    }

    #[test]
    fn amounts_drop_empty_paise() {
        assert_eq!(rent_amount_text(12000.0), "₹12,000");
        assert_eq!(rent_amount_text(12000.5), "₹12,000.50");
        assert_eq!(rent_amount_text(1250000.0), "₹12,50,000");
    }

    #[test]
    fn the_message_is_fixed() {
        assert_eq!(
            rent_reminder_text("Ravi", "November 2026", 12000.0, "Flat 2B"),
            "Hello Ravi, this is a reminder for your November 2026 rent of ₹12,000 for Flat 2B. Please pay at your earliest convenience. Thank you."
        );
    }

    #[test]
    fn links_are_percent_encoded() {
        let message = rent_reminder_text("ரவி", "November 2026", 12000.5, "Shop #1 & Co");
        let link = whatsapp_link("+91 98765 43210", &message);
        let (head, text) = link.split_once("?text=").unwrap();
        assert_eq!(head, "https://wa.me/919876543210");
        assert!(text.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_.~%".contains(&b)), "only safe characters: {}", text);
        assert!(text.contains("%20") && !text.contains(' '));
        assert!(!link.contains('+') && !link.contains('₹') && !link.contains('#') && !link.contains('\n'));
        assert_eq!(percent_decode(text), message, "the text survives the round trip, Tamil and ₹ included");
    }
}
