// Copyright 2026 Anthropic PBC
// SPDX-License-Identifier: Apache-2.0

import { CHANGE_STATUS, DigestList, DigestRow, formatMoney, formatNumber, GenCard, GenCardHeader, type IconName, plural, type Tone } from "web-shared";
import { INVENTORY_KINDS, PORTFOLIO_CATEGORIES, SEAT_CATEGORIES } from "@/lib/kinds";
import type { DigestEntry, DigestPayload } from "@/lib/types";

const KINDS: Record<DigestEntry["kind"], { icon: IconName; tone: Tone }> = {
  low_stock: INVENTORY_KINDS.low_stock,
  slow_mover: INVENTORY_KINDS.slow_mover,
  order_issue: { icon: "inbox", tone: "danger" },
  metric: { icon: "chart", tone: "ok" },
  pending_change: { icon: "edit", tone: "violet" },
  note: { icon: "message", tone: "muted" },
};

/** Pending changes get no chip; approval stays on the change card. */
function triagePrompt(item: DigestEntry): { label: string; prompt: string } | null {
  const ref = item.listing ? `${item.listing.title} (${item.listing.listing_id})` : item.ref_id;
  switch (item.kind) {
    case "low_stock":
      return ref ? { label: "Revisar tarifa", prompt: `${ref} va casi llena. ¿Subimos la tarifa o abrimos otra cabina?` } : null;
    case "slow_mover":
      return ref ? { label: "Proponer acción", prompt: `${ref} no se va a llenar a este ritmo. ¿Qué propones?` } : null;
    case "order_issue":
      return {
        label: "Redactar respuesta",
        prompt: item.ref_id ? `Ayúdame a resolver la reserva ${item.ref_id}: ${item.headline}` : `Ayúdame a resolver esta novedad: ${item.headline}`,
      };
    case "metric":
      return { label: "Preguntar por qué", prompt: `¿Qué explica esto: ${item.headline}?` };
    default:
      return null;
  }
}

function context(item: DigestEntry) {
  if (item.listing) {
    const category = item.listing.category ?? "";
    // Flight cabins count seats; a listing with no category is a cabin too (alerts are about seats).
    const seats = SEAT_CATEGORIES.has(category) || !category;
    const unit = seats ? (item.listing.stock === 1 ? "silla" : "sillas") : PORTFOLIO_CATEGORIES.has(category) ? "activas" : "disponibles";
    return (
      <span className="am-mono">
        {item.listing.listing_id} · {formatNumber(item.listing.stock)} {unit} · {formatMoney(item.listing.price)}
        {category === "card" ? "/año" : ""}
      </span>
    );
  }
  if (item.change) {
    return (
      <span className="am-mono">
        {item.change.change_id} · {CHANGE_STATUS[item.change.status].label.toLowerCase()}
      </span>
    );
  }
  return null;
}

export default function DigestCard({ payload, onPrefill }: { payload: DigestPayload; onPrefill?: (text: string) => void }) {
  const items = payload.items ?? [];
  return (
    <GenCard>
      <GenCardHeader title={payload.title ?? "Necesita tu atención"} aside={plural(items.length, "elemento")} />
      <DigestList>
        {items.map((item, index) => {
          const triage = onPrefill ? triagePrompt(item) : null;
          const style = KINDS[item.kind] ?? KINDS.note;
          const soldOut = item.kind === "low_stock" && item.listing?.stock === 0;
          return (
            <DigestRow
              key={`${item.ref_id ?? item.headline}-${index}`}
              icon={style.icon}
              tone={soldOut ? "danger" : style.tone}
              headline={item.headline}
              why={item.why_it_matters}
              context={context(item)}
              action={triage ? { label: triage.label, onClick: () => onPrefill?.(triage.prompt) } : null}
            />
          );
        })}
      </DigestList>
    </GenCard>
  );
}
