// Copyright 2026 Anthropic PBC
// SPDX-License-Identifier: Apache-2.0

"use client";

/** Renders present_credit_decision: the engine's decision, why, and which card tiers it opens. */

import { useEffect, useState } from "react";
import { formatDate, Icon, type IconName, useStoreFrame } from "web-shared";
import { formatPrice } from "@/lib/format";
import type { CreditDecisionPayload } from "@/lib/types";
import { Frame } from "./shared";

const DECISION: Record<CreditDecisionPayload["decision"], { label: string; icon: IconName; box: string; badge: string; bar: string }> = {
  approved: {
    label: "Aprobada",
    icon: "check",
    box: "border-(--ok)/40 bg-(--ok-soft)",
    badge: "bg-(--ok) text-white",
    bar: "bg-(--ok)",
  },
  review: {
    label: "En revisión",
    icon: "clock",
    box: "border-(--warn)/40 bg-(--warn-soft)",
    badge: "bg-(--warn) text-white",
    bar: "bg-(--warn)",
  },
  declined: {
    label: "No aprobada",
    icon: "x",
    box: "border-(--danger)/30 bg-(--danger-soft)",
    badge: "bg-(--danger) text-white",
    bar: "bg-(--danger)",
  },
};

/** The scorecard's scale and its cut-offs: under 580 declined, 580–649 review, then Classic, Gold, Platinum. */
const SCALE_MIN = 300;
const SCALE_MAX = 850;
const CUTS = [
  { at: 580, label: "580" },
  { at: 650, label: "650" },
  { at: 700, label: "700" },
  { at: 750, label: "750" },
];

