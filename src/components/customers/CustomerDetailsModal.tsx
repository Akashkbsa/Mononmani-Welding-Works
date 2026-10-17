import RecordReminders from "../reminders/RecordReminders";
import { ReactNode, useCallback, useEffect, useState } from "react";
import { BookOpen } from "lucide-react";
import { Customer, formatCustomerAddress } from "../../types/customer";
import { InvoiceListItem } from "../../types/invoice";
import { PaymentListItem } from "../../types/payment";
import { SupplierBillListItem } from "../../types/supplierBill";
import { SupplierPaymentListItem } from "../../types/supplierPayment";
import {
  deleteCustomer,
  getCustomerCredits,
  listInvoices,
  listPayments,
  listSupplierBills,
  listSupplierPayments,
} from "../../services/api";
import { errorMessage, formatDate, formatMoney, formatPhone } from "../../lib/format";
import { Alert, Badge, Button, ConfirmDialog, Loading, Modal, rowClass, rowProps, SectionTitle, StatusBadge } from "../ui";
import PartyTypeBadge from "./PartyTypeBadge";
import LedgerModal from "./LedgerModal";
import SupplierBillStatusBadge from "../supplierBills/SupplierBillStatusBadge";
import InvoiceDetailsModal from "../invoices/InvoiceDetailsModal";
import PaymentDetailsModal from "../payments/PaymentDetailsModal";
import SupplierBillDetailsModal from "../supplierBills/SupplierBillDetailsModal";
import SupplierPaymentDetailsModal from "../supplierPayments/SupplierPaymentDetailsModal";
import { useReminders } from "../reminders/RemindersContext";

interface Props {
  customer: Customer;
  onClose: () => void;
  onEdit: () => void;
  onDeleted: () => void;
  /** Called after something opened from here changed (a payment recorded, an invoice edited). */
  onChanged?: () => void;
}

/** A record opened on top of this window; closing it comes back here. */
type Opened =
  | { kind: "invoice"; id: number }
  | { kind: "payment"; id: number }
  | { kind: "bill"; id: number }
  | { kind: "supplierPayment"; id: number };

