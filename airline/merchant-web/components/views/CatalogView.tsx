// Copyright 2026 Anthropic PBC
// SPDX-License-Identifier: Apache-2.0

"use client";

/**
 * The catalog: flights (cabins as variants, stock = seats left), ancillaries, and the fintech
 * products, whose rows borrow active accounts, cancellation, and margin from the portfolio read.
 */

import { useMemo, useState } from "react";
import {
  AskButton,
  Button,
  Fact,
  Facts,
  formatDate,
  formatDayMonth,
  formatMoney,
  formatNumber,
  formatRate,
  hasOptions,
  KindIcon,
  Notice,
  optionSummary,
  optionValuesLabel,
  PageHeader,
  Panel,
  Pill,
  PriceBand,
  priceLabel,
  QuotedAsData,
  SearchField,
  SectionTitle,
  Segmented,
  Sheet,
  Skeleton,
  titleCase,
  useResource,
} from "web-shared";
import { fetchBase, fetchListingDetail, fetchListings } from "@/lib/api";
import { CATEGORY_ICONS, CATEGORY_LABELS, CATEGORY_NOUNS, CATEGORY_ORDER, LISTING_STATUS, PORTFOLIO_CATEGORIES, SEAT_CATEGORIES } from "@/lib/kinds";
import type { Listing, PlanMixRow } from "@/lib/types";

/** Pricing on these is regulated and set outside the portal. */
const REGULATED = new Set(["card", "insurance", "financing"]);

const DEMAND: Record<string, string> = { rising: "al alza", steady: "estable", falling: "a la baja" };

const OPTION_LABELS: Record<string, string> = { economy: "Económica", premium: "Premium", business: "Business", classic: "Classic", gold: "Gold", platinum: "Platinum" };

function optionText(listing: { option_values?: Record<string, string> }): string {
  return Object.values(listing.option_values ?? {})
    .map((value) => OPTION_LABELS[value] ?? value)
    .join(" · ");
}

function StatusPill({ status }: { status: Listing["status"] }) {
  const style = LISTING_STATUS[status] ?? { label: status, tone: "muted" as const };
  return (
    <Pill tone={style.tone} dot>
      {style.label}
    </Pill>
  );
}

function ContentCell({ quality }: { quality: Listing["content_quality"] }) {
  if (quality === "poor") return <Pill tone="danger">Ficha pobre</Pill>;
  if (quality === "needs_work") return <Pill tone="warn">Por mejorar</Pill>;
  return <span className="text-[12.5px] text-(--ink-soft)">Bien</span>;
}

function CategoryIcon({ category }: { category: string }) {
  return <KindIcon icon={CATEGORY_ICONS[category] ?? "tag"} tone="muted" size={36} />;
}

function Rows({ rows }: { rows: [string, string | null][] }) {
  const shown = rows.filter(([, value]) => value != null && value !== "");
  if (!shown.length) return null;
  return (
    <div className="divide-y divide-(--line) rounded-[12px] border border-(--line)">
      {shown.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-3 px-3 py-1.5 text-[13px]">
          <span className="text-(--ink-soft)">{label}</span>
          <span className="am-mono text-right text-(--ink)">{value}</span>
        </div>
      ))}
    </div>
  );
}

/** "BOG→MDE · 12 oct · 06:10" for a flight; empty otherwise. */
function flightLine(listing: Listing): string {
  const attrs = listing.attributes ?? {};
  if (!attrs.origin || !attrs.destination) return "";
  return [`${attrs.origin}→${attrs.destination}`, attrs.travel_date ? formatDayMonth(attrs.travel_date) : "", attrs.departure_time ?? ""].filter(Boolean).join(" · ");
}

function priceHeader(category: string, family: boolean): string {
  if (SEAT_CATEGORIES.has(category)) return family ? "Tarifa desde" : "Tarifa";
  if (category === "card") return "Cuota anual";
  return family ? "Precio desde" : "Precio";
}

