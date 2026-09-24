// Copyright 2026 Anthropic PBC
// SPDX-License-Identifier: Apache-2.0

import { AgentApi } from "web-shared";
import type { AccountContext, CardApplicationFields, CartPayload, CreditAssessment, Product } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export const api = new AgentApi(API_URL, "/api");

export const UNREACHABLE =
  "No pudimos conectarnos con la API de Quasar en el puerto 8000. Iníciala con " +
  "`.venv/bin/uvicorn airline.api.main:app --app-dir . --port 8000` e inténtalo de nuevo.";

export async function fetchProducts(): Promise<Product[] | null> {
  const data = await api.get<{ products: Product[] }>("/products", { limit: "100" });
  return data?.products ?? null;
}

/** Null when the read failed. */
export function fetchAccount(): Promise<{ account: AccountContext | null } | null> {
  return api.get<{ account: AccountContext | null }>("/account");
}

/** The server takes flights, ancillaries, miles, and insurance; the card and Quasar Pay go through the assistant. */
export async function addToCart(productId: string, quantity = 1): Promise<CartPayload | null> {
  const body = { product_id: productId, quantity };
  const data = await api.post<{ cart: CartPayload }>("/cart/add", body);
  return data?.cart ?? null;
}

export interface CardApplicationSubmission extends CardApplicationFields {
  consent_bureau: boolean;
  accept_terms: boolean;
}

export type CardApplicationResult =
  | { ok: true; assessment: CreditAssessment; account: AccountContext | null }
  | { ok: false; error: string };

/** FastAPI's `detail`: a string, or a list of validation errors. */
function detailText(detail: unknown): string | null {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (entry && typeof entry === "object") {
          const { msg, loc } = entry as { msg?: unknown; loc?: unknown };
          const field = Array.isArray(loc) ? loc.filter((part) => part !== "body").join(".") : "";
          return typeof msg === "string" ? (field ? `${field}: ${msg}` : msg) : null;
        }
        return null;
      })
      .filter(Boolean);
    return messages.length ? messages.join(" · ") : null;
  }
  return null;
}

/**
 * `POST /api/card-application` with the session header. Unlike the shared client's reads, this
 * keeps the server's `detail` so the form can show why a submission was refused.
 */
export async function submitCardApplication(body: CardApplicationSubmission): Promise<CardApplicationResult> {
  try {
    const response = await fetch(`${api.base}/card-application`, {
      method: "POST",
      headers: api.headers(true),
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => null)) as
      | { ok?: boolean; assessment?: CreditAssessment; account?: AccountContext | null; detail?: unknown }
      | null;
    if (!response.ok || !data?.assessment) {
      return { ok: false, error: detailText(data?.detail) ?? `La solicitud no se pudo enviar (error ${response.status}).` };
    }
    return { ok: true, assessment: data.assessment, account: data.account ?? null };
  } catch {
    return { ok: false, error: "No pudimos conectarnos con Quasar. Revisa la conexión e inténtalo de nuevo." };
  }
}
