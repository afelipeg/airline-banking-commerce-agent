// Copyright 2026 Anthropic PBC
// SPDX-License-Identifier: Apache-2.0

"use client";

/**
 * The fintech portfolio (`GET /base`): card tiers and insurance plans. The route keeps the telecom
 * plan-mix keys; here `subscribers` are active accounts or policies, `churn_rate_pct` is monthly
 * cancellation, and `arpu`, cost, and margin are monthly per account.
 */

import { useMemo } from "react";
import { AskButton, formatDayMonth, formatMoney, formatNumber, formatRate, KindIcon, MiniBar, Notice, PageHeader, Panel, Pill, Skeleton, Sparkline, useResource } from "web-shared";
import { fetchBase } from "@/lib/api";
import { portfolioNoun, portfolioTitle } from "@/lib/kinds";
import type { BaseOverviewResponse, Cohort, PlanMixRow, PlanWeek } from "@/lib/types";

function series(weeks: PlanWeek[] | undefined, key: "subscribers" | "churn_rate_pct"): number[] {
  return (weeks ?? []).map((week) => week[key]).filter((value): value is number => value != null);
}

/** The row's price: a card tier's annual fee, an insurance plan's premium. */
function priceText(row: PlanMixRow): string | null {
  if (row.price == null) return null;
  return row.kind === "card" ? `${formatMoney(row.price)}/año` : formatMoney(row.price);
}

