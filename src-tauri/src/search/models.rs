use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct SearchResult {
    pub kind: String,
    pub id: i64,
    pub title: String,
    pub subtitle: String,
}
