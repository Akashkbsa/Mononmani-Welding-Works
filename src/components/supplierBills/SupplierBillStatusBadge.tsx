import { Check } from "lucide-react";
import { BILL_STATUS_LABEL, BillStatus } from "../../types/supplierBill";
import { Badge } from "../ui";

/** Fully paid reads as quiet text with a tick; the bills still to act on get a colour block. */
export default function SupplierBillStatusBadge({ status }: { status: BillStatus }) {
  if (status === "PAID") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
        <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
        {BILL_STATUS_LABEL.PAID}
      </span>
    );
  }
  if (status === "PARTIAL") return <Badge tone="blue">{BILL_STATUS_LABEL.PARTIAL}</Badge>;
  return <Badge tone="amber">{BILL_STATUS_LABEL.NOT_PAID}</Badge>;
}
