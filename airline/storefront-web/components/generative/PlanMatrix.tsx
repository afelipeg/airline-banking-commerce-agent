// Copyright 2026 Anthropic PBC
// SPDX-License-Identifier: Apache-2.0

"use client";

/**
 * Renders present_plan_comparison: the cabins of a flight, the card tiers, insurance plans.
 * Cell values arrive formatted from the server, the price row included.
 */

import { useRef } from "react";
import { chosenLabel, formatPriceWithUnit } from "@/lib/format";
import { useOverflow } from "@/lib/overflow";
import type { PlanMatrixPayload } from "@/lib/types";
import { Frame } from "./shared";

/** The preference tag renders only when best_for is written in preference terms. */
const PREFERENCE_FLAVOR = /(prefieres|preferencia|guardad[oa]|mencionaste|me dijiste|\bprefers?\b|\bpreference\b|\bsaved\b)/i;

const PRICE_ROW = "price";

function MatrixSkeleton() {
  return (
    <div aria-label="Armando la comparación" className="p-4">
      <div className="flex gap-3">
        <div className="w-[110px] shrink-0" />
        {[0, 1, 2].map((column) => (
          <div key={column} className="flex flex-1 flex-col gap-2">
            <div className="am-shimmer h-4 w-3/4" />
            <div className="am-shimmer h-6 w-1/2" />
          </div>
        ))}
      </div>
      {[0, 1, 2, 3, 4].map((row) => (
        <div key={row} className="mt-3 border-t border-(--line) pt-3">
          <div className="am-shimmer h-3.5 w-full" style={{ animationDelay: `${row * 90}ms` }} />
        </div>
      ))}
    </div>
  );
}

function Cell({ value }: { value: string }) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "—" || normalized === "-" || normalized === "no incluido" || normalized === "no") {
    return <span className="text-(--ink-soft)/60">{value}</span>;
  }
  if (normalized === "incluido" || normalized === "sí" || normalized === "si" || normalized === "ilimitado") {
    return (
      <span>
        <span className="am-tick">✓</span> {value}
      </span>
    );
  }
  return <>{value}</>;
}

/** "$89 por pasajero": the amount large, the unit small underneath. */
function PriceLine({ text, qualifier }: { text: string; qualifier?: string }) {
  const match = /^(\S+)\s+(.+)$/.exec(text.trim());
  // A qualifier that already states the unit ("por pasajero, solo ida…") replaces it.
  const unit = match && !(qualifier && qualifier.toLowerCase().startsWith(match[2].toLowerCase())) ? match[2] : null;
  return (
    <p className="am-mono mt-1.5 leading-tight text-(--ink)">
      <span className="text-[19px] font-semibold tracking-tight">{match ? match[1] : text}</span>
      {unit ? <span className="block text-[11px] font-normal text-(--ink-soft)">{unit}</span> : null}
    </p>
  );
}

