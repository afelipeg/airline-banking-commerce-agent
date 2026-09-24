// Copyright 2026 Anthropic PBC
// SPDX-License-Identifier: Apache-2.0

"use client";

/**
 * Renders present_card_application: the Quasar Visa application, prefilled from the profile and
 * editable. The form posts straight to `POST /api/card-application` (the applicant's data never
 * passes through the model); on success it refreshes the account and sends the follow-up message
 * through the same path as the composer, so the assistant answers with the decision.
 */

import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { Icon, useStoreFrame } from "web-shared";
import { submitCardApplication } from "@/lib/api";
import type { CardApplicationFields, CardApplicationPayload, Choice } from "@/lib/types";
import { Frame } from "./shared";

/** Sent as the shopper's own message once the application is in. */
export const APPLICATION_SENT_MESSAGE = "Listo, envié mi solicitud de la tarjeta Quasar.";

const DEFAULT_CHOICES: CardApplicationPayload["choices"] = {
  employment_status: [
    { value: "employed", label: "Empleado" },
    { value: "self_employed", label: "Independiente" },
    { value: "retired", label: "Pensionado" },
    { value: "student", label: "Estudiante" },
    { value: "unemployed", label: "Sin empleo" },
  ],
  housing: [
    { value: "own", label: "Propia" },
    { value: "rent", label: "Arriendo" },
    { value: "mortgage", label: "Propia con hipoteca" },
    { value: "family", label: "Familiar" },
  ],
  preferred_cabin: [
    { value: "economy", label: "Económica" },
    { value: "premium", label: "Premium" },
    { value: "business", label: "Business" },
  ],
};

type NumberField =
  | "employment_months"
  | "monthly_income_usd"
  | "monthly_obligations_usd"
  | "trips_per_year"
  | "annual_travel_spend_usd"
  | "birth_year";

const NUMBER_FIELDS: NumberField[] = [
  "employment_months",
  "monthly_income_usd",
  "monthly_obligations_usd",
  "trips_per_year",
  "annual_travel_spend_usd",
  "birth_year",
];

const INTEGER_FIELDS = new Set<NumberField>(["employment_months", "trips_per_year", "birth_year"]);

const NUMBER_LABELS: Record<NumberField, string> = {
  employment_months: "Meses en tu trabajo actual",
  monthly_income_usd: "Ingreso mensual",
  monthly_obligations_usd: "Obligaciones mensuales",
  trips_per_year: "Viajes al año",
  annual_travel_spend_usd: "Gasto anual en viajes",
  birth_year: "Año de nacimiento",
};

/** Inputs hold text so a field can be cleared while typing; numbers are parsed on submit. */
type Draft = Omit<CardApplicationFields, NumberField> & Record<NumberField, string>;

function initialDraft(prefill: Partial<CardApplicationFields> | undefined): Draft {
  const p = prefill ?? {};
  const text = (value: number | undefined) => (value == null || Number.isNaN(value) ? "" : String(value));
  return {
    employment_status: p.employment_status ?? "employed",
    employer_description: p.employer_description ?? "",
    employment_months: text(p.employment_months),
    monthly_income_usd: text(p.monthly_income_usd),
    monthly_obligations_usd: text(p.monthly_obligations_usd),
    housing: p.housing ?? "rent",
    trips_per_year: text(p.trips_per_year),
    usual_routes: p.usual_routes ?? "",
    annual_travel_spend_usd: text(p.annual_travel_spend_usd),
    preferred_cabin: p.preferred_cabin ?? "economy",
    goal: p.goal ?? "",
    birth_year: text(p.birth_year),
  };
}

/** The fields as the API takes them, or the first problem found. */
function parseDraft(draft: Draft): { fields: CardApplicationFields } | { error: string } {
  const numbers = {} as Record<NumberField, number>;
  for (const field of NUMBER_FIELDS) {
    const raw = draft[field].trim().replace(",", ".");
    const value = Number(raw);
    if (raw === "" || !Number.isFinite(value) || value < 0) {
      return { error: `Revisa el campo “${NUMBER_LABELS[field]}”: debe ser un número válido.` };
    }
    numbers[field] = INTEGER_FIELDS.has(field) ? Math.round(value) : value;
  }
  return {
    fields: {
      employment_status: draft.employment_status,
      employer_description: draft.employer_description.trim(),
      housing: draft.housing,
      usual_routes: draft.usual_routes.trim(),
      preferred_cabin: draft.preferred_cabin,
      goal: draft.goal.trim(),
      ...numbers,
    },
  };
}

const INPUT =
  "w-full rounded-[8px] border border-(--line-strong) bg-(--card) px-2.5 py-1.5 text-[14px] text-(--ink) outline-none transition-colors focus:border-(--accent) disabled:border-(--line) disabled:bg-(--well)/60 disabled:text-(--ink-2)";

