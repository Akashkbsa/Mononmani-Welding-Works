use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RentalFileInfo {
    pub id: i64,
    pub file_name: String,
    pub mime_type: String,
    pub size_bytes: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Place {
    pub id: i64,
    pub name: String,
    pub address: Option<String>,
    pub monthly_rent: f64,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaceInput {
    pub name: String,
    pub address: Option<String>,
    pub monthly_rent: f64,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaceListItem {
    pub id: i64,
    pub name: String,
    pub address: Option<String>,
    pub monthly_rent: f64,
    /// The tenant living there now; none means the place is vacant.
    pub current_tenant: Option<String>,
    pub file_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaceDetail {
    pub place: Place,
    pub files: Vec<RentalFileInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tenant {
    pub id: i64,
    pub place_id: i64,
    pub place_name: String,
    pub name: String,
    /// `+` and digits, e.g. +919876543210.
    pub whatsapp_number: String,
    pub monthly_rent: f64,
    pub move_in_date: Option<String>,
    pub moved_out_date: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TenantInput {
    pub place_id: i64,
    pub name: String,
    pub whatsapp_number: String,
    pub monthly_rent: f64,
    pub move_in_date: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TenantListItem {
    pub id: i64,
    pub place_id: i64,
    pub place_name: String,
    pub name: String,
    pub whatsapp_number: String,
    pub monthly_rent: f64,
    pub move_in_date: Option<String>,
    pub moved_out_date: Option<String>,
    pub file_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TenantDetail {
    pub tenant: Tenant,
    pub files: Vec<RentalFileInfo>,
}
