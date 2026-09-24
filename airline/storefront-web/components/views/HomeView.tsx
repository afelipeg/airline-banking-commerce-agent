// Copyright 2026 Anthropic PBC
// SPDX-License-Identifier: Apache-2.0

"use client";

import { formatDate, formatNumber, Greeting, type Starter, Starters } from "web-shared";
import { formatPrice } from "@/lib/format";
import type { AccountContext } from "@/lib/types";
import AccountPanel, { ASK_APPLY } from "../AccountPanel";

const STARTERS_WITH_CARD: Starter[] = [
  { icon: "plane", prompt: "Busca un vuelo de Bogotá a Miami para el 16 de octubre" },
  { icon: "tag", prompt: "¿Cuántas cuotas sin interés tengo con mi tarjeta para un viaje?" },
  { icon: "bag", prompt: "¿Qué incluye la tarifa económica y cuánto cuesta una maleta extra?" },
  { icon: "spark", prompt: "¿Me conviene subir a la Quasar Visa Platinum?" },
];

const STARTERS_NO_CARD: Starter[] = [
  { icon: "plane", prompt: "Busca un vuelo de Bogotá a Madrid para el 22 de octubre" },
  { icon: "spark", prompt: ASK_APPLY },
  { icon: "tag", prompt: "Compara las tarjetas Quasar Visa Classic, Gold y Platinum" },
  { icon: "bag", prompt: "¿Qué seguro de viaje me recomiendas?" },
];

function firstName(name: string): string {
  return name.split(/[\s·]+/)[0] || name;
}

/** One sentence on where the account stands: miles about to expire, the card, or the way to get one. */
function Brief({ account }: { account: AccountContext }) {
  const { loyalty, card } = account;
  const expiring = loyalty.miles_expiring;
  return (
    <>
      {expiring ? (
        <span className="font-semibold text-(--warn)">
          {formatNumber(expiring.miles)} de tus {formatNumber(loyalty.miles_balance)} millas vencen el {formatDate(expiring.on)}.{" "}
        </span>
      ) : (
        <>Tienes {formatNumber(loyalty.miles_balance)} millas Quasar. </>
      )}
      {card
        ? `Con tu ${card.name} tienes ${formatPrice(card.available_usd)} de cupo y hasta ${card.interest_free_installments} cuotas sin interés.`
        : "Aún no tienes la tarjeta Quasar Visa: pídele al asistente que te ayude a solicitarla en minutos."}
    </>
  );
}

export default function HomeView({ shopperName, account }: { shopperName: string; account: { account: AccountContext | null } | null }) {
  const current = account?.account ?? null;
  const starters = current && !current.card ? STARTERS_NO_CARD : STARTERS_WITH_CARD;
  return (
    <div className="flex flex-col gap-4">
      <Greeting
        eyebrow={
          current ? (
            <span className="am-fig">
              <b>●</b> {`${current.loyalty.program} ${current.loyalty.tier}`}
              {current.card ? ` · ${current.card.name}` : " · sin tarjeta"}
            </span>
          ) : null
        }
        title={
          <h1 className="am-hero">
            ¿A dónde vamos, <strong>{firstName(shopperName)}</strong>?
          </h1>
        }
      >
        {current ? <Brief account={current} /> : null}
      </Greeting>
      <Starters items={starters} />
      <AccountPanel account={account} />
    </div>
  );
}