function SectionTitle({ children }: { children: ReactNode }) {
  return <p className="text-[12.5px] font-bold uppercase tracking-[0.06em] text-(--ink)">{children}</p>;
}

function Field({ label, hint, children, wide }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`flex min-w-0 flex-col gap-1 ${wide ? "sm:col-span-2" : ""}`}>
      <span className="am-meta">{label}</span>
      {children}
      {hint ? <span className="text-[11px] leading-snug text-(--ink-soft)">{hint}</span> : null}
    </label>
  );
}

function Money({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled: boolean }) {
  return (
    <div className="relative">
      <span className="am-mono pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-(--ink-soft)">$</span>
      <input
        type="number"
        inputMode="decimal"
        min={0}
        step="any"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className={`${INPUT} am-mono pl-6 pr-11`}
      />
      <span className="am-mono pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-(--ink-soft)">USD</span>
    </div>
  );
}

function Select({ value, options, onChange, disabled }: { value: string; options: Choice[]; onChange: (value: string) => void; disabled: boolean }) {
  const known = options.some((option) => option.value === value);
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} className={INPUT}>
      {known ? null : <option value={value}>{value}</option>}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function Check({ checked, onChange, disabled, children }: { checked: boolean; onChange: (value: boolean) => void; disabled: boolean; children: ReactNode }) {
  return (
    <label className={`flex items-start gap-2.5 text-[12.5px] leading-snug text-(--ink-2) ${disabled ? "opacity-70" : "cursor-pointer"}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
        className="mt-[2px] h-4 w-4 shrink-0 accent-(--accent)"
      />
      <span>{children}</span>
    </label>
  );
}

type Phase = "editing" | "locked" | "sending" | "sent";

export default function CardApplication({ payload, onSubmitted }: { payload: CardApplicationPayload; onSubmitted?: () => void }) {
  const { ask, chat } = useStoreFrame();
  const decided = payload.status === "decided";
  const [draft, setDraft] = useState<Draft>(() => initialDraft(payload.prefill));
  const [consent, setConsent] = useState(false);
  const [terms, setTerms] = useState(false);
  const [phase, setPhase] = useState<Phase>(decided ? "locked" : "editing");
  const [error, setError] = useState<string | null>(null);
  // The follow-up waits for any reply still streaming; `send` ignores a message while busy.
  const [followUp, setFollowUp] = useState(false);
  const busy = chat?.busy ?? false;
  const ready = chat?.ready ?? false;

  useEffect(() => {
    if (!followUp || busy || !ready) return;
    setFollowUp(false);
    ask(APPLICATION_SENT_MESSAGE);
  }, [followUp, busy, ready, ask]);

  const choices = {
    employment_status: payload.choices?.employment_status?.length ? payload.choices.employment_status : DEFAULT_CHOICES.employment_status,
    housing: payload.choices?.housing?.length ? payload.choices.housing : DEFAULT_CHOICES.housing,
    preferred_cabin: payload.choices?.preferred_cabin?.length ? payload.choices.preferred_cabin : DEFAULT_CHOICES.preferred_cabin,
  };
  const disabled = phase !== "editing";
  const set = <K extends keyof Draft>(key: K) => (value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (phase !== "editing") return;
    const parsed = parseDraft(draft);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    if (!consent || !terms) {
      setError("Para continuar debes autorizar la consulta en centrales de riesgo y aceptar los términos.");
      return;
    }
    setError(null);
    setPhase("sending");
    const result = await submitCardApplication({ ...parsed.fields, consent_bureau: consent, accept_terms: terms });
    if (!result.ok) {
      setError(result.error);
      setPhase("editing");
      return;
    }
    setPhase("sent");
    onSubmitted?.();
    setFollowUp(true);
  };

  const reopen = () => {
    setConsent(false);
    setTerms(false);
    setError(null);
    setPhase("editing");
  };

  return (
    <Frame component="card_application" label={payload.title || "Solicitud de la tarjeta Quasar Visa"}>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {payload.intro ? <p className="text-[14.5px] leading-relaxed text-(--ink-2)">{payload.intro}</p> : null}

        {decided && phase === "locked" ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[8px] border border-(--line) bg-(--well)/60 px-3 py-2.5 text-[13px] leading-snug text-(--ink-2)">
            <Icon name="alert" size={15} className="shrink-0 text-(--warn)" />
            <span className="min-w-0 flex-1">Ya enviaste una solicitud. Si la envías de nuevo, la nueva evaluación reemplaza la anterior.</span>
            <button type="button" onClick={reopen} className="text-[12.5px] font-semibold text-(--accent-ink) underline-offset-2 hover:underline">
              Editar y enviar de nuevo
            </button>
          </div>
        ) : null}

        <SectionTitle>Trabajo e ingresos</SectionTitle>
        <fieldset disabled={disabled} className="-mt-2 grid gap-x-4 gap-y-3 sm:grid-cols-2">
          <Field label="Situación laboral">
            <Select value={draft.employment_status} options={choices.employment_status} onChange={(value) => set("employment_status")(value as Draft["employment_status"])} disabled={disabled} />
          </Field>
          <Field label="Empresa o actividad">
            <input type="text" value={draft.employer_description} onChange={(event) => set("employer_description")(event.target.value)} maxLength={200} className={INPUT} />
          </Field>
          <Field label={NUMBER_LABELS.employment_months}>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={draft.employment_months}
              onChange={(event) => set("employment_months")(event.target.value)}
              className={`${INPUT} am-mono`}
            />
          </Field>
          <Field label="Vivienda">
            <Select value={draft.housing} options={choices.housing} onChange={(value) => set("housing")(value as Draft["housing"])} disabled={disabled} />
          </Field>
          <Field label={NUMBER_LABELS.monthly_income_usd}>
            <Money value={draft.monthly_income_usd} onChange={set("monthly_income_usd")} disabled={disabled} />
          </Field>
          <Field label={NUMBER_LABELS.monthly_obligations_usd} hint="Cuotas de créditos y tarjetas que pagas cada mes.">
            <Money value={draft.monthly_obligations_usd} onChange={set("monthly_obligations_usd")} disabled={disabled} />
          </Field>
        </fieldset>

        <div className="border-t border-(--line) pt-3">
          <SectionTitle>Tus viajes</SectionTitle>
        </div>
        <fieldset disabled={disabled} className="-mt-2 grid gap-x-4 gap-y-3 sm:grid-cols-2">
          <Field label={NUMBER_LABELS.trips_per_year}>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={draft.trips_per_year}
              onChange={(event) => set("trips_per_year")(event.target.value)}
              className={`${INPUT} am-mono`}
            />
          </Field>
          <Field label={NUMBER_LABELS.annual_travel_spend_usd}>
            <Money value={draft.annual_travel_spend_usd} onChange={set("annual_travel_spend_usd")} disabled={disabled} />
          </Field>
          <Field label="Cabina preferida">
            <Select value={draft.preferred_cabin} options={choices.preferred_cabin} onChange={(value) => set("preferred_cabin")(value as Draft["preferred_cabin"])} disabled={disabled} />
          </Field>
          <Field label={NUMBER_LABELS.birth_year} hint="Solo para verificar que eres mayor de edad.">
            <input
              type="number"
              inputMode="numeric"
              min={1900}
              max={2100}
              step={1}
              value={draft.birth_year}
              onChange={(event) => set("birth_year")(event.target.value)}
              className={`${INPUT} am-mono`}
            />
          </Field>
          <Field label="Rutas habituales" wide>
            <textarea rows={2} value={draft.usual_routes} onChange={(event) => set("usual_routes")(event.target.value)} maxLength={200} className={`${INPUT} resize-none`} />
          </Field>
          <Field label="¿Para qué quieres la tarjeta?" wide>
            <textarea rows={2} value={draft.goal} onChange={(event) => set("goal")(event.target.value)} maxLength={300} className={`${INPUT} resize-none`} />
          </Field>
        </fieldset>

        <div className="flex flex-col gap-2.5 border-t border-(--line) pt-3">
          <Check checked={consent} onChange={setConsent} disabled={disabled}>
            {payload.consent_text || "Autorizo a Quasar a consultar mi historial en centrales de riesgo para evaluar esta solicitud."}
          </Check>
          <Check checked={terms} onChange={setTerms} disabled={disabled}>
            {payload.terms_text || "Acepto los términos y condiciones de la tarjeta Quasar Visa."}
          </Check>
        </div>

        {error ? (
          <p role="alert" className="rounded-[8px] border border-(--danger)/40 bg-(--danger-soft) px-3 py-2 text-[13px] leading-snug text-(--danger)">
            {error}
          </p>
        ) : null}

        {phase === "sent" ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[8px] border border-(--ok)/40 bg-(--ok-soft) px-3 py-2.5">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-(--ok) text-white">
              <Icon name="check" size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-bold text-(--ink)">Solicitud enviada</p>
              <p className="text-[12.5px] leading-snug text-(--ink-2)">El asistente te cuenta el resultado en un momento.</p>
            </div>
            <button type="button" onClick={reopen} disabled={busy} className="text-[12.5px] font-semibold text-(--ink-soft) underline-offset-2 hover:text-(--ink) hover:underline disabled:opacity-50">
              Corregir y enviar de nuevo
            </button>
          </div>
        ) : phase === "locked" ? null : (
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={phase === "sending" || !ready} className="btn-primary">
              {phase === "sending" ? "Enviando…" : payload.submit_label || "Enviar solicitud"}
            </button>
            <span className="text-[11.5px] leading-snug text-(--ink-soft)">Tus datos van directo a Quasar; el asistente solo ve la decisión.</span>
          </div>
        )}
      </form>
    </Frame>
  );
}
