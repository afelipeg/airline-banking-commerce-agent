// Copyright 2026 Anthropic PBC
// SPDX-License-Identifier: Apache-2.0

import { formatMoney } from "web-shared";
import type { Product } from "./types";

type Catalog = Record<string, Product>;

type Line = { product_id: string; line_total: number };

export function formatPrice(value: number, currency = "USD"): string {
  return formatMoney(value, currency, { whole: Number.isInteger(value) });
}

/** The catalog's categories as the storefront names them. */
export const CATEGORY_LABELS: Record<string, string> = {
  flights: "Vuelos",
  ancillaries: "Servicios adicionales",
  card: "Tarjeta Quasar",
  miles: "Millas",
  insurance: "Seguros de viaje",
  financing: "Quasar Pay",
};

/** `POST /api/cart/add` takes these; the card and Quasar Pay go through the assistant. */
export const DIRECT_ADD_CATEGORIES = new Set(["flights", "ancillaries", "miles", "insurance"]);

const PRICE_SUFFIX: Record<string, string> = {
  per_passenger_one_way: " por pasajero",
  per_year: "/año",
  per_segment: " por trayecto",
  per_trip: " por viaje",
  per_visit: " por visita",
  financing: " sin costo de apertura",
};

export function priceSuffix(priceUnit: string | null | undefined): string {
  return priceUnit ? (PRICE_SUFFIX[priceUnit] ?? "") : "";
}

export function formatPriceWithUnit(product: Product): string {
  return `${formatPrice(product.price, product.currency)}${priceSuffix(product.attributes?.price_unit)}`;
}

const OPTION_LABELS: Record<string, string> = {
  economy: "Económica",
  premium: "Premium",
  business: "Business",
  classic: "Classic",
  gold: "Gold",
  platinum: "Platinum",
};

/** "economy" as "Económica"; unknown option values pass through. */
export function optionLabel(value: string): string {
  return OPTION_LABELS[value] ?? value;
}

/** A variant's or cart line's chosen options, in Spanish: "Económica", "Gold". */
export function chosenLabel(item: { option_values?: Record<string, string> }): string {
  return Object.values(item.option_values ?? {}).map(optionLabel).join(" · ");
}

/** What a family still offers: "Económica · Premium · Business". */
export function optionsLabel(product: { options?: Record<string, string[]> }): string {
  return Object.values(product.options ?? {})
    .map((values) => values.map(optionLabel).join(" · "))
    .join(" / ");
}

function categoryOf(product: Pick<Product, "product_id" | "category">): string {
  if (product.category) return product.category;
  const id = product.product_id;
  if (/^QA-CARD/.test(id)) return "card";
  if (/^QA-MIL/.test(id)) return "miles";
  if (/^QA-INS/.test(id)) return "insurance";
  if (/^QA-PAY/.test(id)) return "financing";
  if (/^QA-ANC/.test(id)) return "ancillaries";
  if (/^QA-\d/.test(id)) return "flights";
  return "";
}

export function isFlight(product: Pick<Product, "product_id" | "category">): boolean {
  return categoryOf(product) === "flights";
}

export function isDirectAddable(product: Pick<Product, "product_id" | "category">): boolean {
  return DIRECT_ADD_CATEGORIES.has(categoryOf(product));
}

export function isCardProduct(product: Pick<Product, "product_id" | "category">): boolean {
  return categoryOf(product) === "card";
}

export function isFinancing(product: Pick<Product, "product_id" | "category">): boolean {
  return categoryOf(product) === "financing";
}

/** The plate drawn in place of a photo: the route for a flight, a short word otherwise. */
export function plateGlyph(product: Product): string {
  const attrs = product.attributes ?? {};
  switch (categoryOf(product)) {
    case "flights":
      return attrs.origin && attrs.destination ? `${attrs.origin}→${attrs.destination}` : "Vuelo";
    case "card": {
      const tier = product.option_values?.tier;
      return tier ? optionLabel(tier) : "Visa";
    }
    case "miles":
      return "Millas";
    case "insurance":
      return "Seguro";
    case "financing":
      return "Pay";
    default: {
      const word = product.title.split(" ").find((w) => w.length > 2);
      return word ?? product.title.slice(0, 6);
    }
  }
}

export function plateTint(product: Product): string {
  switch (categoryOf(product)) {
    case "flights":
      return "linear-gradient(135deg, rgba(59,91,219,0.14), rgba(59,91,219,0.03))";
    case "card":
      return "linear-gradient(135deg, rgba(184,134,11,0.20), rgba(14,17,22,0.05))";
    case "miles":
      return "linear-gradient(135deg, rgba(101,71,201,0.14), rgba(101,71,201,0.03))";
    case "insurance":
      return "linear-gradient(135deg, rgba(19,130,84,0.12), rgba(19,130,84,0.02))";
    case "financing":
      return "linear-gradient(135deg, rgba(14,17,22,0.10), rgba(14,17,22,0.02))";
    default:
      return "linear-gradient(135deg, rgba(184,122,0,0.10), rgba(184,122,0,0.02))";
  }
}

/** Falls back to the id prefix until the catalog loads (card tiers are an annual fee). */
export function priceUnitOf(productId: string, catalog: Catalog): string {
  const product = catalog[productId];
  if (product?.attributes?.price_unit) return product.attributes.price_unit;
  return /^QA-CARD/.test(productId) ? "per_year" : "one_time";
}

/** What is paid at checkout, and the card's annual fee, which is charged at activation. */
export function splitCart(items: Line[], catalog: Catalog): { today: number; annual: number } {
  let today = 0;
  let annual = 0;
  for (const item of items) {
    if (priceUnitOf(item.product_id, catalog) === "per_year") annual += item.line_total;
    else today += item.line_total;
  }
  return { today, annual };
}
