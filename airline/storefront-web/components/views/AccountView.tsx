// Copyright 2026 Anthropic PBC
// SPDX-License-Identifier: Apache-2.0

"use client";

import { ArrivingPanel, AskButton, Fact, Facts, formatDate, formatNumber, KindIcon, Notice, type Order, ORDER_NOUNS, PageHeader, Panel, Pill, Skeleton, StorePage, useStoreFrame } from "web-shared";
import { formatPrice, optionLabel } from "@/lib/format";
import type { AccountContext } from "@/lib/types";
import { ASK_MILES, CardCta, DECISION_LABELS, decisionSummary, TripExtras, UpgradeOffers } from "../AccountPanel";

const NOUNS = { ...ORDER_NOUNS, cardTitle: "Tus reservas" };

function MilesPanel({ account }: { account: AccountContext }) {
  const { ask } = useStoreFrame();
  const { loyalty } = account;
  return (
    <Panel title={loyalty.program} icon={<KindIcon icon="plane" tone="accent" size={30} />} action={<AskButton label="Usar mis millas" onClick={() => ask(ASK_MILES)} />} bodyClassName="px-[18px] pb-4">
      <Facts>
        <Fact label="Categoría" value={loyalty.tier} />
        <Fact label="Millas" value={formatNumber(loyalty.miles_balance)} />
        <Fact label="Por vencer" value={loyalty.miles_expiring ? formatNumber(loyalty.miles_expiring.miles) : "—"} tone={loyalty.miles_expiring ? "warn" : undefined} />
        <Fact label="Vencen el" value={loyalty.miles_expiring ? formatDate(loyalty.miles_expiring.on) : "—"} />
      </Facts>
    </Panel>
  );
}

function CardPanel({ account }: { account: AccountContext }) {
  const { ask } = useStoreFrame();
  const { card } = account;
  if (!card) {
    const assessment = account.card_application?.status === "decided" ? account.card_application.assessment : null;
    return (
      <Panel title="Tarjeta Quasar Visa" icon={<KindIcon icon="tag" tone="muted" size={30} />} bodyClassName="px-[18px] pb-4">
        <CardCta assessment={assessment} roomy />
      </Panel>
    );
  }
  return (
    <Panel
      title={card.name}
      icon={<KindIcon icon="tag" tone="accent" size={30} />}
      action={<AskButton label="Preguntar por mi tarjeta" onClick={() => ask("¿Qué beneficios tengo con mi tarjeta Quasar y cómo pago mi viaje en cuotas?")} />}
      bodyClassName="px-[18px] pb-4"
    >
      <Facts>
        <Fact label="Categoría" value={optionLabel(card.tier)} />
        <Fact label="Cupo total" value={formatPrice(card.credit_limit_usd)} />
        <Fact label="Cupo disponible" value={formatPrice(card.available_usd)} />
        <Fact label="Cuotas sin interés" value={`Hasta ${card.interest_free_installments}`} />
      </Facts>
      <UpgradeOffers tiers={account.card_upgrade_preapproved} />
    </Panel>
  );
}

function TripPanel({ account }: { account: AccountContext }) {
  const { ask } = useStoreFrame();
  const trip = account.upcoming_trip;
  if (!trip) return null;
  return (
    <Panel
      title="Tu próximo viaje"
      icon={<KindIcon icon="calendar" tone="info" size={30} />}
      action={<AskButton label="¿Qué me falta?" onClick={() => ask(`¿Qué me falta para mi viaje de la reserva ${trip.order_id}?`)} />}
      bodyClassName="px-[18px] pb-4"
    >
      <p className="text-[15px] font-semibold text-(--ink)">{trip.title}</p>
      <p className="am-mono text-[12.5px] text-(--ink-soft)">
        {formatDate(trip.travel_date)} · {trip.order_id}
      </p>
      <TripExtras trip={trip} />
    </Panel>
  );
}

function ApplicationPanel({ account }: { account: AccountContext }) {
  const assessment = account.card_application?.status === "decided" ? account.card_application.assessment : null;
  if (!assessment) return null;
  const decision = DECISION_LABELS[assessment.decision];
  return (
    <Panel title="Tu solicitud de tarjeta" icon={<KindIcon icon="edit" tone="violet" size={30} />} bodyClassName="px-[18px] pb-4">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={decision?.tone ?? "muted"} dot>
          {decision?.label ?? assessment.decision}
        </Pill>
        <span className="am-mono text-[12.5px] text-(--ink-soft)">
          puntaje {assessment.score} · {assessment.score_band}
        </span>
      </div>
      <p className="mt-1.5 text-[13.5px] text-(--ink)">{decisionSummary(assessment)}</p>
      {assessment.reasons?.length ? (
        <ul className="mt-2 flex flex-col gap-1 text-[13px] leading-snug text-(--ink-2)">
          {assessment.reasons.slice(0, 4).map((reason, index) => (
            <li key={`${reason.code}-${index}`} className="grid grid-cols-[1.1rem_1fr]">
              <span aria-hidden className={`am-mono font-bold ${reason.effect === "positive" ? "text-(--ok)" : "text-(--danger)"}`}>
                {reason.effect === "positive" ? "+" : "−"}
              </span>
              <span>{reason.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="am-mono mt-2 text-[10.5px] uppercase tracking-[0.08em] text-(--ink-soft)">Evaluación automática por reglas ({assessment.engine})</p>
    </Panel>
  );
}

/** The account as Quasar has it: miles, the card, the application, and the bookings. */
export default function AccountView({
  shopperName,
  account,
  failed,
  orders,
}: {
  shopperName: string;
  account: { account: AccountContext | null } | null;
  failed: boolean;
  orders: Order[] | null;
}) {
  const current = account?.account ?? null;
  return (
    <StorePage>
      <PageHeader title="Mi cuenta Quasar" subtitle={current ? `La cuenta de ${shopperName}: millas, tarjeta y reservas. Pregúntale al asistente por cualquiera.` : undefined} />
      {!account ? (
        failed ? <Notice>No pudimos cargar tu cuenta.</Notice> : <Skeleton className="h-[320px]" />
      ) : current ? (
        <>
          <TripPanel account={current} />
          <MilesPanel account={current} />
          <CardPanel account={current} />
          <ApplicationPanel account={current} />
        </>
      ) : (
        <Notice>No pudimos leer tu cuenta todavía. Pregúntale al Asistente Quasar por tus millas o tu tarjeta.</Notice>
      )}
      {orders?.length ? <ArrivingPanel orders={orders} nouns={NOUNS} thumb={() => <KindIcon icon="plane" size={40} />} /> : null}
    </StorePage>
  );
}
