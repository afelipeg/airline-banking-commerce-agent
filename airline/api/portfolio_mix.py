"""``present_portfolio_mix``: the fintech portfolio panel (active accounts, share,
monthly cancellation, revenue and cost per account, weekly trend) for card tiers and
insurance plans. The model names the products and an optional caption each; every figure
comes from the merchant backend."""

from __future__ import annotations

from typing import Any

from commerce_common.presentation import EnrichmentContext, PresentationExtension
from pydantic import BaseModel, Field

from .mock_merchant import MockQuasarMerchant


class PortfolioMixPayload(BaseModel):
    plan_ids: list[str] = Field(min_length=1, max_length=8)
    notes: dict[str, str] = Field(
        default_factory=dict,
        description="Optional short caption per product id (e.g. why it matters now).",
    )


# The JSON schema the model sees; the payload model above is what the executor enforces.
_INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "plan_ids": {
            "type": "array",
            "minItems": 1,
            "maxItems": 8,
            "items": {"type": "string"},
            "description": (
                "Card tier or insurance plan ids: QA-CARD-100-CLASSIC, -GOLD, -PLATINUM, "
                "QA-INS-300-BASIC, -PLUS, -PREMIUM."
            ),
        },
        "notes": {
            "type": "object",
            "additionalProperties": {"type": "string", "maxLength": 200},
            "description": "Optional short caption per product id (e.g. why it matters now).",
        },
    },
    "required": ["plan_ids"],
    "additionalProperties": False,
}


def build_portfolio_mix_extension(backend: MockQuasarMerchant) -> PresentationExtension:
    async def _enrich(payload: PortfolioMixPayload, context: EnrichmentContext) -> dict[str, Any]:
        del context  # bound to its backend at construction
        rows = backend.plan_mix_rows(payload.plan_ids)
        if not rows:
            raise ValueError(
                "None of those ids are card tiers or insurance plans in the portfolio data. "
                "Use QA-CARD-100-CLASSIC/-GOLD/-PLATINUM or QA-INS-300-BASIC/-PLUS/-PREMIUM."
            )
        plans: list[dict[str, Any]] = []
        for row in rows:
            entry = dict(row)
            note = payload.notes.get(row["plan_id"])
            if note:
                entry["note"] = note[:200]
            plans.append(entry)
        return {
            "total_subscribers": backend.total_subscribers(),
            "grain": "week",
            "plans": plans,
        }

    return PresentationExtension(
        name="present_portfolio_mix",
        component="plan_mix",
        description=(
            "Show the fintech portfolio panel for card tiers or insurance plans: active "
            "accounts and share, monthly cancellation, revenue, cost and margin per account, "
            "and the weekly trend. Use it when discussing the card or insurance portfolio, "
            "cancellations, or unit economics, or before a campaign aimed at a tier; the "
            "numbers are filled in from Quasar's own data."
        ),
        input_schema=_INPUT_SCHEMA,
        payload_model=PortfolioMixPayload,
        enrich=_enrich,
    )
