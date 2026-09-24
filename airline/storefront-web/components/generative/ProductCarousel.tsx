// Copyright 2026 Anthropic PBC
// SPDX-License-Identifier: Apache-2.0

"use client";

/** Renders present_products: flights, ancillaries, the card, miles, insurance, Quasar Pay. */

import { useRef, useState } from "react";
import { AskButton, formatWeekday, hasOptions, useStoreFrame } from "web-shared";
import {
  chosenLabel,
  formatPriceWithUnit,
  isCardProduct,
  isDirectAddable,
  isFinancing,
  isFlight,
  optionsLabel,
  plateGlyph,
  plateTint,
} from "@/lib/format";
import { useOverflow } from "@/lib/overflow";
import type { Product, ProductsPayload } from "@/lib/types";
import { Frame, Rating } from "./shared";

/** What the assistant is asked to help choose, by option name. */
const OPTION_NOUNS: Record<string, string> = {
  cabin: "la cabina",
  seat_type: "el tipo de asiento",
  tier: "la categoría",
  pack: "el paquete",
  plan: "el plan",
  installments: "las cuotas",
};

function stopsLabel(stops: string | undefined): string {
  if (stops == null || stops === "") return "";
  const count = Number(stops);
  if (!Number.isFinite(count)) return stops;
  return count === 0 ? "Directo" : `${count} escala${count === 1 ? "" : "s"}`;
}

/** A flight leads with its date and times; anything else with its options. */
function specChips(product: Product): string[] {
  const attrs = product.attributes ?? {};
  const chosen = chosenLabel(product) || optionsLabel(product);
  if (isFlight(product)) {
    const chips = [
      attrs.travel_date ? formatWeekday(attrs.travel_date) : "",
      attrs.departure_time ? (attrs.arrival_time ? `${attrs.departure_time}–${attrs.arrival_time}` : attrs.departure_time) : "",
      [attrs.duration, stopsLabel(attrs.stops)].filter(Boolean).join(" · "),
      chosen,
    ];
    return chips.filter(Boolean).slice(0, 4);
  }
  return chosen ? [chosen] : [];
}

function seatsLeft(product: Product): number | null {
  const raw = product.attributes?.seats_left;
  if (raw == null || raw === "") return null;
  const count = Number(raw);
  return Number.isFinite(count) ? count : null;
}

/**
 * An onAdd that resolves `false` means the server rejected the write. A family (a flight's
 * cabins, seat types, packs) is not added from the card: the button hands the choice to the assistant.
 */
function AddButton({
  product,
  onAdd,
}: {
  product: Product;
  onAdd: (product: Product) => boolean | void | Promise<boolean | void>;
}) {
  const [phase, setPhase] = useState<"idle" | "busy" | "done" | "error">("idle");
  const { ask } = useStoreFrame();
  if (hasOptions(product)) {
    const option = Object.keys(product.options ?? {})[0] ?? "";
    const noun = OPTION_NOUNS[option] ?? "la opción";
    return (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          ask(`Quiero agregar ${product.title} (${product.product_id}) a mi compra. Ayúdame a elegir ${noun}.`);
        }}
        aria-label={`Elegir opciones de ${product.title}`}
        className="absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-(--ink) text-lg font-semibold leading-none text-(--surface) shadow-sm transition-all hover:scale-105"
      >
        +
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={async (event) => {
        event.stopPropagation();
        if (phase !== "idle") return;
        setPhase("busy");
        const added = (await onAdd(product)) !== false;
        setPhase(added ? "done" : "error");
        window.setTimeout(() => setPhase("idle"), added ? 1200 : 1600);
      }}
      aria-label={`Agregar ${product.title} a tu compra`}
      title={phase === "error" ? "No se pudo agregar" : undefined}
      className={`absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-full text-lg font-semibold leading-none text-(--surface) shadow-sm transition-all hover:scale-105 ${
        phase === "done" ? "bg-(--accent)" : phase === "error" ? "bg-(--warn)" : "bg-(--ink)"
      } ${phase === "busy" ? "animate-pulse" : ""}`}
    >
      {phase === "done" ? "✓" : phase === "error" ? "!" : "+"}
    </button>
  );
}

/** The card and Quasar Pay are applied for with the assistant, never added from a tile. */
function askPrompt(product: Product): string | null {
  if (isCardProduct(product)) return `Cuéntame de la ${product.title} y si puedo solicitarla.`;
  if (isFinancing(product)) return `¿Cómo funciona ${product.title} para pagar mi viaje en cuotas?`;
  return null;
}

function SkeletonCard() {
  return (
    <div className="am-card-sm flex w-[210px] shrink-0 flex-col overflow-hidden">
      <div className="am-shimmer h-[110px] rounded-none" />
      <div className="flex flex-col gap-2 p-3">
        <div className="am-shimmer h-4 w-3/4" />
        <div className="am-shimmer h-3 w-2/5" />
        <div className="flex gap-1">
          <div className="am-shimmer h-5 w-16" />
          <div className="am-shimmer h-5 w-20" />
        </div>
      </div>
    </div>
  );
}