const pct = (score: number) => Math.max(0, Math.min(100, ((score - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100));

function ScoreGauge({ score, band, barClass }: { score: number; band: string; barClass: string }) {
  // The fill grows one frame after mount so the width transition runs.
  const [filled, setFilled] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setFilled(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="am-meta">Puntaje</p>
        <p className="am-mono text-[13px] text-(--ink-soft)">
          <span className="text-[22px] font-semibold leading-none text-(--ink)">{score}</span> · {band}
        </p>
      </div>
      <div className="relative mt-2 h-2.5 rounded-full bg-(--well)" role="img" aria-label={`Puntaje ${score} de ${SCALE_MAX}, banda ${band}`}>
        <div
          className={`absolute inset-y-0 left-0 rounded-full ${barClass} transition-[width] duration-700 ease-out`}
          style={{ width: filled ? `${pct(score)}%` : "0%" }}
        />
        {CUTS.map((cut) => (
          <span key={cut.at} aria-hidden className="absolute -inset-y-0.5 w-px bg-(--ink)/35" style={{ left: `${pct(cut.at)}%` }} />
        ))}
      </div>
      <div className="am-mono relative mt-1 h-3.5 text-[10px] text-(--ink-soft)" aria-hidden>
        <span className="absolute left-0">{SCALE_MIN}</span>
        {CUTS.map((cut) => (
          <span key={cut.at} className="absolute -translate-x-1/2" style={{ left: `${pct(cut.at)}%` }}>
            {cut.label}
          </span>
        ))}
        <span className="absolute right-0">{SCALE_MAX}</span>
      </div>
    </div>
  );
}

export default function CreditDecision({ payload }: { payload: CreditDecisionPayload }) {
  const { ask, chat } = useStoreFrame();
  const busy = chat?.busy ?? false;
  const style = DECISION[payload.decision] ?? DECISION.review;
  const reasons = payload.reasons ?? [];
  const tiers = payload.tiers ?? [];

  return (
    <Frame component="credit_decision" label="Decisión de crédito · Tarjeta Quasar Visa" flush>
      <div className={`flex items-start gap-3 border-b px-4 py-3.5 sm:px-5 ${style.box}`}>
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${style.badge}`}>
          <Icon name={style.icon} size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="am-meta !text-(--ink-2)">{style.label}</p>
          <p className="mt-0.5 text-[17px] font-bold leading-snug text-(--ink)">{payload.headline}</p>
        </div>
      </div>

      <div className="grid gap-5 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_200px] sm:px-5">
        <ScoreGauge score={payload.score} band={payload.score_band} barClass={style.bar} />
        <div className="sm:border-l sm:border-(--line) sm:pl-5">
          <p className="am-meta">Cupo aprobado</p>
          <p className="am-mono mt-1 text-[26px] font-semibold leading-none tracking-tight text-(--ink)">
            {payload.credit_limit_usd != null ? formatPrice(payload.credit_limit_usd) : "—"}
          </p>
          {payload.credit_limit_usd == null ? (
            <p className="mt-1 text-[11.5px] leading-snug text-(--ink-soft)">Sin cupo con esta evaluación.</p>
          ) : null}
        </div>
      </div>

      {reasons.length ? (
        <div className="border-t border-(--line) px-4 py-3.5 sm:px-5">
          <p className="am-meta mb-2">Qué pesó en la decisión</p>
          <ul className="flex flex-col gap-1.5">
            {reasons.map((reason, index) => {
              const positive = reason.effect === "positive";
              return (
                <li
                  key={`${reason.code}-${index}`}
                  className="am-reveal-item grid grid-cols-[1.25rem_1fr] items-baseline text-[14px] leading-snug text-(--ink)"
                  style={{ animationDelay: `${index * 60}ms` }}
                >
                  <span aria-hidden className={`am-mono font-bold ${positive ? "text-(--ok)" : "text-(--danger)"}`}>
                    {positive ? "+" : "−"}
                  </span>
                  <span>
                    <span className="sr-only">{positive ? "A favor: " : "En contra: "}</span>
                    {reason.text}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {tiers.length ? (
        <div className={`grid gap-px border-t border-(--line) bg-(--line) ${tiers.length >= 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
          {tiers.map((tier, index) => (
            <article
              key={tier.product_id}
              className={`am-reveal-item relative flex flex-col gap-2 p-4 ${
                tier.approved ? "bg-(--surface)" : "bg-(--well)/70"
              } ${tier.recommended && tier.approved ? "outline outline-2 -outline-offset-2 outline-(--accent)" : ""}`}
              style={{ animationDelay: `${index * 80}ms` }}
            >
              <div className="flex min-h-[22px] flex-wrap gap-1">
                {tier.recommended && tier.approved ? <span className="am-tag am-tag--accent">★ Recomendada para ti</span> : null}
                {!tier.approved ? <span className="am-tag">No disponible con esta evaluación</span> : null}
              </div>
              <h3 className={`text-[15px] font-bold leading-tight ${tier.approved ? "text-(--ink)" : "text-(--ink-soft)"}`}>{tier.title}</h3>
              <p className={`am-mono text-[15px] font-semibold ${tier.approved ? "text-(--ink)" : "text-(--ink-soft)"}`}>
                {tier.annual_fee > 0 ? (
                  <>
                    {formatPrice(tier.annual_fee)}
                    <span className="text-[11px] font-normal text-(--ink-soft)">/año de cuota de manejo</span>
                  </>
                ) : (
                  "Sin cuota de manejo"
                )}
              </p>
              {tier.highlights?.length ? (
                <ul className={`flex flex-col gap-1 text-[13px] leading-snug ${tier.approved ? "text-(--ink-2)" : "text-(--ink-soft)"}`}>
                  {tier.highlights.map((highlight) => (
                    <li key={highlight} className="grid grid-cols-[1rem_1fr]">
                      <span aria-hidden className={tier.approved ? "am-tick" : "text-(--ink-faint)"}>
                        ✓
                      </span>
                      <span>{highlight}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-auto pt-2">
                {tier.approved ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => ask(`Quiero la ${tier.title}`)}
                    className={`w-full rounded-(--radius) px-3 py-2 text-[13px] font-semibold transition disabled:opacity-50 ${
                      tier.recommended ? "bg-(--ink) text-(--surface) hover:brightness-125" : "border border-(--line-strong) bg-(--surface) text-(--ink) hover:border-(--accent)"
                    }`}
                  >
                    Quiero la {tier.title}
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : null}

      <div className="border-t border-(--line) px-4 py-3 sm:px-5">
        {payload.next_steps ? <p className="text-[14px] leading-relaxed text-(--ink)">{payload.next_steps}</p> : null}
        {payload.note ? <p className="mt-1 text-[12.5px] leading-snug text-(--ink-soft)">{payload.note}</p> : null}
        <p className="am-mono mt-2 text-[10.5px] uppercase tracking-[0.08em] text-(--ink-soft)">
          Evaluación automática por reglas ({payload.engine}){payload.decided_at ? ` · ${formatDate(payload.decided_at)}` : ""}
        </p>
      </div>
    </Frame>
  );
}
