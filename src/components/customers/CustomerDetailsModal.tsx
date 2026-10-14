import { useEffect, useState } from "react";
import { Customer, formatCustomerAddress } from "../../types/customer";
import { InvoiceListItem } from "../../types/invoice";
import { SupplierBillListItem } from "../../types/supplierBill";
import { deleteCustomer, getCustomerCredits, getSupplierCredits, listInvoices, listSupplierBills } from "../../services/api";
import { errorMessage, formatDate, formatMoney } from "../../lib/format";
import { Alert, Button, ConfirmDialog, Loading, Modal, SectionTitle, StatusBadge } from "../ui";
import PartyTypeBadge from "./PartyTypeBadge";
import SupplierBillStatusBadge from "../supplierBills/SupplierBillStatusBadge";

interface Props {
  customer: Customer;
  onClose: () => void;
  onEdit: () => void;
  onDeleted: () => void;
}

export default function CustomerDetailsModal({ customer, onClose, onEdit, onDeleted }: Props) {
  const [invoices, setInvoices] = useState<InvoiceListItem[] | null>(null);
  const [advance, setAdvance] = useState(0);
  const [bills, setBills] = useState<SupplierBillListItem[] | null>(null);
  const [supplierAdvance, setSupplierAdvance] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    Promise.all([listInvoices({ customer_id: customer.id }), getCustomerCredits(customer.id)])
      .then(([list, credits]) => {
        setInvoices(list);
        setAdvance(credits.reduce((sum, c) => sum + c.remaining_amount, 0));
      })
      .catch((err) => setError(errorMessage(err)));
  }, [customer.id]);

  // Bills this company has sent us, for suppliers and companies that are both.
  useEffect(() => {
    if (customer.party_type === "CUSTOMER") return;
    Promise.all([listSupplierBills({ supplier_id: customer.id }), getSupplierCredits(customer.id)])
      .then(([list, credits]) => {
        setBills(list);
        setSupplierAdvance(credits.reduce((sum, c) => sum + c.remaining_amount, 0));
      })
      .catch((err) => setError(errorMessage(err)));
  }, [customer.id, customer.party_type]);

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
              <div className="text-slate-600">{customer.email || ""}</div>
            </div>
            <div className="col-span-2">
              <div className="text-xs text-slate-500 mb-1">Address</div>
              <div>{address || "—"}</div>
            </div>
          </div>

          {customer.party_type !== "SUPPLIER" && (
          <>
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-md bg-slate-50 px-4 py-3">
              <div className="text-xs text-slate-500">Balance due</div>
              <div className="text-lg font-semibold tabular">{formatMoney(outstanding)}</div>
            </div>
            <div className="rounded-md bg-slate-50 px-4 py-3">
              <div className="text-xs text-slate-500">Advance held</div>
              <div className="text-lg font-semibold tabular">{formatMoney(advance)}</div>
            </div>
          </div>

          <div>
            <SectionTitle>Invoices</SectionTitle>
            {invoices === null ? (
              <Loading />
            ) : invoices.length === 0 ? (
              <p className="text-sm text-slate-500">No invoices yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                    <th className="py-2 font-medium">Invoice</th>
                    <th className="py-2 font-medium">Date</th>
                    <th className="py-2 font-medium text-right">Amount</th>
                    <th className="py-2 font-medium text-right">Balance</th>
                    <th className="py-2 font-medium text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {invoices.map((inv) => (
                    <tr key={inv.id}>
                      <td className="py-2 font-medium">{inv.invoice_number}</td>
                      <td className="py-2 text-slate-600">{formatDate(inv.invoice_date)}</td>
                      <td className="py-2 text-right tabular">{formatMoney(inv.total_amount)}</td>
                      <td className="py-2 text-right tabular">
                        {inv.status === "ISSUED" ? formatMoney(inv.outstanding_amount) : "—"}
                      </td>
                      <td className="py-2 text-right">
                        <StatusBadge status={inv.payment_status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          </>
          )}

          {customer.party_type !== "CUSTOMER" && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-md bg-slate-50 px-4 py-3">
                  <div className="text-xs text-slate-500">Amount you owe</div>
                  <div className="text-lg font-semibold tabular">{formatMoney(owedToSupplier)}</div>
                </div>
                <div className="rounded-md bg-slate-50 px-4 py-3">
                  <div className="text-xs text-slate-500">Advance paid</div>
                  <div className="text-lg font-semibold tabular">{formatMoney(supplierAdvance)}</div>
                </div>
              </div>
              <div>
                <SectionTitle>Supplier bills</SectionTitle>
                {bills === null ? (
                  <Loading />
                ) : bills.length === 0 ? (
                  <p className="text-sm text-slate-500">No supplier bills yet.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                        <th className="py-2 font-medium">Bill</th>
                        <th className="py-2 font-medium">Date</th>
                        <th className="py-2 font-medium text-right">Amount</th>
                        <th className="py-2 font-medium text-right">Balance</th>
                        <th className="py-2 font-medium text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {bills.map((b) => (
                        <tr key={b.id}>
                          <td className="py-2 font-medium">{b.bill_number}</td>
                          <td className="py-2 text-slate-600">{formatDate(b.bill_date)}</td>
                          <td className="py-2 text-right tabular">{formatMoney(b.total_amount)}</td>
                          <td className="py-2 text-right tabular">{b.outstanding_amount > 0 ? formatMoney(b.outstanding_amount) : "—"}</td>
                          <td className="py-2 text-right">
                            <SupplierBillStatusBadge status={b.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </div>
      </Modal>

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
