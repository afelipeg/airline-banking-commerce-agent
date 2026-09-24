// Copyright 2026 Anthropic PBC
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useMemo, useState } from "react";
import {
  ApprovalsBanner,
  askWhy,
  AttentionList,
  AttentionRow,
  coverLabel,
  formatChangePct,
  formatComparisonLabel,
  formatDate,
  formatDayMonth,
  formatMoney,
  formatNumber,
  formatPeriodLabel,
  formatRate,
  greeting,
  Notice,
  PageHeader,
  Panel,
  plural,
  QueueOverflow,
  ratioChangePct,
  RecentChanges,
  RecordList,
  Segmented,
  Skeleton,
  StatStrip,
  StatTile,
  ViewLink,
} from "web-shared";
import { INVENTORY_KINDS, ISSUE_KINDS, ORDER_STATUS } from "@/lib/kinds";
import type { InventoryAlert, OrderIssue, OverviewResponse, TodaySnapshot } from "@/lib/types";

type Filter = "all" | "orders" | "stock" | "slow";
type Row = { kind: "issue"; issue: OrderIssue } | { kind: "inventory"; alert: InventoryAlert };

const ROW_CAP = 6;

/** One sentence from the overview: the revenue move and what needs the operator. */
function briefing(data: OverviewResponse): string {
  const { snapshot, needs_attention } = data;
  const parts: string[] = [];
  if (snapshot.sales_change_pct != null) {
    const direction = snapshot.sales_change_pct >= 0 ? "suben" : "bajan";
    parts.push(`Los ingresos ${direction} ${formatChangePct(Math.abs(snapshot.sales_change_pct)).replace("+", "")} en la semana.`);
  }
  const bookings = needs_attention.order_issues.length;
  const cabins = needs_attention.inventory.length;
  const needs = [bookings ? plural(bookings, "reserva") : "", cabins ? plural(cabins, "cabina") : ""].filter(Boolean);
  parts.push(needs.length ? `${needs.join(" y ")} necesitan tu atención hoy.` : "Nada necesita tu atención hoy.");
  return parts.join(" ");
}

function attentionRows(data: OverviewResponse, filter: Filter): Row[] {
  const { inventory, order_issues } = data.needs_attention;
  const issues = order_issues.map((issue) => ({ kind: "issue" as const, issue }));
  const lowStock = inventory
    .filter((alert) => alert.kind === "low_stock")
    .sort((a, b) => (a.days_of_cover ?? Infinity) - (b.days_of_cover ?? Infinity))
    .map((alert) => ({ kind: "inventory" as const, alert }));
  const slow = inventory.filter((alert) => alert.kind === "slow_mover").map((alert) => ({ kind: "inventory" as const, alert }));
  if (filter === "orders") return issues;
  if (filter === "stock") return lowStock;
  if (filter === "slow") return slow;
  // The most urgent cabin leads, ahead of the booking queue.
  return [...lowStock.slice(0, 1), ...issues, ...lowStock.slice(1), ...slow];
}

function IssueRow({ issue, onAskAssistant }: { issue: OrderIssue; onAskAssistant: (text: string) => void }) {
  const style = ISSUE_KINDS[issue.kind] ?? ISSUE_KINDS.buyer_message;
  return (
    <AttentionRow
      icon={style.icon}
      tone={style.tone}
      title={issue.summary}
      meta={[style.label, `Reserva ${issue.order_id}`, issue.opened_at ? `abierta el ${formatDayMonth(issue.opened_at)}` : ""].filter(Boolean).join(" · ")}
      action={{
        label: issue.kind === "buyer_message" ? "Redactar respuesta" : "Preguntar",
        onClick: () => onAskAssistant(`¿Qué opciones tengo con la reserva ${issue.order_id}? ${issue.summary}.`),
      }}
    />
  );
}

/** Inventory alerts are flight cabins: stock is seats left. */
function InventoryRow({ alert, onAskAssistant }: { alert: InventoryAlert; onAskAssistant: (text: string) => void }) {
  const style = INVENTORY_KINDS[alert.kind];
  const low = alert.kind === "low_stock";
  const ref = `${alert.title} (${alert.listing_id})`;
  return (
    <AttentionRow
      icon={style.icon}
      tone={alert.stock === 0 ? "danger" : style.tone}
      title={alert.title}
      meta={
        <>
          <span className={low ? "font-semibold text-(--warn)" : ""}>
            {alert.stock === 1 ? "1 silla disponible" : `${formatNumber(alert.stock)} sillas disponibles`}
          </span>
          {[
            "",
            alert.days_of_cover != null ? coverLabel(alert.days_of_cover) : "",
            alert.sales_last_30d != null ? `${formatNumber(alert.sales_last_30d)} vendidas en 30 días` : "",
            alert.listing_id,
          ]
            .filter((part, index) => index === 0 || part)
            .join(" · ")}
        </>
      }
      action={
        low
          ? { label: "Revisar tarifa", onClick: () => onAskAssistant(`${ref} va casi llena. ¿Subimos la tarifa o abrimos otra cabina?`) }
          : { label: "Proponer acción", onClick: () => onAskAssistant(`${ref} no se va a llenar a este ritmo. ¿Qué propones?`) }
      }
    />
  );
}

