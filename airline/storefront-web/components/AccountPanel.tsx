// Copyright 2026 Anthropic PBC
// SPDX-License-Identifier: Apache-2.0

"use client";

import type { ReactNode } from "react";
import { AskButton, formatDate, formatNumber, MiniBar, Panel, Pill, Skeleton, type Tone, useStoreFrame } from "web-shared";
import { formatPrice, optionLabel } from "@/lib/format";
import type { AccountContext, CreditAssessment, UpcomingTrip } from "@/lib/types";

export const ASK_APPLY = "Quiero solicitar la tarjeta Quasar";
export const ASK_MILES = "¿Cómo puedo usar mis millas Quasar en mi próximo viaje?";

export const DECISION_LABELS: Record<CreditAssessment["decision"], { label: string; tone: Tone }> = {
  approved: { label: "Aprobada", tone: "ok" },
  review: { label: "En revisión", tone: "warn" },
  declined: { label: "No aprobada", tone: "danger" },
};

/** "Classic y Gold" from ["classic", "gold"]. */
export function tiersLabel(tiers: string[]): string {
  const names = tiers.map(optionLabel);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

/** One line on a decided application: the decision, the tiers it opens, the limit. */
export function decisionSummary(assessment: CreditAssessment): string {
  const parts: string[] = [];
  if (assessment.approved_tiers?.length) parts.push(`Aprobada para ${tiersLabel(assessment.approved_tiers)}`);
  if (assessment.credit_limit_usd != null) parts.push(`cupo ${formatPrice(assessment.credit_limit_usd)}`);
  if (!parts.length) return assessment.decision === "review" ? "Un analista revisará tu solicitud." : "Con esta evaluación no hay una tarjeta disponible.";
  return parts.join(" · ");
}

/** A cardholder's pre-approved move up ("Upgrade a Platinum pre-aprobado"); asks the assistant. */
export function UpgradeOffers({ tiers }: { tiers: string[] | null | undefined }) {
  const { ask } = useStoreFrame();
  if (!tiers?.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {tiers.map((tier) => (
        <button
          key={tier}
          type="button"
          onClick={() => ask(`Quiero pasar a la ${optionLabel(tier)}`)}
          className="inline-flex items-center gap-1.5 rounded-full border border-(--accent)/50 bg-(--accent-soft) px-2.5 py-1 text-[12px] font-semibold text-(--accent-ink) transition hover:border-(--accent)"
        >
          <span aria-hidden>★</span> Upgrade a {optionLabel(tier)} pre-aprobado
        </button>
      ))}
    </div>
  );
}

/** What is booked for the trip, how it was paid, and what the card gives on it. */
export function TripExtras({ trip }: { trip: UpcomingTrip }) {
  const extras = trip.booked_extras ?? [];
  const benefits = trip.card_benefits ?? [];
  if (!extras.length && !trip.paid_with && !benefits.length) return null;
  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {extras.length ? (
        <div className="flex flex-wrap gap-1">
          {extras.map((extra) => (
            <Pill key={extra}>{extra}</Pill>
          ))}
        </div>
      ) : null}
      {trip.paid_with ? <p className="text-[12px] text-(--ink-soft)">Pagado con {trip.paid_with}</p> : null}
      {benefits.length ? (
        <ul className="flex flex-col gap-0.5 text-[12.5px] leading-snug text-(--ink-2)">
          {benefits.map((benefit) => (
            <li key={benefit} className="grid grid-cols-[1rem_1fr]">
              <span aria-hidden className="am-tick">
                ✓
              </span>
              <span>{benefit}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * What a customer without the card is offered: apply, or, once the engine decided, the next
 * step for that decision (choose the approved tier, ask about a review, ask what would help).
 */
export function CardCta({ assessment, roomy = false }: { assessment: CreditAssessment | null; roomy?: boolean }) {
  const { ask } = useStoreFrame();
  let title = "Solicita tu tarjeta Quasar Visa";
  let body = "Acumula millas en cada compra y paga tus vuelos en cuotas sin interés. La respuesta es inmediata.";
  let label = "Solicitar con el asistente";
  let prompt = ASK_APPLY;
  if (assessment?.decision === "approved") {
    const recommended = assessment.recommended_tier ? optionLabel(assessment.recommended_tier) : null;
    title = "Tu tarjeta Quasar Visa está aprobada";
    body = `${decisionSummary(assessment)}. Elige tu categoría y firma en línea.`;
    label = recommended ? `Quiero la ${recommended}` : "Elegir mi tarjeta";
    prompt = recommended ? `Quiero la Tarjeta Quasar Visa ${recommended}` : "Quiero elegir mi tarjeta Quasar Visa";
  } else if (assessment?.decision === "review") {
    title = "Tu solicitud está en revisión";
    body = "Un analista la revisa y te avisamos. Puedes preguntar qué sigue.";
    label = "Preguntar por mi solicitud";
    prompt = "¿Qué sigue con mi solicitud de la tarjeta Quasar?";
  } else if (assessment?.decision === "declined") {
    title = "Tu solicitud no fue aprobada esta vez";
    body = "Pregúntale al asistente qué pesó en la decisión y cuándo puedes volver a intentarlo.";
    label = "Preguntar qué puedo hacer";
    prompt = "¿Por qué no me aprobaron la tarjeta Quasar y qué puedo hacer?";
  }
  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-[10px] border border-dashed border-(--accent)/60 bg-(--accent-soft)/50 ${roomy ? "px-4 py-3" : "px-3 py-2.5"}`}>
      <div className="min-w-0 flex-1">
        <p className={`${roomy ? "text-[15px]" : "text-[13.5px]"} font-semibold text-(--ink)`}>{title}</p>
        <p className={`mt-0.5 ${roomy ? "text-[13px]" : "text-[12.5px]"} leading-snug text-(--ink-2)`}>{body}</p>
      </div>
      <button type="button" onClick={() => ask(prompt)} className={roomy ? "btn-primary" : "btn-primary !px-3 !py-1.5 !text-[11.5px]"}>
        {label}
      </button>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 border-t border-(--line) py-2.5 first:border-t-0">
      <span className="am-meta w-[74px] shrink-0 pt-[3px]">{label}</span>
      <div className="min-w-0 flex-1 text-[13.5px] leading-snug text-(--ink)">{children}</div>
    </div>
  );
}

/** The signed-in customer at a glance: miles, the card (or the way to apply), the application, the next trip. */
export default function AccountPanel({ account: loaded }: { account: { account: AccountContext | null } | null }) {
  const { ask } = useStoreFrame();
  if (!loaded) return <Skeleton className="h-[200px]" />;
  const account = loaded.account;
  if (!account) {
    return (
      <Panel title="Mi cuenta Quasar">
        <p className="px-[18px] pb-3.5 text-[13.5px] leading-snug text-(--ink-soft)">No pudimos leer tu cuenta todavía. Pregúntale al Asistente Quasar por tus millas o tu tarjeta.</p>
      </Panel>
    );
  }
  const { loyalty, card, card_application: application, upcoming_trip: trip } = account;
  const assessment = application?.status === "decided" ? application.assessment : null;
  return (
    <Panel title="Mi cuenta Quasar" action={<AskButton label="Usar mis millas" onClick={() => ask(ASK_MILES)} />}>
      <div className="px-[18px] pb-3">
        <Row label="Millas">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Pill tone={loyalty.tier.toLowerCase() === "gold" ? "warn" : "info"}>{`${loyalty.program} ${loyalty.tier}`}</Pill>
            <span className="am-mono font-semibold">{formatNumber(loyalty.miles_balance)} millas</span>
          </div>
          {loyalty.miles_expiring ? (
            <p className="am-mono mt-1 text-[12px] text-(--warn)">
              {formatNumber(loyalty.miles_expiring.miles)} vencen el {formatDate(loyalty.miles_expiring.on)}
            </p>
          ) : null}
        </Row>
        <Row label="Tarjeta">
          {card ? (
            <>
              <p className="font-semibold">{card.name}</p>
              <div className="mt-1 flex items-center gap-2.5">
                <MiniBar value={card.credit_limit_usd > 0 ? card.available_usd / card.credit_limit_usd : 0} tone="accent" className="w-20" />
                <span className="am-mono text-[12.5px] text-(--ink-2)">
                  {formatPrice(card.available_usd)} disponibles de {formatPrice(card.credit_limit_usd)}
                </span>
              </div>
              <p className="mt-0.5 text-[12px] text-(--ink-soft)">Hasta {card.interest_free_installments} cuotas sin interés en Quasar</p>
              <UpgradeOffers tiers={account.card_upgrade_preapproved} />
            </>
          ) : (
            <CardCta assessment={assessment} />
          )}
        </Row>
        {assessment ? (
          <Row label="Solicitud">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={DECISION_LABELS[assessment.decision]?.tone ?? "muted"} dot>
                {DECISION_LABELS[assessment.decision]?.label ?? assessment.decision}
              </Pill>
              <span className="am-mono text-[12px] text-(--ink-soft)">puntaje {assessment.score}</span>
            </div>
            <p className="mt-1 text-[12.5px] text-(--ink-2)">{decisionSummary(assessment)}</p>
          </Row>
        ) : null}
        {trip ? (
          <Row label="Próximo viaje">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{trip.title}</p>
                <p className="am-mono text-[12px] text-(--ink-soft)">
                  {formatDate(trip.travel_date)} · {trip.order_id}
                </p>
                <TripExtras trip={trip} />
              </div>
              <AskButton label="Preguntar" onClick={() => ask(`¿Qué me falta para mi viaje de la reserva ${trip.order_id}?`)} />
            </div>
          </Row>
        ) : null}
      </div>
    </Panel>
  );
}
