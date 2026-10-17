export type MessageKind = "SUPPLIER_PAYMENT" | "RENT_REMINDER" | "EMPLOYEE_PAY" | "EMPLOYEE_PAY_SLIP";

/** A keyword the owner can put in a template, e.g. {employee_name}. */
export interface MessageKeyword {
  key: string;
  label: string;
  /** Shown in the Settings preview. */
  sample: string;
}

export interface MessageTemplate {
  kind: MessageKind;
  title: string;
  used_for: string;
  template: string;
  default_template: string;
  keywords: MessageKeyword[];
}
