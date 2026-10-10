import { useEffect, useState } from "react";
import { Customer, formatCustomerAddress } from "../../types/customer";
import { InvoiceListItem } from "../../types/invoice";
import { deleteCustomer, getCustomerCredits, listInvoices } from "../../services/api";
import { errorMessage, formatDate, formatMoney } from "../../lib/format";
import { Alert, Button, ConfirmDialog, Loading, Modal, SectionTitle, StatusBadge } from "../ui";

interface Props {
  customer: Customer;
  onClose: () => void;
  onEdit: () => void;
  onDeleted: () => void;
}

export default function CustomerDetailsModal({ customer, onClose, onEdit, onDeleted }: Props) {
  const [invoices, setInvoices] = useState<InvoiceListItem[] | null>(null);
  const [advance, setAdvance] = useState(0);
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

  const outstanding = (invoices ?? []).reduce((sum, i) => sum + (i.status === "ISSUED" ? i.outstanding_amount : 0), 0);
  const address = formatCustomerAddress(customer);

  return (
    <>
      <Modal
        title={customer.name}
        subtitle={customer.gstin ? `GSTIN ${customer.gstin}` : "Unregistered"}
        onClose={onClose}
        size="lg"
        footer={
          <>
            <Button variant="dangerText" className="mr-auto" onClick={() => setConfirmDelete(true)}>
              Delete customer
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
        </div>
      </Modal>

      {confirmDelete && (
        <ConfirmDialog
          title="Delete customer?"
          message={
            <>
              <strong>{customer.name}</strong> will be removed from your customer list. Customers with invoices or
              payments can't be deleted.
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
