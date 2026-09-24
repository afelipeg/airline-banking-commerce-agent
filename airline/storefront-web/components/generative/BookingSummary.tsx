// Copyright 2026 Anthropic PBC
// SPDX-License-Identifier: Apache-2.0

"use client";

/** Renders checkout as a booking summary with a boarding-pass stub. */

import { safeHandoffs, useCatalogIndex } from "web-shared";
import PlanTile from "@/components/PlanTile";
import { fetchProducts } from "@/lib/api";
import { chosenLabel, formatPrice, priceSuffix, priceUnitOf, splitCart } from "@/lib/format";
import { useCountUp } from "@/lib/motion";
import type { CheckoutPayload } from "@/lib/types";
import { Frame } from "./shared";

/** The stamp lands after the code assembly and count-up finish. */
const QR_ASSEMBLY_MS = 500;
const COUNT_MS = 400;

/** Decorative; scans nothing. */
function QrPlate({ seed }: { seed: string }) {
  let value = 7;
  for (let i = 0; i < seed.length; i++) value = (value * 31 + seed.charCodeAt(i)) >>> 0;
  const cells: { on: boolean; delayMs: number }[] = [];
  for (let i = 0; i < 81; i++) {
    value = (value * 1103515245 + 12345) >>> 0;
    cells.push({
      on: ((value >> 16) & 3) !== 0 ? (value & 1) === 1 : true,
      // Unsigned shift; a signed one can go negative and yield negative delays.
      delayMs: ((value >>> 8) % 81) * (QR_ASSEMBLY_MS / 81),
    });
  }
  return (
    <div
      className="grid aspect-square w-[88px] gap-[2px] border border-(--line) bg-(--surface) p-[6px]"
      style={{ gridTemplateColumns: "repeat(9, 1fr)" }}
      aria-hidden
    >
      {cells.map((cell, index) =>
        cell.on ? (
          <span key={index} className="am-dot bg-(--ink)" style={{ animationDelay: `${cell.delayMs}ms` }} />
        ) : (
          <span key={index} className="bg-transparent" />
        ),
      )}
    </div>
  );
}

function CountUpPrice({ value, suffix }: { value: number; suffix?: string }) {
  const animated = useCountUp(value, COUNT_MS);
  return (
    <p className="am-mono text-[24px] font-semibold leading-tight tracking-tight text-(--ink)">
      {formatPrice(Math.round(animated * 100) / 100)}
      {suffix ? <span className="text-[12px] text-(--ink-soft)">{suffix}</span> : null}
    </p>
  );
}

export default function BookingSummary({ payload }: { payload: CheckoutPayload }) {
  const handoffs = safeHandoffs(payload.handoffs);
  const catalog = useCatalogIndex(fetchProducts);
  const items = payload.cart?.items ?? [];
  const { today, annual } = splitCart(items, catalog);

  return (
    <Frame component="checkout" label="Resumen de tu compra para confirmar" flush>
      <div data-checkout-card className="flex flex-col sm:flex-row">
        <div className="flex-1 p-4 sm:p-5">
          <div className="flex items-baseline justify-between">
            <h3 className="text-[16px] font-extrabold uppercase tracking-[0.04em] text-(--ink)">Tu compra</h3>
            <span className="am-stamp am-mono text-[11px] text-(--ink-soft)" style={{ animationDelay: `${QR_ASSEMBLY_MS + COUNT_MS - 200}ms` }}>
              SIN COBRO AÚN
            </span>
          </div>

          <div className="am-rule-bold mt-3">
            {items.map((item) => {
              const chosen = chosenLabel(item);
              const note = [item.product_id, chosen, item.quantity > 1 ? `× ${item.quantity}` : ""].filter(Boolean).join(" · ");
              return (
                <div key={item.product_id} className="am-rule py-2 first:border-t-0">
                  <PlanTile
                    product={{ product_id: item.product_id, title: item.title, price: item.price, option_values: item.option_values }}
                    note={note}
                    trailing={
                      <span className="am-mono shrink-0 text-[14px] font-semibold text-(--ink)">
                        {formatPrice(item.line_total)}
                        {priceUnitOf(item.product_id, catalog) === "per_year" ? (
                          <span className="text-[11px] font-normal text-(--ink-soft)">{priceSuffix("per_year")}</span>
                        ) : null}
                      </span>
                    }
                  />
                </div>
              );
            })}
          </div>

          <div className="am-rule-heavy mt-2 grid grid-cols-2 gap-3 pt-3">
            <div>
              <p className="am-meta">A pagar hoy</p>
              <CountUpPrice value={today} />
            </div>
            {annual > 0 ? (
              <div>
                <p className="am-meta">Cuota de manejo</p>
                <CountUpPrice value={annual} suffix="/año" />
              </div>
            ) : null}
          </div>

          {payload.note ? <p className="mt-3 text-[13px] leading-snug text-(--ink-soft)">{payload.note}</p> : null}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-4 border-t-2 border-dashed border-(--line) bg-(--well)/60 p-4 sm:w-[180px] sm:flex-col sm:items-start sm:justify-center sm:border-l-2 sm:border-t-0 sm:p-5">
          <div>
            <p className="am-meta">Pase de abordar</p>
            <p className="mt-0.5 text-[11.5px] leading-snug text-(--ink-soft)">Se emite al finalizar la compra, junto con tu tiquete electrónico.</p>
          </div>
          <QrPlate seed={items.map((i) => i.product_id).join("|") || "quasar-airlines"} />
        </div>
      </div>

      {handoffs.length ? (
        // The backend named where payment happens.
        <div className="flex flex-col gap-2 border-t border-(--line) px-4 py-3">
          {handoffs.map((h) => (
            <a
              key={h.url}
              href={h.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-describedby="qa-checkout-note"
              className="w-full rounded-(--radius) bg-(--ink) py-2.5 text-center text-[14px] font-semibold text-(--surface)"
            >
              {h.label ?? (h.seller ? `Continuar el pago con ${h.seller}` : "Continuar al pago")}
            </a>
          ))}
        </div>
      ) : null}

      <p id="qa-checkout-note" className="border-t border-(--line) px-4 py-2 text-center text-[11px] font-medium text-(--ink-soft)">
        Aquí no se cobra nada. El pago ocurre cuando finalizas la compra.
      </p>
    </Frame>
  );
}
