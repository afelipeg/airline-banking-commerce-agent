"""The Quasar Visa application cards. ``present_card_application`` renders the application
form, prefilled from the profile; the customer submits it to the host route, never through
the model. ``present_credit_decision`` renders the decision the credit engine stored on the
session; the model chooses when to show it and may add a note, and every figure is filled
here from the backend."""

from __future__ import annotations

from typing import Any

from commerce_common.presentation import EnrichmentContext, PresentationExtension
from pydantic import BaseModel, Field

from .credit import TIERS
from .mock_quasar import CARD_FAMILY_ID, MockQuasar, card_title

_CHOICES: dict[str, list[dict[str, str]]] = {
    "employment_status": [
        {"value": "employed", "label": "Empleado"},
        {"value": "self_employed", "label": "Independiente"},
        {"value": "retired", "label": "Pensionado"},
        {"value": "student", "label": "Estudiante"},
        {"value": "unemployed", "label": "Sin empleo"},
    ],
    "housing": [
        {"value": "own", "label": "Propia"},
        {"value": "mortgage", "label": "Propia con hipoteca"},
        {"value": "rent", "label": "Arriendo"},
        {"value": "family", "label": "Familiar"},
    ],
    "preferred_cabin": [
        {"value": "economy", "label": "Económica"},
        {"value": "premium", "label": "Premium"},
        {"value": "business", "label": "Business"},
    ],
}
_CONSENT_TEXT = (
    "Autorizo a Quasar Airlines y a Banco Andino Digital a consultar mi historial en la "
    "central de riesgo para evaluar esta solicitud."
)
_TERMS_TEXT = (
    "Acepto el tratamiento de mis datos solo para esta solicitud, según la política de "
    "privacidad y los términos de la tarjeta Quasar Visa."
)
_HEADLINES = {
    "approved": "¡Tu solicitud fue aprobada!",
    "review": "Tu solicitud quedó en revisión",
    "declined": "Por ahora no pudimos aprobar tu solicitud",
}
_NEXT_STEPS = {
    "approved": (
        "Elige tu tarjeta, revisa sus condiciones y firma en línea: la tarjeta digital queda "
        "activa en la app el mismo día."
    ),
    "review": (
        "Un analista de Banco Andino Digital revisará tu solicitud en máximo 2 días hábiles y "
        "te escribirá por correo."
    ),
    "declined": (
        "Puedes volver a solicitarla en 90 días. Mientras tanto, Quasar Pay te permite pagar "
        "tus vuelos en cuotas."
    ),
}


def _backend(context: EnrichmentContext) -> MockQuasar:
    backend = context.backend
    if not isinstance(backend, MockQuasar):
        raise ValueError("The card application is not available on this storefront.")
    return backend


class CardApplicationPayload(BaseModel):
    intro: str | None = Field(default=None, max_length=300)


_APPLICATION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "intro": {
            "type": "string",
            "maxLength": 300,
            "description": "One or two sentences above the form, in the customer's language.",
        }
    },
    "additionalProperties": False,
}


async def _enrich_application(
    payload: CardApplicationPayload, context: EnrichmentContext
) -> dict[str, Any]:
    backend = _backend(context)
    if backend.holds_card(context.session.user_id):
        raise ValueError(
            "This customer already holds a Quasar Visa card (see the account context); "
            "offer the pre-approved upgrade in card_upgrade_preapproved instead of an application."
        )
    decided = backend.assessment_for(context.session) is not None
    enriched: dict[str, Any] = {
        "title": "Solicitud Tarjeta Quasar Visa",
        "status": "decided" if decided else "not_started",
        "prefill": backend.application_prefill(context.session),
        "choices": _CHOICES,
        "consent_text": _CONSENT_TEXT,
        "terms_text": _TERMS_TEXT,
        "submit_label": "Enviar solicitud",
    }
    if payload.intro:
        enriched["intro"] = payload.intro
    context.notes.append(
        "The form is on screen. The customer submits it themselves; the decision then "
        "appears in the account context and the storefront sends the next turn. Do not ask "
        "for income, employment, or other application data in chat."
    )
    return enriched


class CreditDecisionPayload(BaseModel):
    note: str | None = Field(default=None, max_length=300)