function stockHeader(category: string): string {
  if (SEAT_CATEGORIES.has(category)) return "Sillas";
  if (PORTFOLIO_CATEGORIES.has(category)) return category === "insurance" ? "Pólizas activas" : "Cuentas activas";
  return "Disponibles";
}

/**
 * A listing's portfolio row: its own, or, for a family (the card with its tiers), the tiers'
 * rows combined, weighted by active accounts.
 */
function portfolioRow(listingId: string, rows: Map<string, PlanMixRow> | null): PlanMixRow | null {
  if (!rows) return null;
  const own = rows.get(listingId);
  if (own) return own;
  const members = [...rows.values()].filter((row) => row.plan_id?.startsWith(`${listingId}-`));
  if (!members.length) return null;
  const accounts = members.reduce((sum, row) => sum + (row.subscribers ?? 0), 0);
  const weighted = (key: "churn_rate_pct" | "arpu" | "margin_per_line_usd") => {
    const usable = members.filter((row) => row[key] != null && row.subscribers != null);
    const weight = usable.reduce((sum, row) => sum + (row.subscribers ?? 0), 0);
    return weight > 0 ? usable.reduce((sum, row) => sum + (row[key] as number) * (row.subscribers ?? 0), 0) / weight : null;
  };
  return { plan_id: listingId, subscribers: accounts, churn_rate_pct: weighted("churn_rate_pct"), arpu: weighted("arpu"), margin_per_line_usd: weighted("margin_per_line_usd") };
}

