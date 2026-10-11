/** The owner's own details: printed on every invoice and used as defaults for new ones. */
export interface BusinessSettings {
  business_name: string;
  business_subtitle: string;
  gstin: string;
  phone: string;
  email: string;
  address: string;
  services_banner: string;
  bank_name: string;
  bank_branch: string;
  bank_account_no: string;
  bank_ifsc: string;
  terms_and_conditions: string;
  cgst_rate: number;
  sgst_rate: number;
  igst_rate: number;
}