function PortfolioTable({ data, onAskAssistant }: { data: BaseOverviewResponse; onAskAssistant: (text: string) => void }) {
  // Staged promotion windows keyed by product, so a row can flag a pending campaign.
  const stagedByPlan = useMemo(() => {
    const map = new Map<string, { name?: string | null; starts?: string | null; ends?: string | null }>();
    for (const window of data.staged_windows ?? []) {
      for (const listingId of window.listing_ids) {
        if (!map.has(listingId)) map.set(listingId, window);
      }
    }
    return map;
  }, [data.staged_windows]);

  return (
    <div className="panel-scroll @container overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-left text-[12px] font-semibold text-(--ink-soft)">
            <th className="py-2.5 pl-[18px] pr-3 font-semibold">Producto</th>
            <th className="px-3 py-2.5 text-right font-semibold">Cuentas activas</th>
            <th className="hidden px-3 py-2.5 font-semibold @4xl:table-cell">Participación</th>
            <th className="px-3 py-2.5 text-right font-semibold">Cancelación mensual</th>
            <th className="hidden px-3 py-2.5 text-right font-semibold @3xl:table-cell">Ingreso por cuenta</th>
            <th className="hidden px-3 py-2.5 text-right font-semibold @3xl:table-cell">Costo por cuenta</th>
            <th className="px-3 py-2.5 text-right font-semibold">Margen por cuenta</th>
            <th className="hidden px-3 py-2.5 font-semibold @2xl:table-cell">Cuentas, 13 semanas</th>
            <th className="py-2.5 pl-3 pr-[18px]" aria-label="Acciones" />
          </tr>
        </thead>
        <tbody>
          {data.plans.map((plan: PlanMixRow) => {
            const staged = plan.plan_id ? stagedByPlan.get(plan.plan_id) : undefined;
            const accounts = series(plan.weeks, "subscribers");
            const cancellation = series(plan.weeks, "churn_rate_pct");
            const cancellationRising = cancellation.length > 1 && cancellation[cancellation.length - 1] > cancellation[0];
            const label = portfolioTitle(plan, data.plans);
            return (
              <tr key={plan.plan_id ?? plan.title} className="border-t border-(--line)">
                <td className="py-2.5 pl-[18px] pr-3">
                  <div className="flex items-center gap-3">
                    <KindIcon icon={plan.kind === "insurance" ? "check" : "tag"} tone={plan.kind === "insurance" ? "ok" : "accent"} />
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-medium leading-snug text-(--ink)">{label}</div>
                      <div className="am-mono text-[11.5px] text-(--ink-soft)">{[plan.plan_id, priceText(plan)].filter(Boolean).join(" · ")}</div>
                      {staged ? (
                        <div className="mt-1">
                          <Pill tone="violet" dot>
                            Campaña preparada{staged.starts && staged.ends ? ` · ${formatDayMonth(staged.starts)} – ${formatDayMonth(staged.ends)}` : ""}
                          </Pill>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </td>
                <td className="am-mono px-3 py-2.5 text-right text-[13px] text-(--ink)">
                  {plan.subscribers != null ? formatNumber(plan.subscribers) : "—"}
                  <div className="text-[10.5px] text-(--ink-soft)">{portfolioNoun(plan.kind, plan.subscribers ?? 2)}</div>
                </td>
                <td className="hidden px-3 py-2.5 @4xl:table-cell">
                  {plan.share_pct != null ? (
                    <div className="flex items-center gap-2">
                      <MiniBar value={plan.share_pct / 100} className="w-16" />
                      <span className="am-mono text-[12px] text-(--ink-soft)">{formatRate(plan.share_pct)}</span>
                    </div>
                  ) : (
                    "—"
                  )}
                </td>
                <td className={`am-mono px-3 py-2.5 text-right text-[13px] ${cancellationRising ? "font-semibold text-(--danger)" : "text-(--ink)"}`}>
                  {plan.churn_rate_pct != null ? formatRate(plan.churn_rate_pct) : "—"}
                </td>
                <td className="am-mono hidden px-3 py-2.5 text-right text-[13px] text-(--ink) @3xl:table-cell">{plan.arpu != null ? formatMoney(plan.arpu) : "—"}</td>
                <td className="am-mono hidden px-3 py-2.5 text-right text-[13px] text-(--ink) @3xl:table-cell">
                  {plan.wholesale_cost_per_line_usd != null ? formatMoney(plan.wholesale_cost_per_line_usd) : "—"}
                </td>
                <td className="am-mono px-3 py-2.5 text-right text-[13px] text-(--ink)">{plan.margin_per_line_usd != null ? formatMoney(plan.margin_per_line_usd) : "—"}</td>
                <td className="hidden w-28 px-3 py-2.5 @2xl:table-cell">
                  {accounts.length > 1 ? <Sparkline points={accounts} height={30} label={`${label}, cuentas activas por semana`} /> : "—"}
                </td>
                <td className="py-2.5 pl-3 pr-[18px] text-right">
                  <AskButton
                    label="Preguntar"
                    onClick={() => onAskAssistant(`¿Qué explica la cancelación mensual de ${label} (${plan.plan_id}) y qué acción propones?`)}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CohortsPanel({ cohorts, onAskAssistant }: { cohorts: Cohort[]; onAskAssistant: (text: string) => void }) {
  return (
    <Panel title="Cohortes" subtitle="grupos de clientes a los que apuntan las campañas">
      {cohorts.length === 0 ? (
        <p className="px-[18px] pb-4 text-[13.5px] text-(--ink-soft)">No hay cohortes definidas.</p>
      ) : (
        <ul className="divide-y divide-(--line)">
          {cohorts.map((cohort) => (
            <li key={cohort.cohort_id} className="flex items-center gap-3 px-[18px] py-3">
              <KindIcon icon="user" tone="muted" />
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-medium leading-snug text-(--ink)">{cohort.label}</div>
                {cohort.definition ? <div className="mt-0.5 text-[12px] leading-snug text-(--ink-soft)">{cohort.definition}</div> : null}
                {cohort.plan_ids?.length ? <div className="am-mono mt-1 text-[11.5px] text-(--ink-soft)">{cohort.plan_ids.join(" · ")}</div> : null}
              </div>
              <div className="am-mono w-20 shrink-0 text-right">
                <div className="text-[15px] font-semibold text-(--ink)">{formatNumber(cohort.size)}</div>
                <div className="text-[11.5px] text-(--ink-soft)">clientes</div>
              </div>
              <AskButton label="Preguntar" onClick={() => onAskAssistant(`¿Qué campaña propones para la cohorte "${cohort.label}" (${formatNumber(cohort.size)} clientes)?`)} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export default function PortfolioView({ refreshKey, onAskAssistant }: { refreshKey: number; onAskAssistant: (text: string) => void }) {
  const { data, failed } = useResource(fetchBase, [refreshKey]);

  const rising = (data?.plans ?? []).filter((plan) => {
    const cancellation = series(plan.weeks, "churn_rate_pct");
    return cancellation.length > 1 && cancellation[cancellation.length - 1] > cancellation[0];
  }).length;

  return (
    <div className="ac-reveal @container flex flex-col gap-4">
      <PageHeader
        title="Portafolio fintech"
        subtitle={
          data
            ? `${formatNumber(data.total_subscribers)} cuentas y pólizas activas en ${data.plans.length} productos (tarjetas y seguros)${
                rising ? ` · cancelación al alza en ${rising}` : ""
              }`
            : "Tarjetas Quasar Visa y seguros de viaje"
        }
      >
        <AskButton label="Preguntar por el portafolio" onClick={() => onAskAssistant("Muéstrame el portafolio fintech: ¿qué producto deja menos margen por cuenta y qué harías?")} />
      </PageHeader>
      {failed && !data ? (
        <Notice>La API de Quasar no responde, así que el portafolio no se puede cargar.</Notice>
      ) : !data ? (
        <>
          <Skeleton className="h-64" />
          <Skeleton className="h-48" />
        </>
      ) : (
        <>
          <Panel title="Tarjetas y seguros" subtitle="cancelación en rojo donde subió en las últimas 13 semanas">
            <PortfolioTable data={data} onAskAssistant={onAskAssistant} />
            {data.wholesale?.note ? <p className="border-t border-(--line) px-[18px] py-3 text-[12.5px] leading-snug text-(--ink-soft)">{data.wholesale.note}</p> : null}
          </Panel>
          <CohortsPanel cohorts={data.cohorts ?? []} onAskAssistant={onAskAssistant} />
        </>
      )}
    </div>
  );
}
