"""Quasar Airlines' two agent configs: the storefront assistant and the operations portal."""

from __future__ import annotations

from merchant_agent import MerchantAgentConfig
from shopping_agent import ShoppingAgentConfig

from demo_common import host_approval_default

_SHOPPING_DEFAULTS = ShoppingAgentConfig()
_MERCHANT_DEFAULTS = MerchantAgentConfig()

DOMAIN_SEARCH_NOTES = (
    "Flights are dated: when the customer names them, pass the IATA codes as "
    "attributes.origin and attributes.destination and the departure date as "
    "attributes.travel_date (YYYY-MM-DD); results are the departures within three days of "
    "that date. A fare is per passenger, one way, taxes included; a flight's cabins "
    "(economy, premium, business) are its variants. Card tiers, miles packs, insurance, "
    "Quasar Pay and ancillaries are not dated."
)

# Airline and card vocabulary added to the policy-grounding lexicon, Spanish and English.
_POLICY_TERMS = (
    "equipaje",
    "maleta",
    "maletas",
    "baggage",
    "bag",
    "bags",
    "carry-on",
    "cambio de vuelo",
    "cambiar el vuelo",
    "cambios",
    "reembolso",
    "reembolsable",
    "refundable",
    "cancelación",
    "cancelar",
    "check-in",
    "abordaje",
    "retraso",
    "demora",
    "millas",
    "miles",
    "vencimiento",
    "expire",
    "cuota de manejo",
    "annual fee",
    "tasa",
    "interés",
    "intereses",
    "interest",
    "apr",
    "cuotas",
    "installment",
    "installments",
    "seguro",
    "insurance",
    "cobertura",
    "coverage",
    "requisitos",
    "requirements",
    "retracto",
    "sala vip",
    "lounge",
    "mascota",
    "mascotas",
    "pet",
    "política",
    "políticas",
    "términos",
    "condiciones",
    "privacidad",
)
_POLICY_CUES = (
    "cómo",
    "como",
    "qué",
    "que pasa",
    "cuánto",
    "cuanto",
    "cuándo",
    "cuando",
    "puedo",
    "se puede",
    "hay",
    "tiene",
    "explica",
    "dime",
    "cuál",
)
_ORDER_TERMS = (
    "reserva",
    "reservas",
    "mi reserva",
    "booking",
    "pnr",
    "itinerario",
    "itinerary",
    "mi vuelo",
    "pase de abordar",
    "boarding pass",
)
_ORDER_CUES = (
    "dónde",
    "donde",
    "cuándo",
    "estado",
    "cambiar",
    "cancelar",
    "retrasado",
    "demorado",
    "confirmada",
    "sale",
)

# Airline, ancillary, and fintech vocabulary added to the metrics-grounding lexicon.
_METRICS_TERMS = (
    "load factor",
    "factor de ocupación",
    "ocupación",
    "occupancy",
    "ancillary",
    "ancillaries",
    "attach",
    "attach rate",
    "ingreso",
    "ingresos",
    "revenue per passenger",
    "ingreso por pasajero",
    "tarjetas activas",
    "active cards",
    "solicitudes",
    "applications",
    "aprobaciones",
    "approvals",
    "tasa de aprobación",
    "approval rate",
    "cancelaciones",
    "millas vendidas",
    "miles sold",
    "pasajeros",
    "passengers",
    "reservas",
    "bookings",
    "búsquedas",
    "searches",
    "conversión",
    "portafolio",
    "portfolio",
    "ventas",
)
_CHANGE_TERMS = (
    "sube",
    "subir",
    "baja",
    "bajar",
    "cambia",
    "cambiar",
    "ajusta",
    "ajustar",
    "promoción",
    "descuento",
    "campaña",
    "pausa",
    "pausar",
    "activa",
    "activar",
    "actualiza",
    "actualizar",
    "aprueba",
    "descarta",
    "prepara",
)

# Regulated card and financing terms the assistant may never stage an edit to. The
# guardrail matches field names exactly.
_PROTECTED_FIELDS = (
    "apr_pct",
    "interest_rate_ea_pct",
    "late_fee_usd",
    "foreign_transaction_fee_pct",
    "min_monthly_income_usd",
    "credit_limit_range_usd",
    "setup_fee_usd",
    "underwriter",
    "airport_taxes",
)


def build_shopping_config() -> ShoppingAgentConfig:
    return ShoppingAgentConfig(
        brand_name="Quasar Airlines",
        assistant_name="Asistente Quasar",
        brand_voice=(
            "warm, clear, and efficient, like a seasoned airline agent who also knows the "
            "card; replies in the customer's language (Spanish by default); states fares, "
            "fees, and interest plainly, never in fine print"
        ),
        enable_disclosures=True,
        domain_search_notes=DOMAIN_SEARCH_NOTES,
        max_search_results=25,
        policy_intent_terms=_SHOPPING_DEFAULTS.policy_intent_terms + _POLICY_TERMS,
        policy_intent_cues=_SHOPPING_DEFAULTS.policy_intent_cues + _POLICY_CUES,
        order_intent_terms=_SHOPPING_DEFAULTS.order_intent_terms + _ORDER_TERMS,
        order_intent_cues=_SHOPPING_DEFAULTS.order_intent_cues + _ORDER_CUES,
    )


def build_merchant_config(store_name: str) -> MerchantAgentConfig:
    return MerchantAgentConfig(
        brand_name=store_name,
        brand_voice=(
            "direct and numerate, like a revenue manager briefing the commercial team; "
            "replies in the operator's language (Spanish by default)"
        ),
        require_host_approval=host_approval_default(),
        approval_surface="the Approve button on the change preview card in the portal",
        metrics_intent_terms=_MERCHANT_DEFAULTS.metrics_intent_terms + _METRICS_TERMS,
        change_intent_terms=_MERCHANT_DEFAULTS.change_intent_terms + _CHANGE_TERMS,
        protected_fields=_MERCHANT_DEFAULTS.protected_fields + _PROTECTED_FIELDS,
    )
