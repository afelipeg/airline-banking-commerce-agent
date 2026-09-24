// Copyright 2026 Anthropic PBC
// SPDX-License-Identifier: Apache-2.0

import { formatMoney, formatNumber, formatRate, GenCard, GenCardHeader, KindIcon, Sparkline } from "web-shared";
import { portfolioNoun, portfolioTitle } from "@/lib/kinds";
import type { PlanMixPayload, PlanMixRow } from "@/lib/types";

/**
 * Renders present_portfolio_mix (component `plan_mix`): card tiers and insurance plans. The keys
 * are telecom's plan mix; subscribers are active accounts or policies, churn is monthly cancellation,
 * and revenue, cost, and margin are monthly per account. Every field is optional.
 */

function Stat({ label, value }: { label: string; value: string | null }) {
  if (value == null) return null;
  return (
    <span className="whitespace-nowrap">
      <span className="text-(--ink-soft)">{label} </span>
      <span className="am-mono font-semibold text-(--ink)">{value}</span>
    </span>
  );
}

function PortfolioRow({ plan, rows }: { plan: PlanMixRow; rows: PlanMixRow[] }) {
  const points = (plan.weeks ?? []).map((week) => week.subscribers).filter((value): value is number => value != null);
  const label = portfolioTitle(plan, rows);
  const price = plan.price != null ? (plan.kind === "card" ? `${formatMoney(plan.price)}/año` : formatMoney(plan.price)) : null;
  return (
    <li className="px-3.5 py-2.5">
      <div className="flex items-center gap-3">
        <KindIcon icon={plan.kind === "insurance" ? "check" : "tag"} tone={plan.kind === "insurance" ? "ok" : "accent"} size={30} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-(--ink)">{label}</div>
          <div className="am-mono text-[11.5px] text-(--ink-soft)">{[plan.plan_id, price].filter(Boolean).join(" · ")}</div>
        </div>
        {plan.subscribers != null ? (
          <div className="shrink-0 text-right">
            <div className="am-mono text-[15px] font-semibold leading-none text-(--ink)">{formatNumber(plan.subscribers)}</div>
            <div className="mt-0.5 text-[11px] text-(--ink-soft)">
              {portfolioNoun(plan.kind, plan.subscribers)} {plan.subscribers === 1 ? "activa" : "activas"}{plan.share_pct != null ? ` · ${formatRate(plan.share_pct)}` : ""}
            </div>
          </div>
        ) : null}
      </div>
      {plan.share_pct != null ? (
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-(--well)">
          <div className="h-full rounded-full bg-(--ink)/70" style={{ width: `${Math.max(0, Math.min(100, plan.share_pct))}%` }} />
        </div>
      ) : null}
      <div className="mt-2 flex items-end justify-between gap-3">
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
          <Stat label="Cancelación mensual" value={plan.churn_rate_pct != null ? formatRate(plan.churn_rate_pct) : null} />
          <Stat label="Ingreso por cuenta" value={plan.arpu != null ? formatMoney(plan.arpu) : null} />
          <Stat label="Costo por cuenta" value={plan.wholesale_cost_per_line_usd != null ? formatMoney(plan.wholesale_cost_per_line_usd) : null} />
          <Stat label="Margen por cuenta" value={plan.margin_per_line_usd != null ? formatMoney(plan.margin_per_line_usd) : null} />
        </div>
        {points.length > 1 ? <Sparkline points={points} height={28} label={`${label}, cuentas activas por semana`} className="w-28 shrink-0" /> : null}
      </div>
      {plan.note ? <p className="mt-1.5 text-[12px] leading-snug text-(--ink-soft)">{plan.note}</p> : null}
    </li>
  );
}

export default function PlanMixCard({ payload }: { payload: PlanMixPayload }) {
  const plans = payload.plans ?? [];
  return (
    <GenCard>
      <GenCardHeader
        title={payload.title ?? "Portafolio fintech"}
        aside={payload.total_subscribers != null ? `${formatNumber(payload.total_subscribers)} cuentas y pólizas activas` : null}
      />
      {plans.length ? (
        <ul className="mt-2 divide-y divide-(--line) border-t border-(--line)">
          {plans.map((plan, index) => (
            <PortfolioRow key={plan.plan_id ?? index} plan={plan} rows={plans} />
          ))}
        </ul>
      ) : (
        <p className="px-3.5 pb-3.5 pt-2 text-[13px] text-(--ink-soft)">No llegaron filas del portafolio.</p>
      )}
      {payload.grain === "week" && plans.some((plan) => (plan.weeks ?? []).length >= 2) ? (
        <p className="border-t border-(--line) px-3.5 py-2 text-[11.5px] text-(--ink-soft)">Las líneas de tendencia son cuentas activas por semana en el periodo del reporte.</p>
      ) : null}
    </GenCard>
  );
}
