use serde::{Deserialize, Serialize};

/// What a company is to the business: someone it sells to, buys from, or both.
pub const PARTY_TYPES: [&str; 3] = ["CUSTOMER", "SUPPLIER", "BOTH"];

/// The side of the business a record needs the company for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PartyRole {
    Customer,
    Supplier,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Customer {
    pub id: i64,
    pub name: String,
    pub gstin: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub address_line1: Option<String>,
    pub address_line2: Option<String>,
    pub city: Option<String>,
    pub state: Option<String>,
    pub postal_code: Option<String>,
    pub is_favorite: bool,
    pub last_used_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    /// "CUSTOMER", "SUPPLIER" or "BOTH".
    pub party_type: String,
    /// `+` and digits when WhatsApp is on another number; None means WhatsApp the phone number.
    pub whatsapp_number: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomerCreateInput {
    pub name: String,
    pub gstin: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub address_line1: Option<String>,
    pub address_line2: Option<String>,
    pub city: Option<String>,
    pub state: Option<String>,
    pub postal_code: Option<String>,
    pub is_favorite: Option<bool>,
    /// Only when WhatsApp is on a number other than the phone; empty or None means the phone.
    #[serde(default)]
    pub whatsapp_number: Option<String>,
    /// None on create means CUSTOMER; None on update leaves the type as it is.
    #[serde(default)]
    pub party_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomerUpdateInput {
    pub name: String,
    pub gstin: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub address_line1: Option<String>,
    pub address_line2: Option<String>,
    pub city: Option<String>,
    pub state: Option<String>,
    pub postal_code: Option<String>,
    pub is_favorite: Option<bool>,
    /// Only when WhatsApp is on a number other than the phone; empty or None means the phone.
    #[serde(default)]
    pub whatsapp_number: Option<String>,
    /// None on create means CUSTOMER; None on update leaves the type as it is.
    #[serde(default)]
    pub party_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DuplicateCheckResult {
    pub has_duplicate: bool,
    pub existing_customer: Option<Customer>,
}
