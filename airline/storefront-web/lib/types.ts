// Copyright 2026 Anthropic PBC
// SPDX-License-Identifier: Apache-2.0

/** Mirrors shopping_agent/types.py and tools/presentation.py; detail extras are the vertical's api/. */

export interface Product {
  product_id: string;
  title: string;
  brand?: string | null;
  price: number;
  currency?: string;
  rating?: number | null;
  review_count?: number | null;
  image_url?: string | null;
  category?: string | null;
  labels?: string[];
  attributes?: Record<string, string>;
  in_stock?: boolean;
  short_description?: string | null;
  /** Options still to choose on a family record; the cart takes one of its variants. */
  options?: Record<string, string[]>;
  /** A variant's value for each option. */
  option_values?: Record<string, string>;
  variant_of?: string | null;
}

export interface CartItem {
  product_id: string;
  title: string;
  price: number;
  quantity: number;
  image_url?: string | null;
  option_values?: Record<string, string>;
  variant_of?: string | null;
  line_total: number;
}

export interface CartPayload {
  items: CartItem[];
  item_count: number;
  subtotal: number;
  currency: string;
}

// --- Presentation payloads, as streamed after server enrichment ---

export interface ProductsPayload {
  title?: string;
  layout?: "carousel" | "grid" | "list";
  items: { product: Product; reason?: string | null }[];
}

export interface ComparisonPayload {
  title?: string;
  entries: {
    product_id: string;
    product: Product;
    pros?: string[];
    cons?: string[];
    best_for?: string | null;
  }[];
  dimensions?: string[];
  recommended_product_id?: string | null;
  // Stamped by the server: the spread between the cheapest and dearest compared items.
  price_delta?: {
    amount: number;
    low_product_id: string;
    low_price: number;
    high_product_id: string;
    high_price: number;
  };
}

export interface PlanPayload {
  title: string;
  intro?: string;
  steps: { label: string; detail?: string | null; products: Product[] }[];
}

export interface GuidePayload {
  title: string;
  sections: { heading: string; body: string }[];
  related_products?: Product[];
  sources?: string[];
}

export interface OrderStatusPayload {
  order_id: string;
  summary: string;
  next_step?: string;
  order?: {
    order_id: string;
    status: string;
    placed_at: string;
    items: { product_id: string; title: string; quantity: number; price: number }[];
    total: number;
    currency?: string;
    estimated_delivery?: string;
    tracking_url?: string;
  };
}

export interface CheckoutHandoff {
  url: string;
  label?: string;
  seller?: string;
}

export interface CheckoutPayload {
  /** Where payment happens when it is not a route in this app; filled by the backend. */
  handoffs?: CheckoutHandoff[];
  note?: string;
  fulfillment_method?: "delivery" | "pickup" | "shipping";
  cart: CartPayload;
}

/** `present_plan_comparison`: cabins of a flight, card tiers, insurance plans. Values arrive formatted. */
export interface PlanMatrixPayload {
  title?: string;
  plans: Product[];
  rows: { key: string; label: string; values: string[] }[];
  annotations: { plan_id: string; best_for?: string }[];
  recommended_plan_id?: string | null;
  /** The column the customer already holds (their card tier). */
  current_product_id?: string | null;
}

// --- Quasar account (`GET /api/account`) ---

export type CardTier = "classic" | "gold" | "platinum";

export interface CreditReason {
  code: string;
  text: string;
  effect: "positive" | "negative";
}

/** The engine's decision, as the backend stores it on the session. */
export interface CreditAssessment {
  decision: "approved" | "review" | "declined";
  score: number;
  score_band: string;
  approved_tiers: string[];
  recommended_tier?: string | null;
  credit_limit_usd?: number | null;
  reasons: CreditReason[];
  engine: string;
  decided_at?: string;
}

export interface AccountContext {
  loyalty: {
    program: string;
    tier: string;
    miles_balance: number;
    miles_expiring: { miles: number; on: string } | null;
  };
  card: {
    product_id: string;
    tier: string;
    name: string;
    credit_limit_usd: number;
    available_usd: number;
    interest_free_installments: number;
  } | null;
  card_application: {
    status: "not_started" | "decided";
    assessment: CreditAssessment | null;
  };
  upcoming_trip: UpcomingTrip | null;
  /** Tiers a cardholder is pre-approved to move up to (e.g. ["platinum"]). */
  card_upgrade_preapproved?: string[] | null;
}

export interface UpcomingTrip {
  order_id: string;
  title: string;
  travel_date: string;
  booked_extras?: string[] | null;
  paid_with?: string | null;
  /** What the customer's card gives on this trip. */
  card_benefits?: string[] | null;
}

// --- Credit application (`present_card_application`, `present_credit_decision`) ---

export type EmploymentStatus = "employed" | "self_employed" | "retired" | "student" | "unemployed";
export type Housing = "own" | "rent" | "mortgage" | "family";
export type Cabin = "economy" | "premium" | "business";

/** What the form posts, minus the consents. */
export interface CardApplicationFields {
  employment_status: EmploymentStatus;
  employer_description: string;
  employment_months: number;
  monthly_income_usd: number;
  monthly_obligations_usd: number;
  housing: Housing;
  trips_per_year: number;
  usual_routes: string;
  annual_travel_spend_usd: number;
  preferred_cabin: Cabin;
  goal: string;
  birth_year: number;
}

export interface Choice {
  value: string;
  label: string;
}

export interface CardApplicationPayload {
  title: string;
  intro?: string | null;
  status: "not_started" | "decided";
  prefill: Partial<CardApplicationFields>;
  choices: {
    employment_status: Choice[];
    housing: Choice[];
    preferred_cabin: Choice[];
  };
  consent_text: string;
  terms_text: string;
  submit_label: string;
}

export interface CreditDecisionPayload extends CreditAssessment {
  headline: string;
  recommended_product_id?: string | null;
  tiers: {
    tier: string;
    product_id: string;
    title: string;
    annual_fee: number;
    approved: boolean;
    recommended: boolean;
    highlights: string[];
  }[];
  next_steps: string;
  note?: string | null;
}

/** Rows come from `StorefrontBackend.get_disclosure`. */
export interface DisclosurePayload {
  title: string;
  product_id: string;
  rows: { label: string; value: string; note?: string }[];
  sources?: string[];
  footnotes?: string[];
}