/** Yesterday's operation; the link opens the fintech portfolio. */
function Yesterday({ today, onNavigate, onAskAssistant }: { today: TodaySnapshot; onNavigate: () => void; onAskAssistant: (text: string) => void }) {
  const money = (value: number) => formatMoney(value, "USD", { whole: value >= 1000 });
  const tiles: { label: string; value: string }[] = [
    { label: "Reservas", value: formatNumber(today.bookings) },
    { label: "Pasajeros", value: formatNumber(today.passengers) },
    { label: "Load factor", value: formatRate(today.load_factor_pct) },
    { label: "Ingreso ancillary", value: money(today.ancillary_revenue) },
    { label: "Aprobaciones de tarjeta", value: formatNumber(today.card_approvals) },
  ];
  const fintech = today.fintech_revenue;
  return (
    <Panel title="Ayer en la operación" subtitle={formatDate(today.date)} action={<ViewLink label="Ver portafolio fintech" onClick={onNavigate} />}>
      <div className="grid grid-cols-2 border-t border-(--line) sm:grid-cols-3 [&>*]:border-(--line) max-sm:[&>*:nth-child(even)]:border-l max-sm:[&>*:nth-child(n+3)]:border-t sm:[&>*:not(:nth-child(3n+1))]:border-l sm:[&>*:nth-child(n+4)]:border-t">
        {tiles.map((tile) => (
          <div key={tile.label} className="px-[18px] py-3">
            <div className="text-[12.5px] font-medium text-(--ink-soft)">{tile.label}</div>
            <div className="am-mono mt-1 text-[22px] font-semibold leading-none text-(--ink)">{tile.value}</div>
          </div>
        ))}
        {/* The overview's day block may not carry fintech revenue; the tile then asks the assistant. */}
        <button
          type="button"
          onClick={() => onAskAssistant("¿Cuánto ingreso fintech (tarjeta, seguros, Quasar Pay) generamos ayer y cómo va la semana?")}
          className="group px-[18px] py-3 text-left transition-colors hover:bg-(--ground)/60"
        >
          <div className="text-[12.5px] font-medium text-(--ink-soft)">Ingreso fintech</div>
          {fintech != null ? (
            <div className="am-mono mt-1 text-[22px] font-semibold leading-none text-(--ink)">{money(fintech)}</div>
          ) : (
            <div className="mt-1.5 text-[13px] font-semibold text-(--accent-ink) group-hover:underline">Preguntar al asistente →</div>
          )}
        </button>
      </div>
    </Panel>
  );
}