export default function CustomerDetailsModal({ customer, onClose, onEdit, onDeleted, onChanged }: Props) {
  const { openRecord } = useReminders();
  const isCustomer = customer.party_type !== "SUPPLIER";
  const isSupplier = customer.party_type !== "CUSTOMER";

  const [invoices, setInvoices] = useState<InvoiceListItem[] | null>(null);
  const [payments, setPayments] = useState<PaymentListItem[] | null>(null);
  const [advance, setAdvance] = useState(0);
  const [bills, setBills] = useState<SupplierBillListItem[] | null>(null);
  const [supplierPayments, setSupplierPayments] = useState<SupplierPaymentListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showLedger, setShowLedger] = useState(false);
  const [opened, setOpened] = useState<Opened | null>(null);

  const load = useCallback(() => {
    if (isCustomer) {
      Promise.all([listInvoices({ customer_id: customer.id }), listPayments({ customer_id: customer.id }), getCustomerCredits(customer.id)])
        .then(([list, paid, credits]) => {
          setInvoices(list);
          setPayments(paid);
          setAdvance(credits.reduce((sum, c) => sum + c.remaining_amount, 0));
        })
        .catch((err) => setError(errorMessage(err)));
    }
    // Bills this company has sent us, and what we paid, for suppliers and companies that are both.
    if (isSupplier) {
      Promise.all([listSupplierBills({ supplier_id: customer.id }), listSupplierPayments({ supplier_id: customer.id })])
        .then(([list, paid]) => {
          setBills(list);
          setSupplierPayments(paid);
        })
        .catch((err) => setError(errorMessage(err)));
    }
  }, [customer.id, isCustomer, isSupplier]);

  useEffect(() => {
    load();
  }, [load]);

  const changed = () => {
    load();
    onChanged?.();
  };
  const closeOpened = () => setOpened(null);

  const owedToSupplier = (bills ?? []).reduce((sum, b) => sum + b.outstanding_amount, 0);
  const outstanding = (invoices ?? []).reduce((sum, i) => sum + (i.status === "ISSUED" ? i.outstanding_amount : 0), 0);
  const address = formatCustomerAddress(customer);

  return (
    <>
      <Modal
        title={customer.name}
        subtitle={
          <span className="flex items-center gap-2">
            <PartyTypeBadge type={customer.party_type} />
            {customer.gstin ? `GSTIN ${customer.gstin}` : "Unregistered"}
          </span>
        }
        onClose={onClose}
        size="lg"
        footer={
          <>
            <Button variant="dangerText" className="mr-auto" onClick={() => setConfirmDelete(true)}>
              Delete company
            </Button>
            <Button onClick={onClose}>Close</Button>
            <Button icon={<BookOpen className="h-4 w-4" />} onClick={() => setShowLedger(true)}>
              Ledger
            </Button>
            <Button variant="primary" onClick={onEdit}>
              Edit
            </Button>
          </>
        }
      >
        <div className="space-y-6">
          {error && <Alert>{error}</Alert>}

          <div className="grid grid-cols-3 gap-6 text-sm">
            <div>
              <div className="text-xs text-slate-500 mb-1">Contact</div>
              <div>{customer.phone || "—"}</div>
              {customer.whatsapp_number && (
                <div className="text-slate-600">WhatsApp {formatPhone(customer.whatsapp_number)}</div>
              )}
              <div className="text-slate-600">{customer.email || ""}</div>
            </div>
            <div className="col-span-2">
              <div className="text-xs text-slate-500 mb-1">Address</div>
              <div>{address || "—"}</div>
            </div>
          </div>

          {isCustomer && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <Figure label="Balance due" value={outstanding} />
                <Figure label="Advance held" value={advance} />
              </div>

              <RecordTable
                title="Invoices"
                rows={invoices}
                empty="No invoices yet."
                head={["Invoice", "Date", "Amount", "Balance", "Status"]}
                render={(inv) => [
                  inv.invoice_number,
                  formatDate(inv.invoice_date),
                  formatMoney(inv.total_amount),
                  inv.status === "ISSUED" ? formatMoney(inv.outstanding_amount) : "—",
                  <StatusBadge status={inv.payment_status} />,
                ]}
                onOpen={(inv) => setOpened({ kind: "invoice", id: inv.id })}
                right={3}
              />

              <RecordTable
                title="Payments received"
                rows={payments}
                empty="No payments yet."
                head={["Payment", "Date", "Method", "Invoices", "Amount"]}
                render={(p) => [
                  p.payment_number,
                  formatDate(p.payment_date),
                  <span className="flex items-center gap-2">
                    {p.payment_method}
                    {!p.is_verified && <Badge tone="amber">Not cleared</Badge>}
                  </span>,
                  p.invoices_covered.length ? p.invoices_covered.join(", ") : "Advance",
                  formatMoney(p.amount_received),
                ]}
                onOpen={(p) => setOpened({ kind: "payment", id: p.id })}
              />
            </>
          )}

          {isSupplier && (
            <>
              <Figure label="Amount you owe" value={owedToSupplier} />

              <RecordTable
                title="Supplier bills"
                rows={bills}
                empty="No supplier bills yet."
                head={["Bill", "Date", "Amount", "Balance", "Status"]}
                render={(b) => [
                  b.bill_number,
                  formatDate(b.bill_date),
                  formatMoney(b.total_amount),
                  b.outstanding_amount > 0 ? formatMoney(b.outstanding_amount) : "—",
                  <SupplierBillStatusBadge status={b.status} />,
                ]}
                onOpen={(b) => setOpened({ kind: "bill", id: b.id })}
                right={3}
              />

              <RecordTable
                title="Payments made"
                rows={supplierPayments}
                empty="No payments to this supplier yet."
                head={["Payment", "Date", "Method", "Bills", "Amount"]}
                render={(p) => [
                  p.payment_number,
                  formatDate(p.payment_date),
                  p.payment_method,
                  p.bills_covered.length ? p.bills_covered.join(", ") : "—",
                  formatMoney(p.amount_paid),
                ]}
                onOpen={(p) => setOpened({ kind: "supplierPayment", id: p.id })}
              />
            </>
          )}
          <RecordReminders kind="COMPANY" id={customer.id} label={customer.name} suggestedTitle={customer.name} />
        </div>
      </Modal>

      {opened?.kind === "invoice" && (
        <InvoiceDetailsModal
          invoiceId={opened.id}
          onClose={closeOpened}
          onChanged={changed}
          onOpenQuotation={(quotationId) => {
            closeOpened();
            onClose();
            openRecord("QUOTATION", quotationId);
          }}
        />
      )}
      {opened?.kind === "payment" && <PaymentDetailsModal paymentId={opened.id} onClose={closeOpened} onChanged={changed} />}
      {opened?.kind === "bill" && (
        <SupplierBillDetailsModal
          id={opened.id}
          onClose={closeOpened}
          onChanged={changed}
          onOpenPayment={(paymentId) => setOpened({ kind: "supplierPayment", id: paymentId })}
        />
      )}
      {opened?.kind === "supplierPayment" && (
        <SupplierPaymentDetailsModal paymentId={opened.id} onClose={closeOpened} onChanged={changed} />
      )}

      {showLedger && <LedgerModal companyId={customer.id} companyName={customer.name} onClose={() => setShowLedger(false)} />}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete company?"
          message={
            <>
              <strong>{customer.name}</strong> will be removed from your list. Companies with invoices, payments or supplier
              records can't be deleted.
            </>
          }
          confirmLabel="Delete"
          onConfirm={async () => {
            await deleteCustomer(customer.id);
            onDeleted();
          }}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-slate-50 px-4 py-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg font-semibold tabular">{formatMoney(value)}</div>
    </div>
  );
}

/**
 * A small list of the company's records; a click (or Enter) opens one on top of this window.
 * The first column is the record's number; the last `right` columns are figures or a status, set right.
 */
function RecordTable<T extends { id: number }>({
  title,
  rows,
  empty,
  head,
  render,
  onOpen,
  right = 1,
}: {
  title: string;
  rows: T[] | null;
  empty: string;
  head: string[];
  render: (row: T) => ReactNode[];
  onOpen: (row: T) => void;
  right?: number;
}) {
  const align = (i: number) => (i >= head.length - right ? "text-right" : "");
  return (
    <div>
      <SectionTitle>{title}</SectionTitle>
      {rows === null ? (
        <Loading />
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500">{empty}</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
              {head.map((h, i) => (
                <th key={h} className={`py-2 font-medium ${i === 0 ? "pl-2" : ""} ${align(i)}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.id} {...rowProps(() => onOpen(row))} className={rowClass}>
                {render(row).map((cell, i) => (
                  <td
                    key={i}
                    className={`py-2 ${i === 0 ? "pl-2 font-medium" : "text-slate-600"} ${align(i)} ${
                      align(i) && typeof cell === "string" ? "tabular" : ""
                    } ${i === head.length - 1 ? "pr-2" : ""}`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
