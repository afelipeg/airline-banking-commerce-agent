"""An optional credit engine that adds Jev (typesafe.ai) judgments to the scorecard.

Code keeps the policy: knock-outs, the bureau points, the per-tier score and income floors,
and the credit limit stay in ``ScorecardEngine``. Jev supplies the judgments ordinary code
cannot make from the application's free text and figures, all in one parallel request:

- ``repayment_capacity`` and ``income_stability`` (Scores) shift the scorecard's points
  within a bounded band, so Jev can move a borderline applicant but never override a floor;
- ``application_consistency`` (Noul) sends a self-contradicting application to manual review;
- ``fit_classic`` / ``fit_gold`` / ``fit_platinum`` (comparable Scores) rank the approved
  tiers by how well each serves this traveler, which picks the recommendation.

Any failure, timeout, or low-confidence answer returns the scorecard's own decision with
``fallback_used`` set, so the storefront never waits on or breaks because of Jev. Claude
(the shopping agent) never calls this engine: it only reads the stored decision.

Selected by ``QUASAR_CREDIT_ENGINE=jev`` with ``TYPESAFE_API_KEY`` set (``build_credit_engine``);
install ``requirements-jev.txt`` first.
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import date
from typing import Any

from .credit import (
    TIERS,
    BureauRecord,
    CardApplication,
    CreditAssessment,
    CreditEngine,
    Reason,
    ScorecardEngine,
    Tier,
    _score_band_label,
    approve_tiers,
    credit_limit,
)

logger = logging.getLogger(__name__)

# The widest shift Jev's two capacity judgments can apply to the scorecard's points, and the
# confidence under which a judgment is not used.
_MAX_SHIFT_REPAYMENT = 40
_MAX_SHIFT_STABILITY = 20
_MIN_CONFIDENCE = 0.55
_INCONSISTENCY_THRESHOLD = 0.6

_TIER_BENEFITS: dict[Tier, str] = {
    "classic": "no annual fee, 1 mile per dollar, 3 interest-free installments on Quasar flights",
    "gold": (
        "USD 99 annual fee, 1.5 miles per dollar, 1 free checked bag per segment, 4 lounge "
        "visits a year, basic travel insurance, 6 interest-free installments"
    ),
    "platinum": (
        "USD 249 annual fee, 2 miles per dollar, 2 free checked bags, unlimited lounge access, "
        "Plus travel insurance, 12 interest-free installments, no foreign transaction fee"
    ),
}

_REPAYMENT_LEVELS = [
    "Obligations already absorb most of the income or the income looks unreliable; a new credit line would likely strain monthly payments",
    "Payments would fit only with a tight budget; little room for an unexpected expense",
    "Payments fit the income with a moderate buffer",
    "Income comfortably covers current obligations and a new card balance",
    "Very large buffer: obligations are a small share of a steady income",
]
_STABILITY_LEVELS = [
    "No steady source of income is described",
    "Income depends on a recent, informal, or temporary activity",
    "An established activity of a year or more with a regular income",
    "A long-standing, clearly described employment, business, or pension",
]
_FIT_LEVELS = [
    "The tier's benefits and fee do not match how this person travels or what they want",
    "Some benefits would be used, but the fee or the tier's focus fits poorly",
    "A good match for this person's trips, spend, and stated goal",
    "Clearly the tier this traveler would get the most value from",
]


def _normalized(answer: Any, levels: int) -> float:
    return float(answer.score) / (levels - 1)


class JevCreditEngine:
    """The scorecard, with Jev judgments on capacity, consistency, and tier fit."""

    name = "scorecard+jev-v1"

    def __init__(
        self,
        client: Any | None = None,
        *,
        model: str = "jev-latest",
        timeout_s: float = 4.0,
        fallback: ScorecardEngine | None = None,
    ) -> None:
        if client is None:
            from typesafe_sdk import AsyncTypeSafeClient  # optional dependency

            client = AsyncTypeSafeClient(model=model, timeout=timeout_s)
        self.client = client
        self.timeout_s = timeout_s
        self.fallback = fallback or ScorecardEngine()

    def _questions(self) -> dict[str, Any]:
        from typesafe_sdk import Noul, Score

        questions: dict[str, Any] = {
            "repayment_capacity": Score(
                instructions=(
                    "How well can this applicant carry a new credit-card balance, given "
                    "`application.monthly_income_usd`, `application.monthly_obligations_usd`, "
                    "`computed.debt_to_income_pct`, the employment described, and `bureau`?"
                ),
                criteria=_REPAYMENT_LEVELS,
            ),
            "income_stability": Score(
                instructions=(
                    "How stable is this applicant's income, from `application.employment_status`, "
                    "`application.employer_description`, and `application.employment_months`?"
                ),
                criteria=_STABILITY_LEVELS,
            ),
            "application_consistency": Noul(
                instructions=(
                    "Does the application contradict itself, for example an employer described "
                    "while the status says unemployed, or an annual travel spend that cannot fit "
                    "the stated number of trips and income?"
                ),
            ),
        }
        for tier in TIERS:
            questions[f"fit_{tier}"] = Score(
                instructions=(
                    f"How well does the Quasar Visa {tier.capitalize()} card ({_TIER_BENEFITS[tier]}) "
                    "match this traveler's `application.trips_per_year`, "
                    "`application.usual_routes`, `application.annual_travel_spend_usd`, "
                    "`application.preferred_cabin`, and `application.goal`?"
                ),
                criteria=_FIT_LEVELS,
            )
        return questions

    @staticmethod
    def _state(application: CardApplication, bureau: BureauRecord) -> dict[str, Any]:
        """What Jev sees: the application without the birth year (age only feeds the 18+
        rule in code) and the bureau summary. No protected attribute is collected."""
        income = application.monthly_income_usd
        dti = application.monthly_obligations_usd / income * 100 if income > 0 else None
        return {
            "application": application.model_dump(mode="json", exclude={"birth_year"}),
            "bureau": bureau.model_dump(mode="json"),
            "computed": {"debt_to_income_pct": round(dti, 1) if dti is not None else None},
        }

    async def assess(
        self, application: CardApplication, bureau: BureauRecord, *, today: date
    ) -> CreditAssessment:
        base = self.fallback.assess_sync(application, bureau, today=today)
        if any(reason.code.startswith("KO_") for reason in base.reasons):
            return base  # knock-outs are policy; Jev is not asked
        try:
            response = await asyncio.wait_for(
                self.client.system_one(self._state(application, bureau), self._questions()),
                timeout=self.timeout_s,
            )
            answers = response.answers
        except Exception:  # any Jev failure falls back to the scorecard
            logger.warning("Jev unavailable; scorecard decision used", exc_info=True)
            return base.model_copy(update={"fallback_used": True})

        repayment = answers["repayment_capacity"]
        stability = answers["income_stability"]
        if min(repayment.confidence, stability.confidence) < _MIN_CONFIDENCE:
            reasons = [
                *base.reasons,
                Reason(
                    code="JEV_LOW_CONFIDENCE",
                    text="Evaluación complementaria con baja confianza; se usó el scorecard",
                    effect="negative",
                ),
            ]
            return base.model_copy(update={"fallback_used": True, "reasons": reasons})

        reasons = [r for r in base.reasons if not r.code.startswith("INCOME_BELOW_")]
        repayment_norm = _normalized(repayment, len(_REPAYMENT_LEVELS))
        stability_norm = _normalized(stability, len(_STABILITY_LEVELS))
        shift = round(_MAX_SHIFT_REPAYMENT * (repayment_norm - 0.5) * 2) + round(
            _MAX_SHIFT_STABILITY * (stability_norm - 0.5) * 2
        )
        score = max(300, min(850, base.score + shift))
        reasons.append(
            Reason(
                code="JEV_CAPACITY",
                text=f"Capacidad de pago evaluada por Jev: {repayment_norm * 100:.0f}/100",
                effect="positive" if repayment_norm >= 0.5 else "negative",
            )
        )
        reasons.append(
            Reason(
                code="JEV_STABILITY",
                text=f"Estabilidad del ingreso evaluada por Jev: {stability_norm * 100:.0f}/100",
                effect="positive" if stability_norm >= 0.5 else "negative",
            )
        )

        if float(answers["application_consistency"].noul) >= _INCONSISTENCY_THRESHOLD:
            reasons.append(
                Reason(
                    code="JEV_INCONSISTENT",
                    text="La solicitud tiene datos que no concuerdan; pasa a revisión manual",
                    effect="negative",
                )
            )
            return CreditAssessment(
                decision="review",
                score=score,
                score_band=_score_band_label(score),
                reasons=reasons,
                engine=self.name,
                decided_at=base.decided_at,
            )

        income = application.monthly_income_usd
        approved = approve_tiers(score, income, reasons)
        if not approved:
            return CreditAssessment(
                decision="review" if score >= 580 else "declined",
                score=score,
                score_band=_score_band_label(score),
                reasons=reasons,
                engine=self.name,
                decided_at=base.decided_at,
            )
        fit = {tier: float(answers[f"fit_{tier}"].score) for tier in approved}
        # The best fit among the approved tiers; a tie goes to the lower fee.
        recommended: Tier = max(approved, key=lambda tier: (fit[tier], -TIERS.index(tier)))
        return CreditAssessment(
            decision="approved",
            score=score,
            score_band=_score_band_label(score),
            approved_tiers=approved,
            recommended_tier=recommended,
            credit_limit_usd=credit_limit(recommended, score, income),
            reasons=reasons,
            engine=self.name,
            decided_at=base.decided_at,
        )


def build_credit_engine() -> CreditEngine:
    """The scorecard unless ``QUASAR_CREDIT_ENGINE=jev`` and a Jev key are configured."""
    if os.environ.get("QUASAR_CREDIT_ENGINE", "").lower() != "jev":
        return ScorecardEngine()
    if not os.environ.get("TYPESAFE_API_KEY"):
        logger.warning("QUASAR_CREDIT_ENGINE=jev without TYPESAFE_API_KEY; using the scorecard")
        return ScorecardEngine()
    try:
        return JevCreditEngine(model=os.environ.get("QUASAR_JEV_MODEL", "jev-latest"))
    except ImportError:
        logger.warning("typesafe-sdk is not installed (requirements-jev.txt); using the scorecard")
        return ScorecardEngine()
