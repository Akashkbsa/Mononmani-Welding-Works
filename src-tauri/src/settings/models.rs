use serde::{Deserialize, Serialize};

/// The owner's own details, used on every new invoice and printed on the PDF.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BusinessSettings {
    pub business_name: String,
    pub business_subtitle: String,
    pub gstin: String,
    pub phone: String,
    pub email: String,
    pub address: String,
    pub services_banner: String,
    pub bank_name: String,
    pub bank_branch: String,
    pub bank_account_no: String,
    pub bank_ifsc: String,
    pub terms_and_conditions: String,
    pub cgst_rate: f64,
    pub sgst_rate: f64,
    pub igst_rate: f64,
}

impl Default for BusinessSettings {
    fn default() -> Self {
        Self {
            business_name: "MONONMANI WELDING WORKS".to_string(),
            business_subtitle: "(FABRICATIONS)".to_string(),
            gstin: "34AIRPV5028N1ZG".to_string(),
            phone: "94432 94052".to_string(),
            email: "mononmani80@gmail.com".to_string(),
            address: "# 468, Vazhudavur Road, Muthirapalayam, Pondicherry - 605 009.".to_string(),
            services_banner:
                "Silver Brazing, Gas, Plasma Cutting, ARK, S.S. & Aluminium, Tig & Mic Welding, Shed Work".to_string(),
            bank_name: "Indian Bank".to_string(),
            bank_branch: "Mettupalayam (PONDY)".to_string(),
            bank_account_no: "498877880".to_string(),
            bank_ifsc: "IDIB000M070".to_string(),
            terms_and_conditions: crate::invoices::repository::DEFAULT_TERMS.to_string(),
            cgst_rate: 9.0,
            sgst_rate: 9.0,
            igst_rate: 18.0,
        }
    }
}
