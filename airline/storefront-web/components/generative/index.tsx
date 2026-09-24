// Copyright 2026 Anthropic PBC
// SPDX-License-Identifier: Apache-2.0

/** Maps a `ui` event's component key to its card. */

import { type GenerativeBlockProps, UnknownBlock } from "web-shared";
import type {
  CardApplicationPayload,
  CheckoutPayload,
  ComparisonPayload,
  CreditDecisionPayload,
  DisclosurePayload,
  GuidePayload,
  OrderStatusPayload,
  PlanMatrixPayload,
  PlanPayload,
  Product,
  ProductsPayload,
} from "@/lib/types";
import BookingStatusCard from "./BookingStatusCard";
import BookingSummary from "./BookingSummary";
import CardApplication from "./CardApplication";
import ComparisonTable from "./ComparisonTable";
import CreditDecision from "./CreditDecision";
import FactsBox from "./FactsBox";
import PlanMatrix from "./PlanMatrix";
import ProductCarousel from "./ProductCarousel";
import TermsCard from "./TermsCard";
import TripChecklist from "./TripChecklist";

/** PlanMatrix draws its skeleton for zero plans. */
const EMPTY_MATRIX: PlanMatrixPayload = { plans: [], rows: [], annotations: [] };

export default function GenerativeBlock({
  block,
  status,
  onAdd,
  onAccountChange,
}: GenerativeBlockProps & {
  onAdd?: (product: Product) => boolean | void | Promise<boolean | void>;
  onAccountChange?: () => void;
}) {
  const partial = status !== "final";
  switch (block.component) {
    case "products":
      return <ProductCarousel payload={block.payload as ProductsPayload} onAdd={onAdd} partial={partial} />;
    case "comparison":
      return <ComparisonTable payload={block.payload as ComparisonPayload} partial={partial} />;
    case "plan":
      return <TripChecklist payload={block.payload as PlanPayload} partial={partial} />;
    case "guide":
      return <TermsCard payload={block.payload as GuidePayload} />;
    case "order_status":
      if (partial) return null;
      return <BookingStatusCard payload={block.payload as OrderStatusPayload} />;
    case "checkout":
      if (partial) return null;
      return <BookingSummary payload={block.payload as CheckoutPayload} />;
    case "disclosure":
      if (partial) return null;
      return <FactsBox payload={block.payload as DisclosurePayload} />;
    case "plan_matrix":
      return <PlanMatrix payload={status === "pending" ? EMPTY_MATRIX : (block.payload as PlanMatrixPayload)} />;
    case "card_application":
      if (partial) return null;
      return <CardApplication payload={block.payload as CardApplicationPayload} onSubmitted={onAccountChange} />;
    case "credit_decision":
      if (partial) return null;
      return <CreditDecision payload={block.payload as CreditDecisionPayload} />;
    default:
      return partial ? null : <UnknownBlock component={block.component} />;
  }
}