export default function PlanMatrix({ payload }: { payload: PlanMatrixPayload }) {
  const { plans, rows, annotations, recommended_plan_id: recommended, current_product_id: current } = payload;
  const bestFor = (planId: string) => annotations?.find((a) => a.plan_id === planId)?.best_for;
  // Variants of one family can share a title ("Tarjeta Quasar Visa"); their option tells them apart.
  const titleCounts = new Map<string, number>();
  for (const plan of plans) titleCounts.set(plan.title, (titleCounts.get(plan.title) ?? 0) + 1);
  const columnTitle = (plan: (typeof plans)[number]) => {
    const chosen = chosenLabel(plan);
    return (titleCounts.get(plan.title) ?? 0) > 1 && chosen ? `${plan.title} ${chosen}` : plan.title;
  };

  const scrollerRef = useRef<HTMLDivElement>(null);
  const { overflow, sync: syncOverflow } = useOverflow(scrollerRef, plans.length);
  const nudge = (direction: 1 | -1) => {
    const node = scrollerRef.current;
    node?.scrollBy({ left: direction * 160, behavior: "smooth" });
  };

  // The price row renders in the header; the others are the body.
  const priceRow = (rows ?? []).find((row) => row.key === PRICE_ROW);
  const bodyRows = (rows ?? []).filter((row) => row.key !== PRICE_ROW);
  const title = payload.title ?? "Comparación";

  if (plans.length === 0) {
    return (
      <Frame component="plan_matrix" label={title} flush>
        <MatrixSkeleton />
      </Frame>
    );
  }

  return (
    <Frame component="plan_matrix" label={title} flush>
      <div className="relative">
        <div ref={scrollerRef} onScroll={syncOverflow} className="panel-scroll overflow-x-auto">
          <table className="w-full border-collapse text-left" style={{ minWidth: plans.length * 160 + 130 }}>
            <thead>
              <tr className="align-bottom">
                <th className="sticky left-0 z-10 w-[130px] min-w-[130px] bg-(--surface) p-3 pb-4" aria-label="dimensión" />
                {plans.map((plan, columnIndex) => {
                  const isRec = plan.product_id === recommended;
                  const isCurrent = current != null && plan.product_id === current;
                  const annotationText = bestFor(plan.product_id) ?? "";
                  const matchesPreference = isRec && PREFERENCE_FLAVOR.test(annotationText);
                  const price = priceRow?.values[columnIndex] ?? formatPriceWithUnit(plan);
                  return (
                    <th key={plan.product_id} className={`relative p-3 pb-4 font-normal ${isRec ? "bg-(--accent-soft)/40" : ""}`}>
                      <div className="flex flex-wrap gap-1">
                        {isRec ? <span className="am-tag am-tag--accent">✓ Recomendada</span> : null}
                        {isCurrent ? <span className="am-tag am-tag--ink">Tu tarjeta actual</span> : null}
                      </div>
                      <p className={`${isRec || isCurrent ? "mt-2" : "mt-7"} text-[15px] font-bold leading-tight text-(--ink)`}>{columnTitle(plan)}</p>
                      <PriceLine text={price} qualifier={plan.attributes?.price_qualifier} />
                      {plan.attributes?.price_qualifier ? (
                        <p className="am-mono mt-1 text-[11px] leading-snug text-(--ink-soft)">{plan.attributes.price_qualifier}</p>
                      ) : null}
                      {annotationText ? <p className="mt-1.5 text-[11.5px] font-medium leading-snug text-(--ink-soft)">{annotationText}</p> : null}
                      {matchesPreference ? (
                        <span className="am-tag mt-1.5">
                          <b aria-hidden className="text-(--accent)">
                            ●
                          </b>{" "}
                          coincide con una preferencia guardada
                        </span>
                      ) : null}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((row, rowIndex) => (
                <tr key={row.key} className="am-reveal-item border-t border-(--line)" style={{ animationDelay: `${rowIndex * 60}ms` }}>
                  <th className="am-meta sticky left-0 z-10 w-[130px] min-w-[130px] bg-(--surface) p-3 align-top font-semibold">{row.label}</th>
                  {row.values.map((value, columnIndex) => {
                    const isRec = plans[columnIndex]?.product_id === recommended;
                    return (
                      <td
                        key={columnIndex}
                        className={`am-mono p-3 align-top text-[13px] text-(--ink) ${isRec ? "bg-(--accent-soft)/40 font-semibold" : ""}`}
                      >
                        <Cell value={value} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {overflow.left ? (
          <>
            <div aria-hidden className="pointer-events-none absolute inset-y-0 left-[130px] w-8 bg-gradient-to-r from-(--surface) to-transparent" />
            <button
              onClick={() => nudge(-1)}
              aria-label="Ver las opciones anteriores"
              className="am-mono absolute left-[134px] top-10 rounded-(--radius) border border-(--line) bg-(--surface) px-2 py-1 text-sm text-(--ink) shadow-md transition hover:border-(--accent)"
            >
              ‹
            </button>
          </>
        ) : null}
        {overflow.right ? (
          <>
            <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-(--surface) to-transparent" />
            <button
              onClick={() => nudge(1)}
              aria-label="Ver más opciones"
              className="am-mono absolute right-1 top-10 rounded-(--radius) border border-(--line) bg-(--surface) px-2 py-1 text-sm text-(--ink) shadow-md transition hover:border-(--accent)"
            >
              ›
            </button>
          </>
        ) : null}
      </div>
    </Frame>
  );
}
