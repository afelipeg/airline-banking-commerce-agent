// Copyright 2026 Anthropic PBC
// SPDX-License-Identifier: Apache-2.0

const TOOL_COPY: Record<string, string> = {
  search_products: "Buscando en el catálogo…",
  get_product_details: "Revisando los detalles…",
  search_policies: "Consultando las políticas…",
  get_orders: "Buscando tus reservas…",
  get_order_status: "Buscando tus reservas…",
  get_fulfillment_options: "Revisando las opciones de entrega…",
  get_cart: "Revisando tu compra…",
  add_to_cart: "Actualizando tu compra…",
  update_cart_item: "Actualizando tu compra…",
  remove_from_cart: "Actualizando tu compra…",
  checkout: "Preparando el resumen de tu compra…",
  get_preferences: "Leyendo tu perfil…",
  get_account_context: "Revisando tu cuenta Quasar…",
  get_disclosure: "Consultando las condiciones…",
  recall_memories: "Recordando lo que me has contado…",
  save_memory: "Guardando eso para la próxima…",
  load_skill: "Cargando…",
  web_search: "Buscando en la web…",
  present_card_application: "Preparando tu solicitud de la tarjeta…",
  present_credit_decision: "Presentando la decisión de crédito…",
  present_plan_comparison: "Armando la comparación…",
  present_disclosure: "Preparando los datos clave…",
  present_portfolio_mix: "Armando el portafolio fintech…",
  get_business_snapshot: "Leyendo el resumen del negocio…",
  query_metrics: "Consultando métricas…",
  search_listings: "Buscando en el catálogo…",
  get_listing: "Leyendo la ficha…",
  get_inventory_alerts: "Revisando las alertas de sillas…",
  get_order_issues: "Revisando novedades de reservas…",
  get_pricing_context: "Leyendo el contexto de precios…",
  get_campaign_performance: "Leyendo el rendimiento de campañas…",
  get_pending_changes: "Revisando cambios pendientes…",
  run_analysis: "Corriendo el análisis…",
  apply_change: "Aplicando el cambio…",
  discard_change: "Descartando el cambio…",
};

const QUERY_TOOLS = new Set([
  "search_products",
  "search_policies",
  "search_listings",
  "web_search",
]);

export function describeToolCall(tool: string, input: Record<string, unknown> = {}): string {
  const copy = TOOL_COPY[tool];
  const query = typeof input.query === "string" ? input.query.trim() : "";
  if (copy && query && QUERY_TOOLS.has(tool)) {
    return `${copy.replace(/…$/, "")} · “${query}”`;
  }
  if (copy) return copy;
  if (tool.startsWith("present_")) return "Componiendo la respuesta…";
  if (tool.startsWith("stage_")) return "Preparando un cambio para tu revisión…";
  return `${tool.replaceAll("_", " ")}…`;
}