_DECISION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "note": {
            "type": "string",
            "maxLength": 300,
            "description": (
                "Optional short line for the customer, e.g. why the recommended tier fits "
                "their travel. Never restate or change the decision; the card shows it."
            ),
        }
    },
    "additionalProperties": False,
}


def _highlights(attributes: dict[str, str]) -> list[str]:
    lines = []
    if value := attributes.get("miles_per_usd"):
        lines.append(f"{value} millas por dólar")
    if value := attributes.get("welcome_bonus_miles"):
        lines.append(f"{value} millas de bienvenida")
    bag = attributes.get("free_checked_bag")
    if bag and bag != "no":
        lines.append(f"Maleta gratis: {bag}")
    lounge = attributes.get("lounge_visits")
    if lounge and lounge != "0":
        lines.append(f"Sala VIP: {lounge}")
    if value := attributes.get("interest_free_installments"):
        lines.append(f"Hasta {value} cuotas sin interés")
    return lines[:4]


async def _enrich_decision(
    payload: CreditDecisionPayload, context: EnrichmentContext
) -> dict[str, Any]:
    backend = _backend(context)
    assessment = backend.assessment_for(context.session)
    if assessment is None:
        raise ValueError(
            "No credit decision on this session yet. Show present_card_application and wait "
            "for the customer to submit the form; never present a decision you did not read "
            "from the account context."
        )
    family = backend.product(CARD_FAMILY_ID)
    tiers: list[dict[str, Any]] = []
    for tier in TIERS:
        variant = backend.card_variant(tier)
        if variant is None:
            continue
        tiers.append(
            {
                "tier": tier,
                "product_id": variant.product_id,
                "title": card_title(tier),
                "annual_fee": variant.price,
                "approved": tier in assessment.approved_tiers,
                "recommended": tier == assessment.recommended_tier,
                "highlights": _highlights(variant.attributes),
            }
        )
    # The tiers on the card are catalog records the customer can now choose from, so they
    # enter the session's provenance like any other result.
    if family is not None:
        context.state.remember_products([family, *family.variants])
    recommended = backend.card_variant(assessment.recommended_tier or "")
    enriched: dict[str, Any] = {
        "decision": assessment.decision,
        "headline": _HEADLINES[assessment.decision],
        "score": assessment.score,
        "score_band": assessment.score_band,
        "approved_tiers": list(assessment.approved_tiers),
        "recommended_tier": assessment.recommended_tier,
        "recommended_product_id": recommended.product_id if recommended else None,
        "credit_limit_usd": assessment.credit_limit_usd,
        "reasons": [reason.model_dump() for reason in assessment.reasons],
        "tiers": tiers,
        "next_steps": _NEXT_STEPS[assessment.decision],
        "note": payload.note,
        "engine": assessment.engine,
        "decided_at": assessment.decided_at.isoformat(),
    }
    if assessment.decision == "approved":
        context.notes.append(
            "Approved tiers can now be added with add_to_cart using the product_ids on the "
            "card; the backend refuses any other tier."
        )
    return enriched


def build_card_extensions() -> list[PresentationExtension]:
    return [
        PresentationExtension(
            name="present_card_application",
            component="card_application",
            description=(
                "Show the Quasar Visa credit-card application form to a customer who has no "
                "Quasar card (account context: card is null) and wants one, or when a card "
                "would clearly help them (miles, installments, bags). The form is prefilled "
                "from their profile and they submit it themselves; the credit decision is made "
                "by the bank's rules, not by you. Never collect application data in chat."
            ),
            input_schema=_APPLICATION_SCHEMA,
            payload_model=CardApplicationPayload,
            enrich=_enrich_application,
        ),
        PresentationExtension(
            name="present_credit_decision",
            component="credit_decision",
            description=(
                "Show the credit decision stored in the account context "
                "(card_application.status 'decided'): approved tiers, the recommended tier, "
                "credit limit, and reasons, filled from the backend. Use it right after the "
                "customer submits the application form."
            ),
            input_schema=_DECISION_SCHEMA,
            payload_model=CreditDecisionPayload,
            enrich=_enrich_decision,
        ),
    ]