export default function HomeView({
  data,
  failed,
  operator,
  onAskAssistant,
  onNavigate,
}: {
  data: OverviewResponse | null;
  failed: boolean;
  operator?: string;
  /** Prefills the composer; nothing is sent. */
  onAskAssistant: (text: string) => void;
  onNavigate: (view: "plans" | "base") => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const pending = useMemo(
    () => (data?.needs_attention.pending_changes ?? []).filter((change) => change.status === "staged"),
    [data],
  );
  const rows = useMemo(() => (data ? attentionRows(data, filter) : []), [data, filter]);
  const now = useMemo(() => new Date(), []);
  const title = `${greeting(now)}${operator ? `, ${operator}` : ""}`;
  const today = now.toLocaleDateString("es-CO", { weekday: "long", month: "long", day: "numeric" });

  if (failed && !data) {
    return (
      <>
        <PageHeader title={title} subtitle={today} />
        <Notice>
          La API de Quasar en el puerto 8000 no responde. Iníciala con{" "}
          <code className="am-mono rounded bg-(--well) px-1 text-[13px]">.venv/bin/uvicorn airline.api.main:app --app-dir . --port 8000</code> y recarga.
        </Notice>
      </>
    );
  }
  if (!data) {
    return (
      <>
        <PageHeader title={title} subtitle={today} />
        <Skeleton className="h-36" />
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
          <Skeleton className="h-96" />
          <Skeleton className="h-72" />
        </div>
      </>
    );
  }

  const { snapshot } = data;
  const counts = {
    orders: data.needs_attention.order_issues.length,
    stock: data.needs_attention.inventory.filter((alert) => alert.kind === "low_stock").length,
    slow: data.needs_attention.inventory.filter((alert) => alert.kind === "slow_mover").length,
  };
  // The snapshot carries no average-ticket delta, so derive it from the revenue and bookings deltas.
  const aovChangePct = ratioChangePct(snapshot.sales_change_pct, snapshot.orders_change_pct);
  const comparison = formatComparisonLabel(snapshot.period, snapshot.compare_to);
  const currency = snapshot.currency ?? "USD";

  return (
    <div className="ac-reveal flex flex-col gap-5">
      <PageHeader title={title} subtitle={`${today} · ${briefing(data)}`} />

      <ApprovalsBanner changes={pending} onReview={() => onAskAssistant("Muéstrame los cambios que esperan mi aprobación y qué haría cada uno.")} />

      <Panel title="Esta semana" subtitle={`${formatPeriodLabel(snapshot.period)}${comparison ? ` · vs. ${comparison}` : ""}`} bodyClassName="pb-1">
        <StatStrip>
          <StatTile
            label="Ingresos"
            value={formatMoney(snapshot.sales, currency, { whole: snapshot.sales >= 1000 })}
            changePct={snapshot.sales_change_pct}
            onClick={() => onAskAssistant(askWhy("Ingresos", snapshot.sales_change_pct, comparison))}
            ariaLabel="Ingresos: pregúntale al asistente por qué"
          />
          <StatTile
            label="Reservas"
            value={formatNumber(snapshot.orders)}
            changePct={snapshot.orders_change_pct}
            onClick={() => onAskAssistant(askWhy("Reservas", snapshot.orders_change_pct, comparison))}
            ariaLabel="Reservas: pregúntale al asistente por qué"
          />
          <StatTile
            label="Conversión de búsquedas"
            value={snapshot.conversion_rate != null ? formatRate(snapshot.conversion_rate) : "—"}
            changePct={snapshot.conversion_change_pct}
            onClick={() => onAskAssistant(askWhy("Conversión", snapshot.conversion_change_pct, comparison))}
            ariaLabel="Conversión: pregúntale al asistente por qué"
          />
          <StatTile
            label="Ticket promedio"
            value={snapshot.average_order_value != null ? formatMoney(snapshot.average_order_value, currency) : "—"}
            changePct={aovChangePct}
            onClick={() => onAskAssistant(askWhy("Ticket promedio", aovChangePct, comparison))}
            ariaLabel="Ticket promedio: pregúntale al asistente por qué"
          />
        </StatStrip>
      </Panel>

      {data.today ? <Yesterday today={data.today} onNavigate={() => onNavigate("base")} onAskAssistant={onAskAssistant} /> : null}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Panel
          title="Necesita tu atención"
          action={
            <Segmented<Filter>
              label="Filtrar pendientes"
              value={filter}
              onChange={setFilter}
              options={[
                { id: "all", label: "Todo", count: counts.orders + counts.stock + counts.slow },
                { id: "orders", label: "Reservas", count: counts.orders },
                { id: "stock", label: "Casi llenos", count: counts.stock },
                { id: "slow", label: "Venta lenta", count: counts.slow },
              ]}
            />
          }
        >
          {rows.length === 0 ? (
            <p className="px-[18px] pb-4 pt-1 text-[13.5px] text-(--ink-soft)">Nada está esperando por ti.</p>
          ) : (
            <>
              <AttentionList>
                {rows.slice(0, ROW_CAP).map((row) =>
                  row.kind === "issue" ? (
                    <IssueRow key={row.issue.issue_id} issue={row.issue} onAskAssistant={onAskAssistant} />
                  ) : (
                    <InventoryRow key={`${row.alert.kind}-${row.alert.listing_id}`} alert={row.alert} onAskAssistant={onAskAssistant} />
                  ),
                )}
              </AttentionList>
              <QueueOverflow hidden={rows.length - ROW_CAP} />
            </>
          )}
        </Panel>

        <div className="flex flex-col gap-4">
          <Panel title="Reservas recientes" action={<ViewLink label="Catálogo" onClick={() => onNavigate("plans")} />}>
            {data.recent_orders.length === 0 ? (
              <p className="px-[18px] pb-4 text-[13px] text-(--ink-soft)">Aún no hay reservas.</p>
            ) : (
              <RecordList
                mono
                rows={data.recent_orders.slice(0, 5).map((order) => ({
                  id: order.order_id,
                  detail: plural(order.items, "ítem"),
                  sub: `${formatDayMonth(order.placed_at)} · ${formatMoney(order.total)}`,
                  status: ORDER_STATUS[order.status] ?? { label: order.status.replaceAll("_", " "), tone: "muted" },
                }))}
              />
            )}
          </Panel>
          <RecentChanges changes={data.recent_changes} />
        </div>
      </div>
    </div>
  );
}
