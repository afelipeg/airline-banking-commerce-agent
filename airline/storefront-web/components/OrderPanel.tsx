// Copyright 2026 Anthropic PBC
// SPDX-License-Identifier: Apache-2.0

"use client";

import { AskLink, BagPanel, CheckoutButton, plural, RemoveLink, Stepper, TotalRow, useCatalogIndex, useStoreFrame } from "web-shared";
import { fetchProducts } from "@/lib/api";
import { chosenLabel, formatPrice, isCardProduct, isFinancing, isFlight, priceSuffix, priceUnitOf, splitCart } from "@/lib/format";
import type { CartItem, CartPayload, Product } from "@/lib/types";
import PlanTile from "./PlanTile";

function asProduct(item: CartItem): Product {
  return { product_id: item.product_id, title: item.title, price: item.price, option_values: item.option_values };
}

/** "el vuelo QA-0412 (Económica)": what a message to the assistant calls a line. */
function lineName(item: CartItem): string {
  const chosen = chosenLabel(item);
  return chosen ? `${item.title} (${chosen})` : item.title;
}

/** The card and Quasar Pay are one each; flights count passengers, the rest units. */
function isCountable(item: CartItem): boolean {
  const product = { product_id: item.variant_of ?? item.product_id };
  return !isCardProduct(product) && !isFinancing(product);
}

/** The bag beside the conversation: what is paid today, and the card's annual fee when one is staged. */
export default function OrderPanel({ cart }: { cart: CartPayload | null }) {
  const { ask } = useStoreFrame();
  const items = cart?.items ?? [];
  const count = cart?.item_count ?? 0;
  const catalog = useCatalogIndex(fetchProducts);
  const { today, annual } = splitCart(items, catalog);

  return (
    <BagPanel
      title="Tu compra"
      count={plural(count, "ítem")}
      isEmpty={items.length === 0}
      empty={
        <>
          Tu compra está vacía.
          <br />
          Pídele al Asistente Quasar un vuelo, una maleta o tu tarjeta Quasar Visa.
        </>
      }
      footer={
        <>
          <TotalRow label="A pagar hoy" value={formatPrice(today)} note={items.length ? "No se cobra nada hasta que finalices la compra." : undefined} />
          {annual > 0 ? (
            <p className="am-mono mt-2 border-t border-(--line) pt-2 text-[12px] font-semibold text-(--ink)">
              Cuota de manejo de la tarjeta {formatPrice(annual)}/año{" "}
              <span className="font-normal text-(--ink-soft)">(se cobra al activarla)</span>
            </p>
          ) : null}
          <CheckoutButton staged={false} disabled={items.length === 0} prompt="Quiero finalizar mi compra." />
          {items.length ? (
            <div className="mt-2.5 flex justify-center">
              <AskLink label="Revisar esta compra" prompt="Revisa mi compra: ¿me falta algo antes de pagar (maletas, asiento, seguro)?" />
            </div>
          ) : null}
        </>
      }
    >
      <ul>
        {items.map((item, index) => {
          const annualLine = priceUnitOf(item.product_id, catalog) === "per_year";
          const flight = isFlight({ product_id: item.variant_of ?? item.product_id });
          const chosen = chosenLabel(item);
          const unitPrice = `${formatPrice(item.price)}${annualLine ? priceSuffix("per_year") : ""}`;
          return (
            <li key={item.product_id} className={`py-3 ${index > 0 ? "border-t border-(--line)" : "pt-0"}`}>
              <PlanTile
                product={asProduct(item)}
                note={`${chosen ? `${chosen} · ` : ""}${unitPrice} × ${item.quantity}${flight ? (item.quantity === 1 ? " pasajero" : " pasajeros") : ""}`}
                trailing={
                  <span className="am-mono shrink-0 text-[14px] font-semibold text-(--ink)">
                    {formatPrice(item.line_total)}
                    {annualLine ? <span className="text-[11px] text-(--ink-soft)">/año</span> : null}
                  </span>
                }
              />
              <div className="mt-1.5 flex items-center gap-2 pl-[68px]">
                {isCountable(item) ? (
                  <Stepper
                    quantity={item.quantity}
                    unit={flight ? "pasajero" : undefined}
                    itemTitle={lineName(item)}
                    onChange={(quantity) =>
                      ask(
                        quantity < 1
                          ? `Quita ${lineName(item)} de mi compra.`
                          : flight
                            ? `Cambia ${lineName(item)} a ${quantity} ${quantity === 1 ? "pasajero" : "pasajeros"}.`
                            : `Cambia la cantidad de ${lineName(item)} a ${quantity}.`,
                      )
                    }
                  />
                ) : null}
                <RemoveLink itemTitle={lineName(item)} onClick={() => ask(`Quita ${lineName(item)} de mi compra.`)} />
              </div>
            </li>
          );
        })}
      </ul>
    </BagPanel>
  );
}
