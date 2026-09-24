// Copyright 2026 Anthropic PBC
// SPDX-License-Identifier: Apache-2.0

/** How each kind of Quasar record shows: its label, icon, and tone. */

import type { IconName, KindStyle, Tone } from "web-shared";
import type { InventoryAlert, ListingStatus, OrderIssue, PlanMixRow } from "./types";

export const ISSUE_KINDS: Record<OrderIssue["kind"], KindStyle> = {
  delayed: { label: "Retraso", icon: "clock", tone: "warn" },
  return_spike: { label: "Pico de reembolsos", icon: "return", tone: "danger" },
  buyer_message: { label: "Mensaje de cliente", icon: "message", tone: "info" },
  damaged: { label: "Novedad reportada", icon: "alert", tone: "danger" },
};

/** Inventory alerts describe flight cabins: stock is seats left. */
export const INVENTORY_KINDS: Record<InventoryAlert["kind"], KindStyle> = {
  low_stock: { label: "Cabina casi llena", icon: "low", tone: "warn" },
  slow_mover: { label: "Venta lenta", icon: "clock", tone: "muted" },
};

export const LISTING_STATUS: Record<ListingStatus, { label: string; tone: Tone }> = {
  active: { label: "Activo", tone: "ok" },
  paused: { label: "Pausado", tone: "muted" },
  draft: { label: "Borrador", tone: "info" },
  out_of_stock: { label: "Agotado", tone: "danger" },
};

export const ORDER_STATUS: Record<string, { label: string; tone: Tone }> = {
  processing: { label: "En proceso", tone: "muted" },
  shipped: { label: "Confirmada", tone: "info" },
  out_for_delivery: { label: "Check-in abierto", tone: "info" },
  delivered: { label: "Volada", tone: "ok" },
  delayed: { label: "Retrasada", tone: "warn" },
  cancelled: { label: "Cancelada", tone: "muted" },
  return_initiated: { label: "Reembolso solicitado", tone: "violet" },
  refunded: { label: "Reembolsada", tone: "ok" },
};

/** Unknown categories sort last. */
export const CATEGORY_ORDER = ["flights", "ancillaries", "card", "insurance", "miles", "financing"];

export const CATEGORY_LABELS: Record<string, string> = {
  flights: "Vuelos",
  ancillaries: "Servicios adicionales",
  card: "Tarjeta Quasar",
  insurance: "Seguros de viaje",
  miles: "Millas",
  financing: "Quasar Pay",
};

/** The singular noun for one product in a category. */
export const CATEGORY_NOUNS: Record<string, string> = {
  flights: "vuelo",
  ancillaries: "servicio",
  card: "tarjeta",
  insurance: "seguro",
  miles: "paquete de millas",
  financing: "producto",
};

export const CATEGORY_ICONS: Record<string, IconName> = {
  flights: "plane",
  ancillaries: "bag",
  card: "tag",
  insurance: "check",
  miles: "spark",
  financing: "chart",
};

/** Fintech products whose portfolio rows (/base) carry active accounts, cancellation, and margin. */
export const PORTFOLIO_CATEGORIES = new Set(["card", "insurance"]);

/** Stock on a flight (per cabin) is seats left. */
export const SEAT_CATEGORIES = new Set(["flights"]);

/** What a portfolio row counts: card accounts or insurance policies. */
export function portfolioNoun(kind: string | null | undefined, count = 2): string {
  if (kind === "insurance") return count === 1 ? "póliza" : "pólizas";
  return count === 1 ? "cuenta" : "cuentas";
}

/**
 * A portfolio row's name. Tiers of one product can share a title ("Tarjeta Quasar Visa"); the
 * id's last segment (QA-CARD-100-GOLD → Gold) then tells them apart.
 */
export function portfolioTitle(row: PlanMixRow, rows: PlanMixRow[]): string {
  const title = row.title ?? row.plan_id ?? "Producto";
  const shared = rows.filter((other) => other.title === row.title).length > 1;
  const suffix = row.plan_id?.split("-").pop();
  if (!shared || !suffix || /^\d+$/.test(suffix)) return title;
  return `${title} ${suffix.charAt(0).toUpperCase()}${suffix.slice(1).toLowerCase()}`;
}
