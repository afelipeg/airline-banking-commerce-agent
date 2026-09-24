// Copyright 2026 Anthropic PBC
// SPDX-License-Identifier: Apache-2.0

import { ChangeChip, formatMoney, formatNumber, formatPeriodLabel, formatRate, GenCard, GenCardHeader, Sparkline, titleCase } from "web-shared";
import type { MetricEntry, MetricsPayload } from "@/lib/types";

/** The metrics the merchant agent can query, in Spanish. */
const METRIC_LABELS: Record<string, string> = {
  sales: "Ventas",
  orders: "Reservas",
  traffic: "Búsquedas",
  conversion: "Conversión",
  conversion_rate: "Conversión",
  aov: "Ticket promedio",
  average_order_value: "Ticket promedio",
  revenue: "Ingresos",
  ticket_revenue: "Ingreso por tiquetes",
  ancillary_revenue: "Ingreso ancillary",
  fintech_revenue: "Ingreso fintech",
  passengers: "Pasajeros",
  load_factor: "Load factor",
  attach_rate: "Attach rate",
  ancillary_per_passenger: "Ancillary por pasajero",
  card_applications: "Solicitudes de tarjeta",
  card_approvals: "Aprobaciones de tarjeta",
  approval_rate: "Tasa de aprobación",
  active_cards: "Tarjetas activas",
  miles_sold: "Millas vendidas",
  spend: "Inversión",
};

const CURRENCY_METRICS = new Set([
  "sales",
  "revenue",
  "aov",
  "average_order_value",
  "ticket_revenue",
  "ancillary_revenue",
  "fintech_revenue",
  "ancillary_per_passenger",
  "spend",
]);

const RATE_METRICS = new Set(["conversion", "conversion_rate", "load_factor", "attach_rate", "approval_rate", "click_through_rate"]);

function metricLabel(metric: string): string {
  return METRIC_LABELS[metric] ?? titleCase(metric);
}

function metricValue(entry: MetricEntry): string | null {
  if (entry.value == null) return null;
  if (CURRENCY_METRICS.has(entry.metric)) return formatMoney(entry.value, entry.currency ?? "USD", { whole: entry.value >= 1000 });
  if (RATE_METRICS.has(entry.metric)) return formatRate(entry.value);
  return formatNumber(entry.value);
}

export default function MetricsCard({ payload }: { payload: MetricsPayload }) {
  const metrics = payload.metrics ?? [];
  return (
    <GenCard>
      <GenCardHeader title={payload.title ?? "Desempeño"} aside={payload.period ? formatPeriodLabel(payload.period) : null} />
      <div className="mt-2 grid grid-cols-2 border-t border-(--line) [&>*:nth-child(even)]:border-l [&>*:nth-child(n+3)]:border-t [&>*]:border-(--line)">
        {metrics.map((entry, index) => {
          const value = metricValue(entry);
          const points = entry.series?.points?.map((point) => point.value);
          return (
            <div key={`${entry.metric}-${index}`} className="px-3.5 py-3">
              <div className="text-[12px] font-medium text-(--ink-soft)">{metricLabel(entry.metric)}</div>
              <div className="mt-1 flex items-baseline gap-2">
                {value != null ? <span className="am-mono text-[19px] font-semibold leading-none text-(--ink)">{value}</span> : null}
                <ChangeChip changePct={entry.change_pct} />
              </div>
              {points && points.length > 1 ? <Sparkline points={points} height={34} label={`Tendencia de ${metricLabel(entry.metric).toLowerCase()}`} className="mt-2" /> : null}
              {entry.note ? <div className="mt-1.5 text-[11.5px] leading-snug text-(--ink-soft)">{entry.note}</div> : null}
            </div>
          );
        })}
      </div>
    </GenCard>
  );
}
