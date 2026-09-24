"""``present_plan_comparison``: a side-by-side matrix of 2-4 purchasable records of one kind
(the cabins of a flight, the Quasar Visa tiers, the insurance plans, the miles packs). The
model names the records, the dimensions, and the judgment (best-for notes, a
recommendation); every cell is filled here from the records the session has seen."""

from __future__ import annotations

from typing import Any

from commerce_common.presentation import EnrichmentContext, PresentationExtension
from pydantic import BaseModel, Field

# Row labels by attribute key; an unknown key is labelled from the key itself.
_DIMENSION_LABELS: dict[str, str] = {
    "checked_bags": "Maletas documentadas",
    "carry_on": "Equipaje de mano",
    "seat_selection": "Selección de asiento",
    "changes": "Cambios",
    "refundable": "Reembolsable",
    "miles_earned": "Millas que acumula",
    "lounge_access": "Sala VIP",
    "priority_boarding": "Embarque prioritario",
    "seats_left": "Sillas disponibles",
    "miles_per_usd": "Millas por dólar",
    "welcome_bonus_miles": "Bono de bienvenida",
    "free_checked_bag": "Maleta gratis",
    "lounge_visits": "Visitas a sala VIP",
    "travel_insurance_included": "Seguro de viaje incluido",
    "interest_free_installments": "Cuotas sin interés",
    "apr_pct": "Tasa de interés (EA)",
    "min_monthly_income_usd": "Ingreso mínimo mensual",
    "credit_limit_range_usd": "Rango de cupo",
    "foreign_transaction_fee_pct": "Comisión compras internacionales",
    "medical_coverage_usd": "Gastos médicos",
    "trip_cancellation": "Cancelación del viaje",
    "lost_baggage_usd": "Equipaje perdido",
    "flight_delay": "Retraso de vuelo",
    "miles": "Millas",
    "cost_per_mile_usd": "Costo por milla",
    "installments": "Cuotas",
    "interest_rate_ea_pct": "Tasa efectiva anual",
}

_PREFIX_USD = {
    "min_monthly_income_usd",
    "credit_limit_range_usd",
    "medical_coverage_usd",
    "lost_baggage_usd",
    "cost_per_mile_usd",
}
_SUFFIX_PCT = {"apr_pct", "foreign_transaction_fee_pct"}

# Dimensions as the model tends to phrase them, mapped to attribute keys.
_ALIASES: dict[str, str] = {
    "bags": "checked_bags",
    "baggage": "checked_bags",
    "maletas": "checked_bags",
    "seat": "seat_selection",
    "seats": "seats_left",
    "change": "changes",
    "refund": "refundable",
    "miles": "miles_earned",
    "lounge": "lounge_access",
    "priority": "priority_boarding",
    "apr": "apr_pct",
    "interest": "apr_pct",
    "installments_free": "interest_free_installments",
    "welcome_bonus": "welcome_bonus_miles",
    "insurance": "travel_insurance_included",
    "income": "min_monthly_income_usd",
    "credit_limit": "credit_limit_range_usd",
    "medical": "medical_coverage_usd",
    "cancellation": "trip_cancellation",
    "lost_baggage": "lost_baggage_usd",
    "delay": "flight_delay",
}

_PRICE_SUFFIX = {
    "per_passenger_one_way": " por pasajero",
    "per_year": "/año",
    "per_segment": " por trayecto",
    "per_trip": " por viaje",
}


def _normalize_key(raw: str) -> str:
    key = raw.strip().lower().replace("-", "_").replace(" ", "_")
    return _ALIASES.get(key, key)


def _format_price(price: float, unit: str | None) -> str:
    if unit == "financing":
        return "Sin costo de apertura" if price == 0 else f"${price:,.0f}"
    if unit == "per_year" and price == 0:
        return "$0 (sin cuota de manejo)"
    return f"${price:,.0f}{_PRICE_SUFFIX.get(unit or '', '')}"


def _format_value(key: str, raw: str | None) -> str:
    if raw is None or raw.strip() == "":
        return "—"
    value = raw.strip()
    if key in _PREFIX_USD and not value.startswith("$"):
        value = f"${value}"
    if key in _SUFFIX_PCT:
        value = f"{value} %"
    return value


class PlanAnnotation(BaseModel):
    plan_id: str
    best_for: str | None = Field(default=None, max_length=80)


class PlanMatrixPayload(BaseModel):
    title: str | None = Field(default=None, max_length=80)
    plan_ids: list[str] = Field(min_length=2, max_length=4)
    dimension_keys: list[str] = Field(default_factory=list, max_length=8)
    annotations: list[PlanAnnotation] = Field(default_factory=list, max_length=4)
    recommended_plan_id: str | None = None