export default function ProductCarousel({
  payload,
  onAdd,
  partial,
}: {
  payload: ProductsPayload;
  onAdd?: (product: Product) => boolean | void | Promise<boolean | void>;
  partial?: boolean;
}) {
  const { ask } = useStoreFrame();
  const items = payload.items ?? [];
  const scrollerRef = useRef<HTMLDivElement>(null);
  const { overflow, sync: syncOverflow } = useOverflow(scrollerRef, `${items.length}-${partial}`);
  const nudge = (direction: 1 | -1) => {
    const node = scrollerRef.current;
    node?.scrollBy({ left: direction * (node.clientWidth - 80), behavior: "smooth" });
  };
  return (
    <Frame component="products" label={payload.title ?? "Del catálogo"} flush>
      <div className="relative">
        <div ref={scrollerRef} onScroll={syncOverflow} className="panel-scroll flex gap-3 overflow-x-auto p-4">
          {items.map(({ product, reason }, index) => {
            const seats = seatsLeft(product);
            const prompt = askPrompt(product);
            return (
              <article
                key={product.product_id}
                className="am-card-sm am-sharpen am-reveal-item flex w-[210px] shrink-0 flex-col overflow-hidden"
                style={{ animationDelay: `${index * 60}ms` }}
              >
                <div className="am-plate relative h-[110px]">
                  <div className="absolute inset-0" style={{ background: plateTint(product) }} aria-hidden />
                  <span className="am-plate-glyph" style={{ fontSize: isFlight(product) ? 30 : 36 }}>
                    {plateGlyph(product)}
                  </span>
                  <span className="am-plate-id">{product.product_id}</span>
                  {product.labels?.[0] ? <span className="am-tag am-tag--ink absolute right-2 top-2">{product.labels[0]}</span> : null}
                  {product.in_stock === false ? (
                    <span className="am-tag am-tag--warn absolute left-2 top-2">Agotado</span>
                  ) : seats != null && seats <= 9 ? (
                    <span className="am-tag am-tag--warn absolute left-2 top-2">
                      {seats === 1 ? "Queda 1 silla" : `Quedan ${seats} sillas`}
                    </span>
                  ) : null}
                  {onAdd && isDirectAddable(product) && product.in_stock !== false ? <AddButton product={product} onAdd={onAdd} /> : null}
                </div>
                <div className="flex flex-1 flex-col gap-1.5 p-3">
                  <h3 className="text-[15px] font-bold leading-tight text-(--ink)">{product.title}</h3>
                  <p className="am-mono text-[13.5px] font-semibold leading-tight text-(--ink)">
                    {hasOptions(product) ? <span className="text-[11px] font-normal text-(--ink-soft)">desde </span> : null}
                    {formatPriceWithUnit(product)}
                  </p>
                  <Rating rating={product.rating} count={product.review_count} />
                  <div className="flex flex-wrap gap-1">
                    {specChips(product).map((chip) => (
                      <span key={chip} className="am-tag normal-case tracking-normal">
                        {chip}
                      </span>
                    ))}
                  </div>
                  {reason ? (
                    <p className="pt-1 text-[13px] leading-snug text-(--ink-soft)">{reason}</p>
                  ) : product.short_description && !isFlight(product) ? (
                    <p className="line-clamp-3 pt-1 text-[12.5px] leading-snug text-(--ink-soft)">{product.short_description}</p>
                  ) : null}
                  {prompt ? (
                    <div className="mt-auto pt-2">
                      <AskButton label="Preguntar al asistente" onClick={() => ask(prompt)} />
                    </div>
                  ) : null}
                </div>
              </article>
            );
          })}
          {partial ? <SkeletonCard /> : null}
        </div>
        {overflow.left ? (
          <>
            <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-(--surface) to-transparent" />
            <button
              type="button"
              onClick={() => nudge(-1)}
              aria-label="Ver los anteriores"
              className="am-mono absolute left-1 top-1/2 -translate-y-1/2 rounded-(--radius) border border-(--line) bg-(--surface) px-2 py-1 text-sm text-(--ink) shadow-md transition hover:border-(--accent)"
            >
              ‹
            </button>
          </>
        ) : null}
        {overflow.right ? (
          <>
            <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-(--surface) to-transparent" />
            <button
              type="button"
              onClick={() => nudge(1)}
              aria-label="Ver más"
              className="am-mono absolute right-1 top-1/2 -translate-y-1/2 rounded-(--radius) border border-(--line) bg-(--surface) px-2 py-1 text-sm text-(--ink) shadow-md transition hover:border-(--accent)"
            >
              ›
            </button>
          </>
        ) : null}
      </div>
    </Frame>
  );
}