function ProductSheet({
  listingId,
  category,
  baseRows,
  onClose,
  onAskAssistant,
}: {
  listingId: string;
  category: string;
  baseRows: Map<string, PlanMixRow> | null;
  onClose: () => void;
  onAskAssistant: (text: string) => void;
}) {
  const { data: detail, failed } = useResource(() => fetchListingDetail(listingId), [listingId]);
  const listing = detail?.listing;
  const pricing = detail?.pricing;
  const kind = listing?.category ?? category;
  const isPortfolio = PORTFOLIO_CATEGORIES.has(kind) || pricing?.active_subscribers != null;
  const isFlight = SEAT_CATEGORIES.has(kind);
  const base = portfolioRow(listingId, baseRows);
  const noun = CATEGORY_NOUNS[kind] ?? "producto";
  const ref = listing ? `${listing.title} (${listing.listing_id})` : listingId;
  const ask = (text: string) => {
    onClose();
    onAskAssistant(text);
  };
  const question = isPortfolio
    ? `¿Cómo va ${ref} en cuentas activas, cancelación y margen, y qué cambiarías?`
    : isFlight
      ? `¿Cómo va la ocupación de ${ref} por cabina y está bien la tarifa?`
      : `¿Cómo se está vendiendo ${ref} y hay que ajustar el precio o la ficha?`;
  const accounts = pricing?.active_subscribers ?? base?.subscribers ?? null;

  return (
    <Sheet
      title={CATEGORY_LABELS[kind] ?? titleCase(kind)}
      detail={listingId}
      onClose={onClose}
      closeLabel={`Cerrar el detalle del ${noun}`}
      footer={
        listing ? (
          <Button variant="primary" icon="spark" className="flex-1" onClick={() => ask(question)}>
            Preguntar por este {noun}
          </Button>
        ) : null
      }
    >
      {failed && !listing ? (
        <p className="text-[13.5px] text-(--ink-soft)">No pudimos cargar este {noun}.</p>
      ) : !listing ? (
        <>
          <Skeleton className="h-24" />
          <Skeleton className="h-40" />
        </>
      ) : (
        <>
          <div className="flex gap-3.5">
            <CategoryIcon category={kind} />
            <div className="min-w-0">
              <h2 className="text-[17px] font-semibold leading-tight tracking-[-0.01em] text-(--ink)">{listing.title}</h2>
              {flightLine(listing) ? <p className="am-mono mt-1 text-[12.5px] text-(--ink-soft)">{flightLine(listing)}</p> : null}
              {listing.short_description ? <p className="mt-1.5 text-[13px] leading-snug text-(--ink-soft)">{listing.short_description}</p> : null}
              <div className="mt-2 flex flex-wrap gap-1.5">
                <StatusPill status={listing.status} />
                {listing.content_quality && listing.content_quality !== "good" ? (
                  <Pill tone={listing.content_quality === "poor" ? "danger" : "warn"}>{listing.content_quality === "poor" ? "Ficha pobre" : "Ficha por mejorar"}</Pill>
                ) : null}
                {REGULATED.has(kind) ? <Pill tone="info">Precio regulado · se define fuera del portal</Pill> : null}
              </div>
            </div>
          </div>

          <Facts>
            <Fact label={priceHeader(kind, hasOptions(listing))} value={formatMoney(listing.price)} />
            <Fact label={stockHeader(kind)} value={isPortfolio ? (accounts != null ? formatNumber(accounts) : null) : formatNumber(listing.stock)} />
            <Fact
              label={isPortfolio ? "Ingreso por cuenta" : "Vendidos, 30 días"}
              value={
                isPortfolio
                  ? (pricing?.arpu ?? base?.arpu) != null
                    ? formatMoney((pricing?.arpu ?? base?.arpu) as number)
                    : null
                  : listing.sales_last_30d != null
                    ? formatNumber(listing.sales_last_30d)
                    : null
              }
            />
            <Fact
              label={isPortfolio ? "Margen por cuenta" : "Margen"}
              value={
                isPortfolio
                  ? (pricing?.margin_per_line_usd ?? base?.margin_per_line_usd) != null
                    ? formatMoney((pricing?.margin_per_line_usd ?? base?.margin_per_line_usd) as number)
                    : null
                  : pricing?.margin_pct != null
                    ? formatRate(pricing.margin_pct)
                    : null
              }
            />
          </Facts>

          {listing.variants?.length ? (
            <section>
              <SectionTitle aside={isFlight ? "tarifa y sillas por cabina" : "precio y disponibilidad por variante"}>{isFlight ? "Cabinas" : "Variantes"}</SectionTitle>
              <ul className="divide-y divide-(--line) rounded-[10px] border border-(--line) text-[13px]">
                {listing.variants.map((variant) => (
                  <li key={variant.listing_id} className="flex items-center gap-3 px-3 py-1.5">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left hover:underline"
                      onClick={() =>
                        ask(
                          isFlight
                            ? `¿Cómo va la cabina ${optionText(variant) || optionValuesLabel(variant)} de ${listing.title} (${variant.listing_id}) y está bien la tarifa?`
                            : `¿Cómo se vende ${variant.title} en ${optionText(variant) || optionValuesLabel(variant)} (${variant.listing_id}) y está bien el precio?`,
                        )
                      }
                    >
                      <div className="font-medium text-(--ink)">{optionText(variant) || optionValuesLabel(variant)}</div>
                      <div className="text-[11.5px] tabular-nums text-(--ink-soft)">{variant.listing_id}</div>
                    </button>
                    <span className={`w-20 text-right tabular-nums ${variant.stock === 0 ? "font-semibold text-(--danger)" : "text-(--ink)"}`}>
                      {formatNumber(variant.stock)}
                      {isFlight ? <span className="text-[11px] text-(--ink-soft)"> sillas</span> : null}
                    </span>
                    <span className="w-20 text-right tabular-nums text-(--ink)">{formatMoney(variant.price)}</span>
                    <StatusPill status={variant.status} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {pricing && !listing.variants?.length ? (
            <section>
              <SectionTitle
                aside={[
                  pricing.unit_cost != null
                    ? `${isPortfolio ? "costo por cuenta" : "costo unitario"} ${formatMoney(isPortfolio && pricing.wholesale_cost_per_line_usd != null ? pricing.wholesale_cost_per_line_usd : pricing.unit_cost)}`
                    : "",
                  pricing.demand_signal ? `demanda ${DEMAND[pricing.demand_signal] ?? pricing.demand_signal}` : "",
                  pricing.last_changed ? `cambió el ${formatDate(pricing.last_changed)}` : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              >
                Precios
              </SectionTitle>
              {pricing.min_price != null && pricing.max_price != null ? <PriceBand current={pricing.current_price} floor={pricing.min_price} ceiling={pricing.max_price} /> : null}
              <div className="mt-3">
                <Rows
                  rows={[
                    ["Participación en el portafolio", pricing.plan_mix_share_pct != null ? formatRate(pricing.plan_mix_share_pct) : null],
                    ["Margen", isPortfolio && pricing.margin_pct != null ? formatRate(pricing.margin_pct) : null],
                    ["Tasa de reembolso", listing.return_rate_pct != null ? formatRate(listing.return_rate_pct) : null],
                  ]}
                />
              </div>
            </section>
          ) : null}

          {pricing?.active_promotions?.length ? (
            <section>
              <SectionTitle>Promociones activas</SectionTitle>
              <ul className="divide-y divide-(--line) rounded-[12px] bg-(--accent-soft)/60">
                {pricing.active_promotions.map((promo, index) => (
                  <li key={promo.change_id ?? index} className="px-3 py-2 text-[13px] leading-snug">
                    <div className="text-(--ink)">{promo.summary ?? "Ventana promocional"}</div>
                    <div className="am-mono mt-0.5 text-[11.5px] text-(--ink-soft)">
                      {[
                        promo.promo_price != null ? formatMoney(promo.promo_price) : null,
                        promo.standing_price != null ? `precio normal ${formatMoney(promo.standing_price)}` : null,
                        promo.starts && promo.ends ? `${formatDayMonth(promo.starts)} – ${formatDayMonth(promo.ends)}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {listing.missing_attributes?.length ? (
            <section>
              <SectionTitle>Le falta a la ficha</SectionTitle>
              <div className="flex flex-wrap items-center gap-1.5">
                {listing.missing_attributes.map((attribute) => (
                  <Pill key={attribute} tone="warn">
                    + {attribute}
                  </Pill>
                ))}
                <AskButton label="Redactar estos atributos" onClick={() => ask(`Redacta los atributos que faltan (${listing.missing_attributes?.join(", ")}) para ${ref}.`)} />
              </div>
            </section>
          ) : null}

          {listing.review_snippets?.length ? (
            <section>
              <SectionTitle aside={<QuotedAsData subject="Escrito por clientes" />}>Lo que dicen los clientes</SectionTitle>
              <div className="flex flex-col gap-1.5">
                {listing.review_snippets.map((snippet, index) => (
                  <blockquote key={index} className="rounded-[10px] bg-(--ground) px-3 py-2 text-[13px] leading-snug text-(--ink-2)">
                    &ldquo;{snippet}&rdquo;
                  </blockquote>
                ))}
              </div>
            </section>
          ) : null}

          {listing.long_description ? (
            <section>
              <SectionTitle>Descripción</SectionTitle>
              <p className="whitespace-pre-line text-[13px] leading-relaxed text-(--ink-2)">{listing.long_description}</p>
            </section>
          ) : null}
        </>
      )}
    </Sheet>
  );
}

function ProductTable({
  category,
  listings,
  baseRows,
  onOpen,
}: {
  category: string;
  listings: Listing[];
  baseRows: Map<string, PlanMixRow> | null;
  onOpen: (id: string) => void;
}) {
  const portfolio = PORTFOLIO_CATEGORIES.has(category);
  const family = listings.some(hasOptions);
  return (
    <div className="panel-scroll @container overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-left text-[12px] font-semibold text-(--ink-soft)">
            <th className="py-2.5 pl-[18px] pr-3 font-semibold">{titleCase(CATEGORY_NOUNS[category] ?? "producto")}</th>
            <th className="px-3 py-2.5 text-right font-semibold">{priceHeader(category, family)}</th>
            <th className="px-3 py-2.5 text-right font-semibold">{stockHeader(category)}</th>
            {portfolio ? (
              <>
                <th className="px-3 py-2.5 text-right font-semibold">Cancelación mensual</th>
                <th className="hidden px-3 py-2.5 text-right font-semibold @2xl:table-cell">Ingreso por cuenta</th>
                <th className="hidden px-3 py-2.5 text-right font-semibold @3xl:table-cell">Margen por cuenta</th>
              </>
            ) : (
              <th className="px-3 py-2.5 font-semibold">Ficha</th>
            )}
            <th className="py-2.5 pl-3 pr-[18px] font-semibold">Estado</th>
          </tr>
        </thead>
        <tbody>
          {listings.map((listing) => {
            const base = portfolio ? portfolioRow(listing.listing_id, baseRows) : null;
            const flight = flightLine(listing);
            return (
              <tr
                key={listing.listing_id}
                onClick={() => onOpen(listing.listing_id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpen(listing.listing_id);
                  }
                }}
                tabIndex={0}
                aria-label={`Abrir ${listing.title}`}
                className="cursor-pointer border-t border-(--line) transition-colors hover:bg-(--ground)/70 focus-visible:bg-(--ground)/70 focus-visible:outline-none"
              >
                <td className="py-2 pl-[18px] pr-3">
                  <div className="flex items-center gap-3">
                    <CategoryIcon category={category} />
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-medium leading-snug text-(--ink)">{listing.title}</div>
                      <div className="am-mono text-[11.5px] text-(--ink-soft)">
                        {listing.listing_id}
                        {flight ? <span> · {flight}</span> : null}
                        {hasOptions(listing) ? (
                          <span>
                            {" "}
                            ·{" "}
                            {Object.values(listing.options ?? {})
                              .map((values) => values.map((value) => OPTION_LABELS[value] ?? value).join(" · "))
                              .join(" / ") || optionSummary(listing)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="am-mono px-3 py-2 text-right text-[13px] text-(--ink)">{priceLabel(listing)}</td>
                <td className="am-mono px-3 py-2 text-right text-[13px] text-(--ink)">
                  {portfolio ? (base?.subscribers != null ? formatNumber(base.subscribers) : "—") : formatNumber(listing.stock)}
                </td>
                {portfolio ? (
                  <>
                    <td className="am-mono px-3 py-2 text-right text-[13px] text-(--ink)">{base?.churn_rate_pct != null ? formatRate(base.churn_rate_pct) : "—"}</td>
                    <td className="am-mono hidden px-3 py-2 text-right text-[13px] text-(--ink) @2xl:table-cell">{base?.arpu != null ? formatMoney(base.arpu) : "—"}</td>
                    <td className="am-mono hidden px-3 py-2 text-right text-[13px] text-(--ink) @3xl:table-cell">
                      {base?.margin_per_line_usd != null ? formatMoney(base.margin_per_line_usd) : "—"}
                    </td>
                  </>
                ) : (
                  <td className="px-3 py-2">
                    <ContentCell quality={listing.content_quality} />
                  </td>
                )}
                <td className="py-2 pl-3 pr-[18px]">
                  <StatusPill status={listing.status} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function groupListings(listings: Listing[]): { category: string; rows: Listing[] }[] {
  const groups = new Map<string, Listing[]>();
  for (const listing of listings) {
    const category = listing.category ?? "other";
    (groups.get(category) ?? groups.set(category, []).get(category)!).push(listing);
  }
  const rank = (category: string) => CATEGORY_ORDER.indexOf(category) + 1 || CATEGORY_ORDER.length + 1;
  return [...groups.entries()].sort(([a], [b]) => rank(a) - rank(b)).map(([category, rows]) => ({ category, rows }));
}

export default function CatalogView({ refreshKey, onAskAssistant }: { refreshKey: number; onAskAssistant: (text: string) => void }) {
  const { data: listingData, failed } = useResource(fetchListings, [refreshKey]);
  // Portfolio rows keyed by product id; the tables render without them when /base is unavailable.
  const { data: base } = useResource(fetchBase, [refreshKey]);
  const baseRows = useMemo(
    () => (base ? new Map(base.plans.filter((row) => row.plan_id).map((row) => [row.plan_id as string, row])) : null),
    [base],
  );
  const listings = listingData?.listings ?? null;
  const total = listingData ? (listingData.total ?? listingData.listings.length) : null;
  const [openListing, setOpenListing] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<string>("all");

  const { groups, counts } = useMemo(() => {
    const all = listings ?? [];
    const needle = query.trim().toLowerCase();
    const visible = all.filter(
      (listing) =>
        (filter === "all" || listing.category === filter) &&
        (!needle ||
          listing.title.toLowerCase().includes(needle) ||
          listing.listing_id.toLowerCase().includes(needle) ||
          Object.values(listing.attributes ?? {}).some((value) => String(value).toLowerCase().includes(needle))),
    );
    const byCategory: Record<string, number> = {};
    for (const listing of all) byCategory[listing.category ?? "other"] = (byCategory[listing.category ?? "other"] ?? 0) + 1;
    return { groups: groupListings(visible), counts: { all: all.length, ...byCategory } as Record<string, number> };
  }, [listings, query, filter]);

  const needsWork = (listings ?? []).filter((listing) => listing.content_quality && listing.content_quality !== "good").length;
  const fintech = (counts.card ?? 0) + (counts.insurance ?? 0) + (counts.financing ?? 0);
  const summary = listings
    ? [
        total != null && total > listings.length ? `${formatNumber(listings.length)} de ${formatNumber(total)} productos` : null,
        `${counts.flights ?? 0} vuelos`,
        `${(counts.ancillaries ?? 0) + (counts.miles ?? 0)} servicios y millas`,
        `${fintech} productos fintech`,
        needsWork ? `${needsWork} con ficha por mejorar` : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : undefined;
  const openCategory = openListing ? (listings?.find((listing) => listing.listing_id === openListing)?.category ?? "") : "";
  const categories = CATEGORY_ORDER.filter((category) => (counts[category] ?? 0) > 0);

  return (
    <div className="ac-reveal flex flex-col gap-4">
      <PageHeader title="Catálogo" subtitle={summary}>
        <Button variant="secondary" icon="spark" onClick={() => onAskAssistant("¿Qué vuelos van casi llenos o no se van a llenar a tiempo, y qué ajuste de tarifa propones?")}>
          Preguntar por el catálogo
        </Button>
      </PageHeader>

      {failed && !listings ? (
        <Notice>La API de Quasar no responde, así que el catálogo no se puede cargar.</Notice>
      ) : !listings ? (
        <Skeleton className="h-96" />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2.5">
            <SearchField value={query} onChange={setQuery} placeholder="Buscar por nombre, ID o ruta (p. ej. MDE)" label="Buscar en el catálogo" className="min-w-[260px] flex-1 sm:max-w-sm" />
            <Segmented<string>
              label="Filtrar el catálogo"
              value={filter}
              onChange={setFilter}
              options={[
                { id: "all", label: "Todo", count: counts.all },
                ...categories.map((category) => ({ id: category, label: CATEGORY_LABELS[category] ?? titleCase(category), count: counts[category] })),
              ]}
            />
          </div>

          {groups.length === 0 ? <Notice>Nada en el catálogo coincide con la búsqueda.</Notice> : null}

          {groups.map(({ category, rows }) => (
            <Panel key={category} title={CATEGORY_LABELS[category] ?? titleCase(category)} subtitle={String(rows.length)}>
              <ProductTable category={category} listings={rows} baseRows={baseRows} onOpen={setOpenListing} />
            </Panel>
          ))}
        </>
      )}

      {openListing ? (
        <ProductSheet listingId={openListing} category={openCategory} baseRows={baseRows} onClose={() => setOpenListing(null)} onAskAssistant={onAskAssistant} />
      ) : null}
    </div>
  );
}