# The JSON schema the model sees; the payload model above is what the executor enforces.
_INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "title": {"type": "string", "maxLength": 80},
        "plan_ids": {
            "type": "array",
            "items": {"type": "string"},
            "minItems": 2,
            "maxItems": 4,
            "description": (
                "Purchasable ids from this session's results: cabin variants of one flight "
                "(QA-0412-ECO, -PRE, -BUS), card tiers (QA-CARD-100-CLASSIC, -GOLD, "
                "-PLATINUM), insurance plans, or miles packs. Get a family's variants with "
                "get_product_details first."
            ),
        },
        "dimension_keys": {
            "type": "array",
            "items": {"type": "string"},
            "maxItems": 8,
            "description": (
                "Attribute keys to compare, exactly as they appear in the records. Cabins: "
                "checked_bags, seat_selection, changes, refundable, miles_earned, "
                "lounge_access, priority_boarding, seats_left. Card tiers: miles_per_usd, "
                "welcome_bonus_miles, free_checked_bag, lounge_visits, "
                "travel_insurance_included, interest_free_installments, apr_pct, "
                "min_monthly_income_usd. Insurance: medical_coverage_usd, trip_cancellation, "
                "lost_baggage_usd, flight_delay. Price is always shown; don't list it."
            ),
        },
        "annotations": {
            "type": "array",
            "maxItems": 4,
            "items": {
                "type": "object",
                "properties": {
                    "plan_id": {"type": "string"},
                    "best_for": {"type": "string", "maxLength": 80},
                },
                "required": ["plan_id"],
                "additionalProperties": False,
            },
        },
        "recommended_plan_id": {"type": "string"},
    },
    "required": ["plan_ids"],
    "additionalProperties": False,
}


def _unit_of(record: Any, context: EnrichmentContext) -> str | None:
    unit = record.attributes.get("price_unit")
    if unit is None and record.variant_of:
        family = context.state.seen_products.get(record.variant_of)
        unit = family.attributes.get("price_unit") if family is not None else None
    return unit


async def _enrich(payload: PlanMatrixPayload, context: EnrichmentContext) -> dict[str, Any]:
    records = [
        context.state.seen_products[pid]
        for pid in payload.plan_ids
        if pid in context.state.seen_products
    ]
    if len(records) < 2:
        raise ValueError(
            "A comparison needs at least 2 plan_ids from this session's results. Call "
            "get_product_details on the family (a flight, QA-CARD-100, QA-INS-300) and pick "
            "its variants."
        )
    surviving_ids = {record.product_id for record in records}

    rows: list[dict[str, Any]] = [
        {
            "key": "price",
            "label": "Precio",
            "values": [_format_price(r.price, _unit_of(r, context)) for r in records],
        }
    ]
    seen_keys: set[str] = set()
    for raw_key in payload.dimension_keys:
        key = _normalize_key(raw_key)
        if key in {"price", "price_unit", "price_qualifier"} or key in seen_keys:
            continue
        seen_keys.add(key)
        values = [_format_value(key, record.attributes.get(key)) for record in records]
        if all(value == "—" for value in values):
            continue
        rows.append(
            {
                "key": key,
                "label": _DIMENSION_LABELS.get(key, key.replace("_", " ").capitalize()),
                "values": values,
            }
        )

    enriched: dict[str, Any] = {
        "plans": [record.model_dump(exclude_none=True) for record in records],
        "rows": rows,
        "annotations": [
            a.model_dump(exclude_none=True)
            for a in payload.annotations
            if a.plan_id in surviving_ids
        ],
    }
    if payload.title:
        enriched["title"] = payload.title
    if payload.recommended_plan_id in surviving_ids:
        enriched["recommended_plan_id"] = payload.recommended_plan_id

    # A cardholder comparing card tiers sees their own tier marked.
    account = await context.backend.get_account_context(context.session) or {}
    card = account.get("card")
    if isinstance(card, dict) and card.get("product_id") in surviving_ids:
        enriched["current_product_id"] = card["product_id"]
    return enriched


def build_comparison_extension() -> PresentationExtension:
    return PresentationExtension(
        name="present_plan_comparison",
        component="plan_matrix",
        description=(
            "Show a side-by-side matrix of 2-4 options of one kind: the cabins of one flight "
            "(economy, premium, business), the Quasar Visa tiers, the Quasar Protect "
            "insurance plans, or the miles packs. Pass ids from this session's results and "
            "the attribute keys to compare; the UI fills in every price and value from the "
            "catalog. You may add a short best-for note per option and recommend one."
        ),
        input_schema=_INPUT_SCHEMA,
        payload_model=PlanMatrixPayload,
        enrich=_enrich,
    )
