import { PurchaseOrderStatus } from "../../types/purchaseOrder";
import { Badge } from "../ui";

/** The purchase order status as a small coloured label. */
export default function PurchaseOrderStatusBadge({ status }: { status: PurchaseOrderStatus }) {
  if (status === "COMPLETED") return <Badge tone="green">Completed</Badge>;
  if (status === "PARTIAL") return <Badge tone="amber">Partially completed</Badge>;
  return <Badge tone="neutral">Not started</Badge>;
}
