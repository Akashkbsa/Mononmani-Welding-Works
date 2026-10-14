import { PARTY_TYPE_LABEL, PartyType } from "../../types/customer";
import { Badge } from "../ui";

/** Customer, Supplier or Both as a small label. */
export default function PartyTypeBadge({ type }: { type: PartyType }) {
  return <Badge tone={type === "SUPPLIER" ? "blue" : type === "BOTH" ? "green" : "neutral"}>{PARTY_TYPE_LABEL[type]}</Badge>;
}
