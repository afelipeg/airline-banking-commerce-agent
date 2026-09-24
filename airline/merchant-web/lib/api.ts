// Copyright 2026 Anthropic PBC
// SPDX-License-Identifier: Apache-2.0

import { AgentApi } from "web-shared";
import type {
  BaseOverviewResponse,
  ListingDetailResponse,
  ListingsResponse,
  OverviewResponse,
} from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export const api = new AgentApi(API_URL, "/api/merchant");

export const UNREACHABLE =
  "No pudimos conectarnos con la API de Quasar en el puerto 8000. Iníciala con " +
  "`.venv/bin/uvicorn airline.api.main:app --app-dir . --port 8000` e inténtalo de nuevo.";

export function fetchOverview(): Promise<OverviewResponse | null> {
  return api.get<OverviewResponse>("/overview");
}

/** The fintech portfolio: card accounts and insurance policies. */
export function fetchBase(): Promise<BaseOverviewResponse | null> {
  return api.get<BaseOverviewResponse>("/base");
}

export function fetchListings(query?: string): Promise<ListingsResponse | null> {
  return api.get<ListingsResponse>("/listings", query ? { query } : undefined);
}

export function fetchListingDetail(listingId: string): Promise<ListingDetailResponse | null> {
  return api.get<ListingDetailResponse>(`/listings/${encodeURIComponent(listingId)}`);
}
